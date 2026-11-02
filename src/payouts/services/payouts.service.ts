import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { createHash, randomBytes } from 'crypto';
import { EntityManager } from 'typeorm';
import { config } from '@/config';
import { Success, SuccessResponse } from '@/common/responses';
import { UnitOfWork } from '@/common/database/unit-of-work';
import { AuditService } from '@/common/logging/audit.service';
import { AuthUser } from '@/common/decorators';
import { ConflictError, ForbiddenError, PartnerError, UnprocessableError } from '@/errors';
import { APP_EVENTS, MarketSettledEvent } from '@/constants/events';
import { LedgerService } from '@/wallet/services/ledger.service';
import { ACCOUNTS, LEDGER_KIND } from '@/wallet/constants/wallet.constants';
import { PayoutsRepository } from '../repositories/payouts.repository';
import { PayoutAccountEntity, WithdrawalEntity } from '../repositories/payouts.entity';
import { paystackPayouts } from '../integrations/paystack';
import {
  AUTO_PAYOUT_MIN_KOBO, BANKS_CACHE_MS, NAME_MATCH_MIN_TOKENS, PAYOUT_ACCOUNT_STATUS, PAYOUT_CODES, PAYOUT_EVENTS, PAYOUT_WARNINGS,
  PAYSTACK_PAYOUT_EVENTS, PAYSTACK_TRANSFER_STATUS, TRANSFER_FEE_TIERS_KOBO, TRANSFER_OUTCOME, WITHDRAWAL_SOURCE, WITHDRAWAL_STATUS,
} from '../constants/payouts.constants';
import { PAYOUT_MESSAGES } from '../constants/messages';
import { Bank, PaystackPayoutEvent, SubmitAccountInput, TransferResult, WithdrawInput } from '../interfaces/payouts.interface';

type Payee = Pick<AuthUser, 'id' | 'sessionId'>;
const tokens = (name: string) => name.toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/[\s-]+/).filter((t) => t.length > 1);
const bvnHash = (bvn: string) => createHash('sha256').update(`${config.bvnPepper}:${bvn}`).digest('hex');
const feeFor = (amountKobo: number) => TRANSFER_FEE_TIERS_KOBO.find((t) => amountKobo <= t.upTo)!.fee;

@Injectable()
export class PayoutsService {
  private readonly logger = new Logger('PayoutsService');
  private banksCache: { at: number; banks: Bank[] } | null = null;

  constructor(
    private readonly repo: PayoutsRepository, private readonly ledger: LedgerService,
    private readonly uow: UnitOfWork, private readonly audit: AuditService,
  ) {}

  async banks() {
    const fresh = this.banksCache && Date.now() - this.banksCache.at < BANKS_CACHE_MS;
    this.banksCache = fresh ? this.banksCache : { at: Date.now(), banks: await paystackPayouts().listBanks() };
    return SuccessResponse(this.banksCache!.banks);
  }

  async getAccount(actor: AuthUser) {
    return SuccessResponse(await this.repo.findAccount(actor.id));
  }

