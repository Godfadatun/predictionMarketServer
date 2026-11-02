import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { APP_EVENTS, MarketSettledEvent } from '@/constants/events';
import { EntityManager } from 'typeorm';
import { Success, SuccessResponse } from '@/common/responses';
import { UnitOfWork } from '@/common/database/unit-of-work';
import { AuditService } from '@/common/logging/audit.service';
import { AuthUser } from '@/common/decorators';
import { ConflictError, ForbiddenError, NotFoundError, UnprocessableError } from '@/errors';
import { PAYOUT_PER_SHARE_KOBO } from '@/utils/money';
import { LedgerService } from '@/wallet/services/ledger.service';
import { ACCOUNTS, LEDGER_KIND } from '@/wallet/constants/wallet.constants';
import { MarketsRepository } from '@/markets/repositories/markets.repository';
import { MARKET_STATUS } from '@/markets/constants/markets.constants';
import { TradesRepository } from '@/trades/repositories/trades.repository';
import { SHARE_EPSILON } from '@/trades/constants/trades.constants';
import { SettlementsRepository } from '../repositories/settlements.repository';
import { ResolutionEntity } from '../repositories/resolution.entity';
import { SETTLEMENT_CODES, SETTLEMENT_EVENTS, SETTLEMENT_WARNINGS } from '../constants/settlements.constants';
import { SETTLEMENT_MESSAGES } from '../constants/messages';
import { Payout, ProposeInput, ResolutionView, SettlementResult } from '../interfaces/settlements.interface';

const view = (r: ResolutionEntity, status: string): ResolutionView => ({
  marketId: r.marketId, status, outcomeId: r.outcomeId, isVoid: r.isVoid, sourceUrl: r.sourceUrl, note: r.note,
  proposedBy: r.proposedBy, confirmedBy: r.confirmedBy, proposedAt: r.proposedAt, confirmedAt: r.confirmedAt,
});

