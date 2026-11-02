import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SuccessResponse, Success } from '@/common/responses';
import { UnitOfWork } from '@/common/database/unit-of-work';
import { AuditService } from '@/common/logging/audit.service';
import { AuthUser } from '@/common/decorators';
import { ConflictError, NotFoundError, UnprocessableError } from '@/errors';
import { prices, proceedsForSale, sharesForSpend } from '@/utils/lmsr';
import { bpsOf, PAYOUT_PER_SHARE_KOBO } from '@/utils/money';
import { LedgerService } from '@/wallet/services/ledger.service';
import { ACCOUNTS, LEDGER_KIND } from '@/wallet/constants/wallet.constants';
import { MarketsRepository } from '@/markets/repositories/markets.repository';
import { MARKET_STATUS } from '@/markets/constants/markets.constants';
import { TradesRepository } from '../repositories/trades.repository';
import { PositionEntity } from '../repositories/trade.entity';
import { HIGH_PRICE_IMPACT, SHARE_EPSILON, TRADE_CODES, TRADE_EVENTS, TRADE_FEE_BPS, TRADE_SIDE, TRADE_WARNINGS } from '../constants/trades.constants';
import { TRADE_MESSAGES } from '../constants/messages';
import { Fill, PlaceTradeInput, PositionView, TradeResult } from '../interfaces/trades.interface';

@Injectable()
export class TradesService {
  constructor(
    private readonly trades: TradesRepository, private readonly markets: MarketsRepository, private readonly ledger: LedgerService,
    private readonly uow: UnitOfWork, private readonly audit: AuditService,
  ) {}

  // Market row lock serialises every trade on a market, so LMSR state, idempotency and balances stay consistent.
  async place(actor: AuthUser, marketId: string, input: PlaceTradeInput) {
    const { side, outcomeId, idempotencyKey } = input;
    const result = await this.uow.run(async (m) => {
      const market = await this.markets.lockById(m, marketId);
      if (!market) throw new NotFoundError(TRADE_CODES.MARKET_NOT_FOUND, TRADE_MESSAGES.MARKET_NOT_FOUND);
      if (market.status !== MARKET_STATUS.OPEN || market.closesAt.getTime() <= Date.now()) throw new UnprocessableError(TRADE_CODES.MARKET_CLOSED, TRADE_MESSAGES.MARKET_CLOSED);
      const outcomes = await this.markets.outcomesFor(m, marketId);
      const idx = outcomes.findIndex((o) => o.id === outcomeId);
      if (idx < 0) throw new NotFoundError(TRADE_CODES.OUTCOME_NOT_FOUND, TRADE_MESSAGES.OUTCOME_NOT_FOUND);
      if (await this.trades.findByKey(m, actor.id, idempotencyKey)) throw new ConflictError(TRADE_CODES.DUPLICATE_REQUEST, TRADE_MESSAGES.DUPLICATE_REQUEST);

      const q = outcomes.map((o) => o.shares);
      const b = market.liquidityB;
      const position = await this.trades.lockPosition(m, actor.id, outcomeId);
      const { data: fill } = side === TRADE_SIDE.BUY ? this.fillBuy(actor, marketId, q, b, idx, input, position) : this.fillSell(actor, marketId, q, b, idx, input, position);
      const qAfter = q.map((x, i) => (i === idx ? x + (side === TRADE_SIDE.BUY ? fill.shares : -fill.shares) : x));
      const priceBefore = prices(q, b)[idx];
      const pricesAfter = prices(qAfter, b);
      const tradeId = randomUUID();

      await this.ledger.post(m, { txRef: `trade:${tradeId}`, kind: side === TRADE_SIDE.BUY ? LEDGER_KIND.TRADE_BUY : LEDGER_KIND.TRADE_SELL, legs: fill.legs });
      await this.markets.setOutcomeShares(m, outcomeId, qAfter[idx]);
      await this.trades.insertTrade(m, {
        id: tradeId, userId: actor.id, marketId, outcomeId, side, shares: fill.shares, amountKobo: fill.amountKobo, feeKobo: fill.feeKobo,
        priceBefore, priceAfter: pricesAfter[idx], idempotencyKey, createdAt: new Date(),
      });
      const pos = await this.trades.upsertPosition(m, { userId: actor.id, marketId, outcomeId, shares: fill.positionShares, costKobo: fill.positionCost });
      await this.audit.record({
        event: side === TRADE_SIDE.BUY ? TRADE_EVENTS.BUY : TRADE_EVENTS.SELL, module: 'trades', tableType: 'trades', tableId: tradeId,
        actorId: actor.id, sessionId: actor.sessionId, meta: { marketId, outcomeId, shares: fill.shares, amountKobo: fill.amountKobo },
      }, m);
      const balanceKobo = await this.ledger.balance(ACCOUNTS.user(actor.id), m);
      return SuccessResponse<TradeResult>({
        trade: { id: tradeId, side, outcomeId, shares: fill.shares, amountKobo: fill.amountKobo, feeKobo: fill.feeKobo, priceBefore, priceAfter: pricesAfter[idx] },
        balanceKobo,
        position: { outcomeId, shares: pos.shares, costKobo: pos.costKobo },
        prices: outcomes.map((o, i) => ({ outcomeId: o.id, price: pricesAfter[i] })),
      });
    });
    const t = result.data.trade;
    const warnings = Math.abs(t.priceAfter - t.priceBefore) >= HIGH_PRICE_IMPACT ? [TRADE_WARNINGS.HIGH_PRICE_IMPACT] : undefined;
    return SuccessResponse(result.data, side === TRADE_SIDE.BUY ? TRADE_MESSAGES.BOUGHT : TRADE_MESSAGES.SOLD, warnings);
  }

