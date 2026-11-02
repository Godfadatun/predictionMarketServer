import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { PositionEntity, TradeEntity } from './trade.entity';

@Injectable()
export class TradesRepository {
  constructor(@InjectRepository(PositionEntity) private readonly positions: Repository<PositionEntity>) {}

  findByKey(m: EntityManager, userId: string, idempotencyKey: string) {
    return m.getRepository(TradeEntity).findOne({ where: { userId, idempotencyKey } });
  }
  insertTrade(m: EntityManager, data: TradeEntity) { return m.getRepository(TradeEntity).insert(data); }
  lockPosition(m: EntityManager, userId: string, outcomeId: string) {
    return m.getRepository(PositionEntity).findOne({ where: { userId, outcomeId }, lock: { mode: 'pessimistic_write' } });
  }
  async upsertPosition(m: EntityManager, p: Pick<PositionEntity, 'userId' | 'marketId' | 'outcomeId' | 'shares' | 'costKobo'>) {
    await m.getRepository(PositionEntity).upsert(p, ['userId', 'outcomeId']);
    return m.getRepository(PositionEntity).findOneOrFail({ where: { userId: p.userId, outcomeId: p.outcomeId } });
  }
  forUser(userId: string) {
    return this.positions.createQueryBuilder('p')
      .innerJoin('markets', 'mk', 'mk.id = p.market_id').innerJoin('outcomes', 'o', 'o.id = p.outcome_id')
      .select(['p.id AS id', 'p.market_id AS "marketId"', 'p.outcome_id AS "outcomeId"', 'p.shares AS shares', 'p.cost_kobo::float AS "costKobo"',
        'p.payout_kobo::float AS "payoutKobo"', 'mk.title AS "marketTitle"', 'mk.slug AS "marketSlug"', 'mk.status AS "marketStatus"', 'o.label AS "outcomeLabel"'])
      .where('p.user_id = :userId', { userId }).andWhere('(p.shares > 0 OR p.payout_kobo > 0)').orderBy('p.created_at', 'DESC').getRawMany();
  }
  forMarket(m: EntityManager, marketId: string) {
    return m.getRepository(PositionEntity).find({ where: { marketId }, lock: { mode: 'pessimistic_write' } });
  }
  markPaid(m: EntityManager, id: string, payoutKobo: number) {
    return m.getRepository(PositionEntity).update({ id }, { payoutKobo, settledAt: new Date() });
  }
}