  // KYC: Paystack resolves the account name, we require it to match the profile name, then Paystack checks the BVN owns the account (async).
  async submitAccount(actor: AuthUser, input: SubmitAccountInput) {
    const { bankCode, accountNumber, bvn } = input;
    const existing = await this.repo.findAccount(actor.id);
    if (existing?.status === PAYOUT_ACCOUNT_STATUS.VERIFIED) throw new ConflictError(PAYOUT_CODES.PAYOUT_ACCOUNT_EXISTS, PAYOUT_MESSAGES.PAYOUT_ACCOUNT_EXISTS);
    if (existing?.status === PAYOUT_ACCOUNT_STATUS.PENDING) throw new ConflictError(PAYOUT_CODES.VERIFICATION_IN_PROGRESS, PAYOUT_MESSAGES.VERIFICATION_IN_PROGRESS);
    const ps = paystackPayouts();
    const accountName = await ps.resolveAccount(accountNumber, bankCode);
    const profile = tokens(actor.fullName);
    const matched = profile.filter((t) => tokens(accountName).includes(t)).length;
    if (matched < Math.min(NAME_MATCH_MIN_TOKENS, profile.length)) throw new UnprocessableError(PAYOUT_CODES.NAME_MISMATCH, PAYOUT_MESSAGES.NAME_MISMATCH);
    const [firstName, lastName] = [profile[0], profile[profile.length - 1]];
    const customerCode = await ps.ensureCustomer({ email: actor.email, firstName, lastName, phone: actor.phone });
    await ps.requestIdentification(customerCode, { accountNumber, bankCode, bvn, firstName, lastName });
    const bankName = await this.banks().then((r) => r.data.find((x) => x.code === bankCode)?.name ?? null).catch(() => null); // display only; never blocks KYC
    const account = await this.uow.run(async (m) => {
      const row = await this.repo.upsertAccount(m, {
        userId: actor.id, bankCode, bankName, accountNumber, accountName, bvnLast4: bvn.slice(-4), bvnHash: bvnHash(bvn),
        status: PAYOUT_ACCOUNT_STATUS.PENDING, failureReason: null, paystackCustomerCode: customerCode, recipientCode: null, verifiedAt: null,
      });
      await this.audit.record({ event: PAYOUT_EVENTS.ACCOUNT_SUBMITTED, module: 'payouts', tableType: 'payout_accounts', tableId: row.id, actorId: actor.id, sessionId: actor.sessionId }, m);
      return SuccessResponse(row);
    });
    return SuccessResponse(account.data, PAYOUT_MESSAGES.ACCOUNT_SUBMITTED);
  }

  async listWithdrawals(actor: AuthUser, limit: number) {
    return SuccessResponse(await this.repo.listWithdrawals(actor.id, limit));
  }

  // Funds move to CLEARING:PAYOUTS before Paystack is called, so a crash mid-transfer can never double-spend.
  async withdraw(actor: Payee, input: WithdrawInput, source: string = WITHDRAWAL_SOURCE.MANUAL) {
    const { amountKobo, idempotencyKey } = input;
    const account = await this.repo.findAccount(actor.id);
    if (account?.status !== PAYOUT_ACCOUNT_STATUS.VERIFIED || !account.recipientCode) throw new ForbiddenError(PAYOUT_CODES.PAYOUT_ACCOUNT_NOT_VERIFIED, PAYOUT_MESSAGES.PAYOUT_ACCOUNT_NOT_VERIFIED);
    const reference = `wd_${randomBytes(10).toString('hex')}`;
    const { data: wd } = await this.uow.run(async (m) => {
      await this.ledger.lockedBalance(m, ACCOUNTS.user(actor.id));
      if (await this.repo.findWithdrawalByKey(m, actor.id, idempotencyKey)) throw new ConflictError(PAYOUT_CODES.DUPLICATE_REQUEST, PAYOUT_MESSAGES.DUPLICATE_REQUEST);
      await this.ledger.post(m, { txRef: `withdrawal:${reference}`, kind: LEDGER_KIND.WITHDRAWAL, legs: [
        { accountCode: ACCOUNTS.user(actor.id), amountKobo: -amountKobo }, { accountCode: ACCOUNTS.PAYOUTS_IN_FLIGHT, amountKobo },
      ] });
      const row = await this.repo.createWithdrawal(m, { userId: actor.id, reference, amountKobo, feeKobo: 0, status: WITHDRAWAL_STATUS.PENDING, source, idempotencyKey });
      await this.audit.record({ event: PAYOUT_EVENTS.WITHDRAWAL_CREATED, module: 'payouts', tableType: 'withdrawals', tableId: row.id, actorId: actor.id, sessionId: actor.sessionId, meta: { amountKobo, source } }, m);
      return SuccessResponse(row);
    });
    const transfer = await paystackPayouts().transfer({ amountKobo, recipientCode: account.recipientCode, reference, reason: 'Predict Naija withdrawal' });
    const { data: status } = await this.applyTransferResult(wd, transfer);
    if (status === WITHDRAWAL_STATUS.FAILED) throw new PartnerError(PAYOUT_CODES.PARTNER_UNAVAILABLE, PAYOUT_MESSAGES.PARTNER_UNAVAILABLE);
    const balanceKobo = await this.ledger.balance(ACCOUNTS.user(actor.id));
    const data = { reference, amountKobo, status, source, balanceKobo };
    const unknown = transfer.outcome === TRANSFER_OUTCOME.UNKNOWN;
    const pending = status === WITHDRAWAL_STATUS.PENDING;
    const warnings = unknown ? [PAYOUT_WARNINGS.TRANSFER_STATUS_UNKNOWN] : pending ? [PAYOUT_WARNINGS.TRANSFER_PENDING] : undefined;
    return SuccessResponse(data, unknown ? PAYOUT_MESSAGES.WITHDRAWAL_UNKNOWN : pending ? PAYOUT_MESSAGES.WITHDRAWAL_PENDING : PAYOUT_MESSAGES.WITHDRAWAL_SENT, warnings);
  }