@Injectable()
export class SettlementsService {
  constructor(
    private readonly repo: SettlementsRepository, private readonly markets: MarketsRepository, private readonly trades: TradesRepository,
    private readonly ledger: LedgerService, private readonly uow: UnitOfWork, private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {}

  async get(marketId: string) {
    const market = await this.markets.findByIdOrSlug(marketId);
    if (!market) throw new NotFoundError(SETTLEMENT_CODES.MARKET_NOT_FOUND, SETTLEMENT_MESSAGES.MARKET_NOT_FOUND);
    const r = await this.repo.findByMarket(market.id);
    return SuccessResponse(r ? view(r, market.status) : null);
  }

  // Step 1 of four-eyes: an admin records the winner (or VOID) with the public source it was taken from.
  async propose(actor: AuthUser, marketId: string, input: ProposeInput) {
    const { outcomeId, sourceUrl, note } = input;
    const result = await this.uow.run(async (m) => {
      const market = await this.markets.lockById(m, marketId);
      if (!market) throw new NotFoundError(SETTLEMENT_CODES.MARKET_NOT_FOUND, SETTLEMENT_MESSAGES.MARKET_NOT_FOUND);
      if (market.status !== MARKET_STATUS.OPEN) throw new ConflictError(SETTLEMENT_CODES.RESOLUTION_ALREADY_PROPOSED, SETTLEMENT_MESSAGES.RESOLUTION_ALREADY_PROPOSED);
      if (market.closesAt.getTime() > Date.now()) throw new UnprocessableError(SETTLEMENT_CODES.MARKET_STILL_OPEN, SETTLEMENT_MESSAGES.MARKET_STILL_OPEN);
      const outcomes = await this.markets.outcomesFor(m, marketId);
      if (outcomeId && !outcomes.some((o) => o.id === outcomeId)) throw new NotFoundError(SETTLEMENT_CODES.OUTCOME_NOT_FOUND, SETTLEMENT_MESSAGES.OUTCOME_NOT_FOUND);
      const r = await this.repo.create(m, { marketId, outcomeId: outcomeId ?? null, isVoid: !outcomeId, sourceUrl, note: note ?? null, proposedBy: actor.id });
      await this.markets.setStatus(m, marketId, MARKET_STATUS.PENDING_RESOLUTION);
      await this.audit.record({ event: SETTLEMENT_EVENTS.PROPOSED, module: 'settlements', tableType: 'markets', tableId: marketId, actorId: actor.id, sessionId: actor.sessionId, meta: { outcomeId, sourceUrl } }, m);
      return SuccessResponse(view(r, MARKET_STATUS.PENDING_RESOLUTION));
    });
    return SuccessResponse(result.data, SETTLEMENT_MESSAGES.PROPOSED);
  }

  // Step 2: a different admin confirms; winners get ₦100/share (VOID refunds cost basis) and the pool is emptied.
  async confirm(actor: AuthUser, marketId: string) {
    const result = await this.uow.run(async (m) => {
      const market = await this.markets.lockById(m, marketId);
      if (!market) throw new NotFoundError(SETTLEMENT_CODES.MARKET_NOT_FOUND, SETTLEMENT_MESSAGES.MARKET_NOT_FOUND);
      if (market.status !== MARKET_STATUS.PENDING_RESOLUTION) throw new UnprocessableError(SETTLEMENT_CODES.NO_PENDING_RESOLUTION, SETTLEMENT_MESSAGES.NO_PENDING_RESOLUTION);
      const r = (await this.repo.findByMarket(marketId, m))!;
      if (r.proposedBy === actor.id) throw new ForbiddenError(SETTLEMENT_CODES.FOUR_EYES_REQUIRED, SETTLEMENT_MESSAGES.FOUR_EYES_REQUIRED);
      const { data: payouts } = await this.payouts(m, marketId, r);
      const total = payouts.reduce((s, p) => s + p.amountKobo, 0);
      await this.pay(m, marketId, payouts, total);
      const status = r.isVoid ? MARKET_STATUS.VOID : MARKET_STATUS.RESOLVED;
      await this.markets.setStatus(m, marketId, status);
      await this.repo.confirm(m, r.id, actor.id);
      await this.audit.record({
        event: r.isVoid ? SETTLEMENT_EVENTS.VOIDED : SETTLEMENT_EVENTS.RESOLVED, module: 'settlements', tableType: 'markets', tableId: marketId,
        actorId: actor.id, sessionId: actor.sessionId, meta: { outcomeId: r.outcomeId, totalPaidKobo: total, winners: payouts.length },
      }, m);
      const settled: MarketSettledEvent = { marketId, isVoid: r.isVoid, payouts: payouts.map((p) => ({ userId: p.userId, amountKobo: p.amountKobo })) };
      return SuccessResponse({ settled, view: { ...view({ ...r, confirmedBy: actor.id, confirmedAt: new Date() }, status), totalPaidKobo: total, winners: payouts.length } as SettlementResult });
    });
    await this.events.emitAsync(APP_EVENTS.MARKET_SETTLED, result.data.settled);
    const d = result.data.view;
    const warnings = !d.isVoid && d.winners === 0 ? [SETTLEMENT_WARNINGS.NO_WINNING_POSITIONS] : undefined;
    return SuccessResponse(d, d.isVoid ? SETTLEMENT_MESSAGES.VOIDED : SETTLEMENT_MESSAGES.RESOLVED, warnings);
  }

  private async payouts(m: EntityManager, marketId: string, r: ResolutionEntity): Promise<Success<Payout[]>> {
    const positions = await this.trades.forMarket(m, marketId);
    const eligible = positions.filter((p) => p.shares > SHARE_EPSILON && (r.isVoid || p.outcomeId === r.outcomeId));
    const list = eligible.map((p) => ({ positionId: p.id, userId: p.userId, amountKobo: r.isVoid ? p.costKobo : Math.floor(p.shares * PAYOUT_PER_SHARE_KOBO) }));
    return SuccessResponse(list.filter((p) => p.amountKobo > 0));
  }

  // Top up from the subsidy if the pool is short, pay holders, then sweep what is left back to the subsidy account.
  private async pay(m: EntityManager, marketId: string, payouts: Payout[], total: number) {
    const code = ACCOUNTS.market(marketId);
    const pool = await this.ledger.lockedBalance(m, code);
    const shortfall = Math.max(0, total - pool);
    const ref = `settle:${marketId}`;
    await this.ledger.post(m, { txRef: `${ref}:topup`, kind: LEDGER_KIND.MARKET_SUBSIDY, legs: [{ accountCode: ACCOUNTS.SUBSIDY, amountKobo: -shortfall }, { accountCode: code, amountKobo: shortfall }] });
    await this.ledger.post(m, { txRef: ref, kind: LEDGER_KIND.PAYOUT, legs: [{ accountCode: code, amountKobo: -total }, ...payouts.map((p) => ({ accountCode: ACCOUNTS.user(p.userId), amountKobo: p.amountKobo }))] });
    await this.ledger.post(m, { txRef: `${ref}:return`, kind: LEDGER_KIND.SUBSIDY_RETURN, legs: [{ accountCode: code, amountKobo: -(pool + shortfall - total) }, { accountCode: ACCOUNTS.SUBSIDY, amountKobo: pool + shortfall - total }] });
    for (const p of payouts) await this.trades.markPaid(m, p.positionId, p.amountKobo);
    return SuccessResponse({ total });
  }
}
