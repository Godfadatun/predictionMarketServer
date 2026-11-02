import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, QueryFailedError, Repository } from 'typeorm';
import { ConflictError } from '@/errors';
import { MARKET_CODES } from '../constants/markets.constants';
import { MARKET_MESSAGES } from '../constants/messages';
import { MarketFilters } from '../interfaces/markets.interface';
import { MarketEntity, OutcomeEntity } from './market.entity';

const UNIQUE_VIOLATION = '23505';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class MarketsRepository {
  constructor(
    @InjectRepository(MarketEntity) private readonly markets: Repository<MarketEntity>,
    @InjectRepository(OutcomeEntity) private readonly outcomes: Repository<OutcomeEntity>,
  ) {}

  list(f: MarketFilters) {
    const where = { ...(f.category && { category: f.category }), ...(f.state && { state: f.state }), ...(f.status && { status: f.status }) };
    return this.markets.find({ where, order: { closesAt: 'ASC', title: 'ASC' }, take: f.limit, skip: f.offset });
  }
  findByIdOrSlug(idOrSlug: string) {
    return this.markets.findOne({ where: UUID.test(idOrSlug) ? { id: idOrSlug } : { slug: idOrSlug } });
  }
  findBySlug(slug: string) { return this.markets.findOne({ where: { slug } }); }
  outcomesForMany(marketIds: string[]) {
    return marketIds.length ? this.outcomes.find({ where: { marketId: In(marketIds) }, order: { sortOrder: 'ASC' } }) : Promise.resolve([]);
  }
  lockById(m: EntityManager, id: string) {
    return UUID.test(id) ? m.getRepository(MarketEntity).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } }) : Promise.resolve(null);
  }
  outcomesFor(m: EntityManager, marketId: string) {
    return m.getRepository(OutcomeEntity).find({ where: { marketId }, order: { sortOrder: 'ASC' } });
  }
  setOutcomeShares(m: EntityManager, id: string, shares: number) { return m.getRepository(OutcomeEntity).update({ id }, { shares }); }
  setStatus(m: EntityManager, id: string, status: string) { return m.getRepository(MarketEntity).update({ id }, { status }); }
  update(m: EntityManager, id: string, patch: Partial<MarketEntity>) { return m.getRepository(MarketEntity).update({ id }, patch); }
  touchTrade(m: EntityManager, id: string, amountKobo: number) {
    return m.getRepository(MarketEntity).createQueryBuilder().update()
      .set({ tradeCount: () => 'trade_count + 1', volumeKobo: () => `volume_kobo + ${Math.trunc(amountKobo)}` }).where({ id }).execute();
  }
  // A racing duplicate slug surfaces as a unique violation; report it as the same 409 as the pre-check.
  async create(m: EntityManager, data: Partial<MarketEntity>, labels: string[], shares: number[]) {
    const market = await m.getRepository(MarketEntity).save(m.getRepository(MarketEntity).create(data)).catch((e) => {
      throw e instanceof QueryFailedError && (e as unknown as { code: string }).code === UNIQUE_VIOLATION ? new ConflictError(MARKET_CODES.SLUG_TAKEN, MARKET_MESSAGES.SLUG_TAKEN) : e;
    });
    const outcomes = await m.getRepository(OutcomeEntity).save(labels.map((label, i) => m.getRepository(OutcomeEntity).create({ marketId: market.id, label, sortOrder: i, shares: shares[i] })));
    return { market, outcomes };
  }
}
