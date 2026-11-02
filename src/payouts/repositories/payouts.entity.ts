import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { bigintKobo } from '@/common/database/bigint.transformer';

@Entity('payout_accounts')
export class PayoutAccountEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'user_id', type: 'uuid', unique: true }) userId: string;
  @Column({ name: 'bank_code' }) bankCode: string;
  @Column({ name: 'bank_name', type: 'varchar', nullable: true }) bankName: string | null;
  @Column({ name: 'account_number' }) accountNumber: string;
  @Column({ name: 'account_name' }) accountName: string;
  @Column({ name: 'bvn_last4' }) bvnLast4: string;
  @Column({ name: 'bvn_hash' }) bvnHash: string;
  @Column() status: string;
  @Column({ name: 'failure_reason', type: 'text', nullable: true }) failureReason: string | null;
  @Index() @Column({ name: 'paystack_customer_code' }) paystackCustomerCode: string;
  @Column({ name: 'recipient_code', type: 'varchar', nullable: true }) recipientCode: string | null;
  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true }) verifiedAt: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}

@Entity('withdrawals')
@Unique('uq_withdrawals_user_key', ['userId', 'idempotencyKey'])
export class WithdrawalEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column({ name: 'user_id', type: 'uuid' }) userId: string;
  @Column({ unique: true }) reference: string;
  @Column({ name: 'amount_kobo', type: 'bigint', transformer: bigintKobo }) amountKobo: number;
  @Column({ name: 'fee_kobo', type: 'bigint', default: 0, transformer: bigintKobo }) feeKobo: number;
  @Column() status: string;
  @Column({ default: 'MANUAL' }) source: string;
  @Column({ name: 'idempotency_key' }) idempotencyKey: string;
  @Column({ name: 'transfer_code', type: 'varchar', nullable: true }) transferCode: string | null;
  @Column({ name: 'failure_reason', type: 'text', nullable: true }) failureReason: string | null;
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true }) completedAt: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
