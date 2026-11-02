import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { EntityManager } from 'typeorm';
import { Success, SuccessResponse } from '@/common/responses';
import { UnitOfWork } from '@/common/database/unit-of-work';
import { AuditService } from '@/common/logging/audit.service';
import { AuthUser } from '@/common/decorators';
import { NotFoundError, UnprocessableError } from '@/errors';
import { DepositsRepository } from '../repositories/deposits.repository';
import { DepositEntity } from '../repositories/wallet.entity';
import { paystack } from '../integrations/paystack';
import { LedgerService } from './ledger.service';
import {
  ACCOUNTS, DEPOSIT_STATUS, LEDGER_KIND, PAYSTACK_EVENTS, PAYSTACK_STATUS, WALLET_CODES, WALLET_EVENTS, WALLET_WARNINGS,
} from '../constants/wallet.constants';
import { WALLET_MESSAGES } from '../constants/messages';
import { DepositInitInput, PaystackVerifyResult, PaystackWebhookEvent } from '../interfaces/wallet.interface';

const FAILED_STATUSES: string[] = [PAYSTACK_STATUS.FAILED, PAYSTACK_STATUS.ABANDONED, PAYSTACK_STATUS.REVERSED];
type Settled = { deposit: DepositEntity; status: string; mismatch: boolean };

@Injectable()
export class WalletService {
  constructor(
    private readonly deposits: DepositsRepository, private readonly ledger: LedgerService,
    private readonly uow: UnitOfWork, private readonly audit: AuditService,
  ) {}

  async getWallet(actor: AuthUser) {
    return SuccessResponse({ balanceKobo: await this.ledger.balance(ACCOUNTS.user(actor.id)), currency: 'NGN' });
  }

  async ledgerEntries(actor: AuthUser, limit: number) {
    return SuccessResponse(await this.ledger.entries(ACCOUNTS.user(actor.id), limit));
  }

  async initDeposit(actor: AuthUser, input: DepositInitInput) {
    const reference = `dep_${randomBytes(10).toString('hex')}`;
    const init = await paystack().initialize({ email: actor.email, amountKobo: input.amountKobo, reference });
    const deposit = await this.uow.run(async (m) => {
      const d = await this.deposits.create(m, {
        userId: actor.id, reference, amountKobo: input.amountKobo, status: DEPOSIT_STATUS.PENDING, provider: 'paystack', authorizationUrl: init.authorizationUrl,
      });
      await this.audit.record({ event: WALLET_EVENTS.DEPOSIT_INITIATED, module: 'wallet', tableType: 'deposits', tableId: d.id, actorId: actor.id, sessionId: actor.sessionId }, m);
      return SuccessResponse(d);
    });
    return SuccessResponse(deposit.data, WALLET_MESSAGES.DEPOSIT_INITIATED);
  }

  // User-triggered check after the Paystack redirect; always re-verifies with Paystack.
  async verifyDeposit(actor: AuthUser, reference: string) {
    const { data: settled } = await this.uow.run(async (m) => {
      const deposit = await this.deposits.lockByReference(m, reference, actor.id);
      if (!deposit) throw new NotFoundError(WALLET_CODES.DEPOSIT_NOT_FOUND, WALLET_MESSAGES.DEPOSIT_NOT_FOUND);
      if (deposit.status !== DEPOSIT_STATUS.PENDING) throw new UnprocessableError(WALLET_CODES.ALREADY_PROCESSED, WALLET_MESSAGES.ALREADY_PROCESSED);
      const result = await paystack().verify(reference, deposit.amountKobo);
      return this.settle(m, deposit, result, actor);
    });
    if (settled.mismatch) throw new UnprocessableError(WALLET_CODES.AMOUNT_MISMATCH, WALLET_MESSAGES.AMOUNT_MISMATCH);
    const balanceKobo = await this.ledger.balance(ACCOUNTS.user(actor.id));
    const data = { reference, amountKobo: settled.deposit.amountKobo, status: settled.status, balanceKobo };
    const pending = settled.status === DEPOSIT_STATUS.PENDING;
    return SuccessResponse(data, pending ? WALLET_MESSAGES.PAYMENT_NOT_COMPLETED : WALLET_MESSAGES.DEPOSIT_CREDITED, pending ? [WALLET_WARNINGS.PAYMENT_NOT_COMPLETED] : undefined);
  }

  // Paystack webhook: acknowledge everything; credit only PENDING deposits that Paystack re-confirms.
  async handlePaystackEvent(event: PaystackWebhookEvent) {
    await this.uow.run(async (m) => {
      const deposit = event.event === PAYSTACK_EVENTS.CHARGE_SUCCESS ? await this.deposits.lockByReference(m, event.data.reference) : null;
      if (!deposit || deposit.status !== DEPOSIT_STATUS.PENDING) return SuccessResponse(null);
      const result = await paystack().verify(deposit.reference, deposit.amountKobo);
      return this.settle(m, deposit, result, null);
    });
    return SuccessResponse({ received: true }, WALLET_MESSAGES.WEBHOOK_ACK);
  }

  private async settle(m: EntityManager, deposit: DepositEntity, result: PaystackVerifyResult, actor: AuthUser | null): Promise<Success<Settled>> {
    const base = { module: 'wallet', tableType: 'deposits', tableId: deposit.id, actorId: actor?.id ?? deposit.userId, sessionId: actor?.sessionId ?? null };
    if (FAILED_STATUSES.includes(result.status)) {
      await this.deposits.setStatus(m, deposit.id, DEPOSIT_STATUS.FAILED);
      return SuccessResponse<Settled>({ deposit, status: DEPOSIT_STATUS.FAILED, mismatch: false });
    }
    if (result.status !== PAYSTACK_STATUS.SUCCESS) return SuccessResponse<Settled>({ deposit, status: DEPOSIT_STATUS.PENDING, mismatch: false });
    if (result.amountKobo !== deposit.amountKobo) {
      await this.deposits.setStatus(m, deposit.id, DEPOSIT_STATUS.FLAGGED);
      await this.audit.record({ ...base, event: WALLET_EVENTS.DEPOSIT_FLAGGED, status: 'FAILED', meta: { expected: deposit.amountKobo, paid: result.amountKobo } }, m);
      return SuccessResponse<Settled>({ deposit, status: DEPOSIT_STATUS.FLAGGED, mismatch: true });
    }
    await this.ledger.post(m, {
      txRef: `deposit:${deposit.reference}`, kind: LEDGER_KIND.DEPOSIT,
      legs: [{ accountCode: ACCOUNTS.PAYSTACK_CLEARING, amountKobo: -deposit.amountKobo }, { accountCode: ACCOUNTS.user(deposit.userId), amountKobo: deposit.amountKobo }],
    });
    await this.deposits.setStatus(m, deposit.id, DEPOSIT_STATUS.SUCCESS, new Date());
    await this.audit.record({ ...base, event: WALLET_EVENTS.DEPOSIT_CREDITED }, m);
    return SuccessResponse<Settled>({ deposit, status: DEPOSIT_STATUS.SUCCESS, mismatch: false });
  }
}
