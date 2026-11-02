import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { bigintKobo } from '@/common/database/bigint.transformer';

@Entity('trades')
@Unique('uq_trades_user_key', ['userId', 'idempotencyKey'])
export class TradeEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column({ name: 'user_id', type: 'uuid' }) userId: string;
  @Index() @Column({ name: 'market_id', type: 'uuid' }) marketId: string;
  @Column({ name: 'outcome_id', type: 'uuid' }) outcomeId: string;
  @Column() side: string;
  @Column({ type: 'double precision' }) shares: number;
  @Column({ name: 'amount_kobo', type: 'bigint', transformer: bigintKobo }) amountKobo: number;
  @Column({ name: 'fee_kobo', type: 'bigint', transformer: bigintKobo }) feeKobo: number;
  @Column({ name: 'price_before', type: 'double precision' }) priceBefore: number;
  @Column({ name: 'price_after', type: 'double precision' }) priceAfter: number;
  @Column({ name: 'idempotency_key' }) idempotencyKey: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}

@Entity('positions')
@Unique('uq_positions_user_outcome', ['userId', 'outcomeId'])
export class PositionEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column({ name: 'user_id', type: 'uuid' }) userId: string;
  @Index() @Column({ name: 'market_id', type: 'uuid' }) marketId: string;
  @Column({ name: 'outcome_id', type: 'uuid' }) outcomeId: string;
  @Column({ type: 'double precision', default: 0 }) shares: number;
  @Column({ name: 'cost_kobo', type: 'bigint', default: 0, transformer: bigintKobo }) costKobo: number;
  @Column({ name: 'payout_kobo', type: 'bigint', default: 0, transformer: bigintKobo }) payoutKobo: number;
  @Column({ name: 'settled_at', type: 'timestamptz', nullable: true }) settledAt: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
