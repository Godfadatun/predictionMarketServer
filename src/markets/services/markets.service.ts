import { Injectable } from '@nestjs/common';
import { SuccessResponse } from '@/common/responses';
import { UnitOfWork } from '@/common/database/unit-of-work';
import { AuditService } from '@/common/logging/audit.service';
import { AuthUser } from '@/common/decorators';
import { ConflictError, NotFoundError } from '@/errors';
import { maxLoss, prices } from '@/utils/lmsr';
import { PAYOUT_PER_SHARE_KOBO } from '@/utils/money';
import { LedgerService } from '@/wallet/services/ledger.service';
import { ACCOUNTS, LEDGER_KIND } from '@/wallet/constants/wallet.constants';
import { MarketsRepository } from '../repositories/markets.repository';
import { MARKET_CODES, MARKET_EVENTS } from '../constants/markets.constants';
import { MARKET_MESSAGES } from '../constants/messages';
import { CreateMarketInput, MarketFilters, MarketRecord, MarketView, OutcomeRecord } from '../interfaces/markets.interface';

const withPrices = (m: MarketRecord, outcomes: OutcomeRecord[], p = prices(outcomes.map((o) => o.shares), m.liquidityB)): MarketView =>
  ({ ...m, outcomes: outcomes.map((o, i) => ({ ...o, price: p[i] })) });

@Injectable()
export class MarketsService {
  constructor(
    private readonly repo: MarketsRepository, private readonly ledger: LedgerService,
    private readonly uow: UnitOfWork, private readonly audit: AuditService,
  ) {}

  async list(filters: MarketFilters) {
    const markets = await this.repo.list(filters);
    const outcomes = await this.repo.outcomesForMany(markets.map((m) => m.id));
    return SuccessResponse(markets.map((m) => withPrices(m, outcomes.filter((o) => o.marketId === m.id))));
  }

  async get(idOrSlug: string) {
    const market = await this.repo.findByIdOrSlug(idOrSlug);
    if (!market) throw new NotFoundError(MARKET_CODES.MARKET_NOT_FOUND, MARKET_MESSAGES.MARKET_NOT_FOUND);
    return SuccessResponse(withPrices(market, await this.repo.outcomesForMany([market.id])));
  }

  // Creates the market and funds its pool with the LMSR worst-case loss b·ln(n) from the house subsidy account.
  async create(actor: AuthUser, input: CreateMarketInput) {
    if (await this.repo.findBySlug(input.slug)) throw new ConflictError(MARKET_CODES.SLUG_TAKEN, MARKET_MESSAGES.SLUG_TAKEN);
    const { outcomes: labels, ...data } = input;
    const view = await this.uow.run(async (m) => {
      const created = await this.repo.create(m, { ...data, state: data.state ?? null, createdBy: actor.id }, labels);
      const subsidy = Math.ceil(maxLoss(labels.length, input.liquidityB) * PAYOUT_PER_SHARE_KOBO);
      await this.ledger.post(m, {
        txRef: `market:${created.market.id}`, kind: LEDGER_KIND.MARKET_SUBSIDY,
        legs: [{ accountCode: ACCOUNTS.SUBSIDY, amountKobo: -subsidy }, { accountCode: ACCOUNTS.market(created.market.id), amountKobo: subsidy }],
      });
      await this.audit.record({ event: MARKET_EVENTS.CREATED, module: 'markets', tableType: 'markets', tableId: created.market.id, actorId: actor.id, sessionId: actor.sessionId, meta: { subsidy } }, m);
      return SuccessResponse(withPrices(created.market, created.outcomes));
    });
    return SuccessResponse(view.data, MARKET_MESSAGES.CREATED);
  }
}