  // Winnings of ₦1,000+ go straight to a verified bank account; anything else (or any failure) stays in the wallet.
  @OnEvent(APP_EVENTS.MARKET_SETTLED, { promisify: true })
  async autoPayout(event: MarketSettledEvent) {
    const eligible = event.isVoid ? [] : event.payouts.filter((p) => p.amountKobo >= AUTO_PAYOUT_MIN_KOBO);
    for (const p of eligible) {
      const account = await this.repo.findAccount(p.userId);
      const verified = account?.status === PAYOUT_ACCOUNT_STATUS.VERIFIED;
      const sent = verified ? await this.withdraw({ id: p.userId, sessionId: null }, { amountKobo: p.amountKobo, idempotencyKey: `auto:${event.marketId}` }, WITHDRAWAL_SOURCE.AUTO_PAYOUT)
        .catch((e: Error) => SuccessResponse(null, e.message)) : SuccessResponse(null, 'no verified payout account');
      this.logger.log(`auto-payout ${event.marketId} → ${p.userId}: ${sent.message}`);
    }
    return SuccessResponse({ attempted: eligible.length });
  }

  @OnEvent(APP_EVENTS.PAYSTACK_WEBHOOK, { promisify: true })
  async onPaystackEvent(event: PaystackPayoutEvent) {
    switch (event.event) {
      case PAYSTACK_PAYOUT_EVENTS.IDENTIFICATION_SUCCESS: return this.onIdentification(String(event.data.customer_code), true, null);
      case PAYSTACK_PAYOUT_EVENTS.IDENTIFICATION_FAILED: return this.onIdentification(String(event.data.customer_code), false, String(event.data.reason ?? 'BVN verification failed'));
      case PAYSTACK_PAYOUT_EVENTS.TRANSFER_SUCCESS: return this.settleByReference(String(event.data.reference), PAYSTACK_TRANSFER_STATUS.SUCCESS);
      case PAYSTACK_PAYOUT_EVENTS.TRANSFER_FAILED: return this.settleByReference(String(event.data.reference), PAYSTACK_TRANSFER_STATUS.FAILED);
      case PAYSTACK_PAYOUT_EVENTS.TRANSFER_REVERSED: return this.settleByReference(String(event.data.reference), PAYSTACK_TRANSFER_STATUS.REVERSED);
      default: return SuccessResponse(null);
    }
  }

  private async onIdentification(customerCode: string, passed: boolean, reason: string | null) {
    const account = await this.uow.run(async (m) => SuccessResponse(await this.repo.lockAccountByCustomer(m, customerCode)));
    const row = account.data;
    if (!row || row.status !== PAYOUT_ACCOUNT_STATUS.PENDING) return SuccessResponse(null);
    const recipientCode = passed ? await paystackPayouts().createRecipient({ name: row.accountName, accountNumber: row.accountNumber, bankCode: row.bankCode }) : null;
    await this.uow.run(async (m) => {
      await this.repo.updateAccount(m, row.id, passed
        ? { status: PAYOUT_ACCOUNT_STATUS.VERIFIED, recipientCode, verifiedAt: new Date(), failureReason: null }
        : { status: PAYOUT_ACCOUNT_STATUS.FAILED, failureReason: reason });
      await this.audit.record({
        event: passed ? PAYOUT_EVENTS.ACCOUNT_VERIFIED : PAYOUT_EVENTS.ACCOUNT_REJECTED, module: 'payouts', tableType: 'payout_accounts', tableId: row.id,
        actorId: row.userId, status: passed ? 'SUCCESS' : 'FAILED', meta: reason ? { reason } : undefined,
      }, m);
      return SuccessResponse(null);
    });
    return SuccessResponse(row.id);
  }

