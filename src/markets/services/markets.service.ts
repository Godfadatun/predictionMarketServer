import { Injectable } from '@nestjs/common';
import { SuccessResponse } from '@/common/responses';
import { UnitOfWork } from '@/common/database/unit-of-work';
import { AuditService } from '@/common/logging/audit.service';
import { AuthUser } from '@/common/decorators';
import { ConflictError, NotFoundError, UnprocessableError } from '@/errors';
import { prices } from '@/utils/lmsr';
import { PAYOUT_PER_SHARE_KOBO } from '@/utils/money';
import { LedgerService } from '@/wallet/services/ledger.service';
import { ACCOUNTS, LEDGER_KIND } from '@/wallet/constants/wallet.constants';
import { MarketsRepository } from '../repositories/markets.repository';
import {
  MARKET_CATEGORY, MARKET_CODES, MARKET_EVENTS, MARKET_STATUS, MARKET_WARNINGS, RULE_FIELDS, SPOTIFY_WEEKLY,
} from '../constants/markets.constants';
import { MARKET_MESSAGES } from '../constants/messages';
import { CreateMarketInput, MarketFilters, MarketRecord, MarketView, OutcomeRecord, UpdateMarketInput } from '../interfaces/markets.interface';

const NORMALISED_EPSILON = 1e-9;
const DAY_MS = 86_400_000;
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

  // Starting odds p_i become LMSR state q_i = b·ln(p_i/p_min); the pool is funded with the worst-case loss b·ln(1/p_min).
  async create(actor: AuthUser | null, input: CreateMarketInput) {
    if (await this.repo.findBySlug(input.slug)) throw new ConflictError(MARKET_CODES.SLUG_TAKEN, MARKET_MESSAGES.SLUG_TAKEN);
    const { outcomes: labels, initialPrices, ...data } = input;
    const raw = initialPrices ?? labels.map(() => 1 / labels.length);
    const sum = raw.reduce((s, x) => s + x, 0);
    const p = raw.map((x) => x / sum);
    const pMin = Math.min(...p);
    const shares = p.map((x) => input.liquidityB * Math.log(x / pMin));
    const view = await this.uow.run(async (m) => {
      const created = await this.repo.create(m, { ...data, state: data.state ?? null, createdBy: actor?.id ?? null }, labels, shares);
      const subsidy = Math.ceil(input.liquidityB * Math.log(1 / pMin) * PAYOUT_PER_SHARE_KOBO);
      await this.ledger.post(m, {
        txRef: `market:${created.market.id}`, kind: LEDGER_KIND.MARKET_SUBSIDY,
        legs: [{ accountCode: ACCOUNTS.SUBSIDY, amountKobo: -subsidy }, { accountCode: ACCOUNTS.market(created.market.id), amountKobo: subsidy }],
      });
      await this.audit.record({ event: MARKET_EVENTS.CREATED, module: 'markets', tableType: 'markets', tableId: created.market.id, actorId: actor?.id ?? null, sessionId: actor?.sessionId ?? null, meta: { subsidy, initialPrices: p } }, m);
      return SuccessResponse(withPrices(created.market, created.outcomes));
    });
    const normalised = Math.abs(sum - 1) > NORMALISED_EPSILON;
    return SuccessResponse(view.data, MARKET_MESSAGES.CREATED, normalised ? [MARKET_WARNINGS.PRICES_NORMALIZED] : undefined);
  }

  // Rules, source and title freeze once anyone has traded, so nobody is bet against changed goalposts.
  async update(actor: AuthUser, id: string, patch: UpdateMarketInput) {
    await this.uow.run(async (m) => {
      const market = await this.repo.lockById(m, id);
      if (!market) throw new NotFoundError(MARKET_CODES.MARKET_NOT_FOUND, MARKET_MESSAGES.MARKET_NOT_FOUND);
      if (market.status !== MARKET_STATUS.OPEN) throw new UnprocessableError(MARKET_CODES.MARKET_NOT_OPEN, MARKET_MESSAGES.MARKET_NOT_OPEN);
      const touchesRules = RULE_FIELDS.some((f) => patch[f] !== undefined);
      if (touchesRules && market.tradeCount > 0) throw new UnprocessableError(MARKET_CODES.MARKET_HAS_TRADES, MARKET_MESSAGES.MARKET_HAS_TRADES);
      await this.repo.update(m, id, patch);
      await this.audit.record({ event: MARKET_EVENTS.UPDATED, module: 'markets', tableType: 'markets', tableId: id, actorId: actor.id, sessionId: actor.sessionId, meta: { fields: Object.keys(patch) } }, m);
      return SuccessResponse(null);
    });
    return SuccessResponse((await this.get(id)).data, MARKET_MESSAGES.UPDATED);
  }

  async close(actor: AuthUser, id: string) {
    await this.uow.run(async (m) => {
      const market = await this.repo.lockById(m, id);
      if (!market) throw new NotFoundError(MARKET_CODES.MARKET_NOT_FOUND, MARKET_MESSAGES.MARKET_NOT_FOUND);
      if (market.status !== MARKET_STATUS.OPEN) throw new UnprocessableError(MARKET_CODES.MARKET_NOT_OPEN, MARKET_MESSAGES.MARKET_NOT_OPEN);
      await this.repo.update(m, id, { closesAt: new Date(Math.min(Date.now(), market.closesAt.getTime())) });
      await this.audit.record({ event: MARKET_EVENTS.CLOSED, module: 'markets', tableType: 'markets', tableId: id, actorId: actor.id, sessionId: actor.sessionId }, m);
      return SuccessResponse(null);
    });
    return SuccessResponse((await this.get(id)).data, MARKET_MESSAGES.CLOSED);
  }

  // Idempotent: the weekly cron and admins can both call it; an existing week is returned with ALREADY_EXISTS.
  async spotifyWeekly(actor: AuthUser | null, weekStart: string) {
    const slug = `${SPOTIFY_WEEKLY.SLUG_PREFIX}${weekStart}`;
    const existing = await this.repo.findBySlug(slug);
    if (existing) return SuccessResponse(withPrices(existing, await this.repo.outcomesForMany([existing.id])), MARKET_MESSAGES.ALREADY_EXISTS, [MARKET_WARNINGS.ALREADY_EXISTS]);
    const start = new Date(`${weekStart}T00:00:00+01:00`);
    const end = new Date(start.getTime() + 6 * DAY_MS);
    const label = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' });
    return this.create(actor, {
      slug, category: MARKET_CATEGORY.MUSIC, liquidityB: SPOTIFY_WEEKLY.LIQUIDITY_B, outcomes: [...SPOTIFY_WEEKLY.ARTISTS],
      title: `Who will have the #1 song on Spotify Nigeria (week of ${label(start)}–${label(end)})?`,
      description: `The lead artist of the #1 track on the official Spotify Weekly Top Songs – Nigeria chart for ${label(start)}–${label(end)} ${start.getUTCFullYear()}.`,
      closesAt: new Date(start.getTime() - SPOTIFY_WEEKLY.CLOSE_OFFSET_MS), resolutionSource: SPOTIFY_WEEKLY.SOURCE,
      resolutionRules: 'Resolves to the FIRST-listed (lead) artist of the #1 track on the official weekly chart for this week. Featured artists do not count. If Spotify does not publish the chart within 7 days, the market is voided.',
    });
  }
}
