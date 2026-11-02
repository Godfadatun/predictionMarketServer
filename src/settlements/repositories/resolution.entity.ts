import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('resolutions')
export class ResolutionEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'market_id', type: 'uuid', unique: true }) marketId: string;
  @Column({ name: 'outcome_id', type: 'uuid', nullable: true }) outcomeId: string | null;
  @Column({ name: 'is_void', default: false }) isVoid: boolean;
  @Column({ name: 'source_url', type: 'text' }) sourceUrl: string;
  @Column({ type: 'text', nullable: true }) note: string | null;
  @Column({ name: 'proposed_by', type: 'uuid' }) proposedBy: string;
  @Column({ name: 'confirmed_by', type: 'uuid', nullable: true }) confirmedBy: string | null;
  @CreateDateColumn({ name: 'proposed_at', type: 'timestamptz' }) proposedAt: Date;
  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true }) confirmedAt: Date | null;
}
