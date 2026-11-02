import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('markets')
export class MarketEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true }) slug: string;
  @Column() title: string;
  @Column({ type: 'text' }) description: string;
  @Index() @Column() category: string;
  @Index() @Column({ type: 'varchar', nullable: true }) state: string | null;
  @Index() @Column({ default: 'OPEN' }) status: string;
  @Column({ name: 'liquidity_b', type: 'double precision' }) liquidityB: number;
  @Column({ name: 'closes_at', type: 'timestamptz' }) closesAt: Date;
  @Column({ name: 'resolution_source', type: 'text' }) resolutionSource: string;
  @Column({ name: 'resolution_rules', type: 'text' }) resolutionRules: string;
  @Column({ name: 'created_by', type: 'uuid', nullable: true }) createdBy: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}

@Entity('outcomes')
export class OutcomeEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column({ name: 'market_id', type: 'uuid' }) marketId: string;
  @Column() label: string;
  @Column({ type: 'double precision', default: 0 }) shares: number;
  @Column({ name: 'sort_order', type: 'int', default: 0 }) sortOrder: number;
}
