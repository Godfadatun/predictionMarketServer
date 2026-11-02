import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { bigintKobo } from '@/common/database/bigint.transformer';

@Entity('accounts')
export class AccountEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true }) code: string;
  @Column() kind: string;
  @Index() @Column({ name: 'user_id', type: 'uuid', nullable: true }) userId: string | null;
  @Column({ name: 'balance_kobo', type: 'bigint', default: 0, transformer: bigintKobo }) balanceKobo: number;
  @Column({ name: 'allow_negative', default: false }) allowNegative: boolean;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}

@Entity('ledger_entries')
export class LedgerEntryEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column({ name: 'tx_ref' }) txRef: string;
  @Index() @Column({ name: 'account_id', type: 'uuid' }) accountId: string;
  @Column({ name: 'amount_kobo', type: 'bigint', transformer: bigintKobo }) amountKobo: number;
  @Column({ name: 'balance_after_kobo', type: 'bigint', transformer: bigintKobo }) balanceAfterKobo: number;
  @Column() kind: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}

@Entity('deposits')
export class DepositEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column({ name: 'user_id', type: 'uuid' }) userId: string;
  @Column({ unique: true }) reference: string;
  @Column({ name: 'amount_kobo', type: 'bigint', transformer: bigintKobo }) amountKobo: number;
  @Column() status: string;
  @Column() provider: string;
  @Column({ name: 'authorization_url', type: 'text', nullable: true }) authorizationUrl: string | null;
  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true }) paidAt: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