  private async applyTransferResult(wd: WithdrawalEntity, t: TransferResult): Promise<Success<string>> {
    const settled = t.outcome === TRANSFER_OUTCOME.REJECTED ? PAYSTACK_TRANSFER_STATUS.FAILED : t.status === PAYSTACK_TRANSFER_STATUS.SUCCESS ? PAYSTACK_TRANSFER_STATUS.SUCCESS : null;
    if (settled) return this.settleByReference(wd.reference, settled, t.message);
    await this.uow.run(async (m) => SuccessResponse(await this.repo.updateWithdrawal(m, wd.id, { transferCode: t.transferCode })));
    return SuccessResponse<string>(WITHDRAWAL_STATUS.PENDING);
  }

  // Idempotent settlement for both the synchronous transfer reply and Paystack's transfer.* webhooks.
  private async settleByReference(reference: string, outcome: string, reason?: string): Promise<Success<string>> {
    return this.uow.run(async (m) => {
      const wd = await this.repo.lockWithdrawal(m, reference);
      if (!wd) return SuccessResponse<string>(WITHDRAWAL_STATUS.FAILED);
      const isPending = wd.status === WITHDRAWAL_STATUS.PENDING;
      const reversedAfterSuccess = wd.status === WITHDRAWAL_STATUS.SUCCESS && outcome === PAYSTACK_TRANSFER_STATUS.REVERSED;
      if (isPending && outcome === PAYSTACK_TRANSFER_STATUS.SUCCESS) return this.markPaid(m, wd);
      if (isPending || reversedAfterSuccess) return this.refund(m, wd, reversedAfterSuccess, reason);
      return SuccessResponse<string>(wd.status);
    });
  }

  private async markPaid(m: EntityManager, wd: WithdrawalEntity): Promise<Success<string>> {
    const fee = feeFor(wd.amountKobo);
    await this.ledger.post(m, { txRef: `withdrawal:${wd.reference}:settled`, kind: LEDGER_KIND.WITHDRAWAL_SETTLED, legs: [
      { accountCode: ACCOUNTS.PAYOUTS_IN_FLIGHT, amountKobo: -wd.amountKobo }, { accountCode: ACCOUNTS.PAYSTACK_CLEARING, amountKobo: wd.amountKobo },
    ] });
    await this.ledger.post(m, { txRef: `withdrawal:${wd.reference}:fee`, kind: LEDGER_KIND.TRANSFER_FEE, legs: [
      { accountCode: ACCOUNTS.TRANSFER_FEES, amountKobo: -fee }, { accountCode: ACCOUNTS.PAYSTACK_CLEARING, amountKobo: fee },
    ] });
    await this.repo.updateWithdrawal(m, wd.id, { status: WITHDRAWAL_STATUS.SUCCESS, feeKobo: fee, completedAt: new Date() });
    await this.audit.record({ event: PAYOUT_EVENTS.WITHDRAWAL_SETTLED, module: 'payouts', tableType: 'withdrawals', tableId: wd.id, actorId: wd.userId, meta: { fee } }, m);
    return SuccessResponse<string>(WITHDRAWAL_STATUS.SUCCESS);
  }

  private async refund(m: EntityManager, wd: WithdrawalEntity, afterSuccess: boolean, reason?: string): Promise<Success<string>> {
    const from = afterSuccess ? ACCOUNTS.PAYSTACK_CLEARING : ACCOUNTS.PAYOUTS_IN_FLIGHT;
    await this.ledger.post(m, { txRef: `withdrawal:${wd.reference}:refund`, kind: LEDGER_KIND.WITHDRAWAL_REFUND, legs: [
      { accountCode: from, amountKobo: -wd.amountKobo }, { accountCode: ACCOUNTS.user(wd.userId), amountKobo: wd.amountKobo },
    ] });
    const status = afterSuccess ? WITHDRAWAL_STATUS.REVERSED : WITHDRAWAL_STATUS.FAILED;
    await this.repo.updateWithdrawal(m, wd.id, { status, failureReason: reason ?? null, completedAt: new Date() });
    await this.audit.record({ event: PAYOUT_EVENTS.WITHDRAWAL_FAILED, module: 'payouts', tableType: 'withdrawals', tableId: wd.id, actorId: wd.userId, status: 'FAILED', meta: { reason } }, m);
    return SuccessResponse<string>(status);
  }
}

export type { PayoutAccountEntity };
