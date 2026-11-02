import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('audit_logs')
export class AuditLogEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column() event: string;
  @Column() module: string;
  @Column({ name: 'table_type' }) tableType: string;
  @Index() @Column({ name: 'table_id' }) tableId: string;
  @Column({ name: 'actor_id', type: 'uuid', nullable: true }) actorId: string | null;
  @Column({ name: 'session_id', type: 'uuid', nullable: true }) sessionId: string | null;
  @Column() status: 'SUCCESS' | 'FAILED';
  @Column({ type: 'jsonb', nullable: true }) meta: Record<string, unknown> | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}

@Entity('third_party_logs')
export class ThirdPartyLogEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column() provider: string;
  @Column() event: string;
  @Column() method: string;
  @Column() url: string;
  @Column({ name: 'status_code', type: 'int', nullable: true }) statusCode: number | null;
  @Column({ name: 'duration_ms', type: 'int' }) durationMs: number;
  @Column({ name: 'request_body', type: 'jsonb', nullable: true }) requestBody: unknown;
  @Column({ name: 'response_body', type: 'jsonb', nullable: true }) responseBody: unknown;
  @Column({ name: 'response_message', type: 'text', nullable: true }) responseMessage: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