  async positions(actor: AuthUser) {
    return SuccessResponse<PositionView[]>(await this.trades.forUser(actor.id));
  }

  // BUY: user pays amount; 2% fee to the house; the rest buys LMSR shares and goes into the market pool.
  private fillBuy(actor: AuthUser, marketId: string, q: number[], b: number, idx: number, input: PlaceTradeInput, pos: PositionEntity | null): Success<Fill> {
    const amountKobo = input.amountKobo!;
    const feeKobo = bpsOf(amountKobo, TRADE_FEE_BPS);
    const net = amountKobo - feeKobo;
    const shares = sharesForSpend(q, b, idx, net / PAYOUT_PER_SHARE_KOBO);
    if (shares < (input.minShares ?? 0)) throw new UnprocessableError(TRADE_CODES.SLIPPAGE_EXCEEDED, TRADE_MESSAGES.SLIPPAGE_EXCEEDED);
    return SuccessResponse<Fill>({
      shares, amountKobo, feeKobo, positionShares: (pos?.shares ?? 0) + shares, positionCost: (pos?.costKobo ?? 0) + net,
      legs: [
        { accountCode: ACCOUNTS.user(actor.id), amountKobo: -amountKobo },
        { accountCode: ACCOUNTS.market(marketId), amountKobo: net },
        { accountCode: ACCOUNTS.FEES, amountKobo: feeKobo },
      ],
    });
  }

  // SELL: pool pays LMSR proceeds (rounded down); 2% fee to the house; cost basis shrinks pro rata.
  private fillSell(actor: AuthUser, marketId: string, q: number[], b: number, idx: number, input: PlaceTradeInput, pos: PositionEntity | null): Success<Fill> {
    const shares = input.shares!;
    const held = pos?.shares ?? 0;
    if (shares > held + SHARE_EPSILON) throw new UnprocessableError(TRADE_CODES.INSUFFICIENT_SHARES, TRADE_MESSAGES.INSUFFICIENT_SHARES);
    const gross = Math.floor(proceedsForSale(q, b, idx, shares) * PAYOUT_PER_SHARE_KOBO);
    const feeKobo = bpsOf(gross, TRADE_FEE_BPS);
    if (gross - feeKobo < (input.minProceedsKobo ?? 0)) throw new UnprocessableError(TRADE_CODES.SLIPPAGE_EXCEEDED, TRADE_MESSAGES.SLIPPAGE_EXCEEDED);
    const remaining = Math.max(0, held - shares);
    return SuccessResponse<Fill>({
      shares, amountKobo: gross, feeKobo, positionShares: remaining < SHARE_EPSILON ? 0 : remaining,
      positionCost: Math.round((pos?.costKobo ?? 0) * (remaining / held)),
      legs: [
        { accountCode: ACCOUNTS.market(marketId), amountKobo: -gross },
        { accountCode: ACCOUNTS.user(actor.id), amountKobo: gross - feeKobo },
        { accountCode: ACCOUNTS.FEES, amountKobo: feeKobo },
      ],
    });
  }
}
