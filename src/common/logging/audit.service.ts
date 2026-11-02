import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuditLogEntity } from './log.entities';

export interface AuditRecord {
  event: string; module: string; tableType: string; tableId: string;
  actorId?: string | null; sessionId?: string | null; status?: 'SUCCESS' | 'FAILED'; meta?: Record<string, unknown>;
}

// Writes an audit row; pass the transaction manager so the audit commits or rolls back with the business write.
@Injectable()
export class AuditService {
  constructor(private readonly ds: DataSource) {}

  async record(rec: AuditRecord, manager?: EntityManager): Promise<void> {
    const m = manager ?? this.ds.manager;
    await m.insert(AuditLogEntity, { status: 'SUCCESS', actorId: null, sessionId: null, ...rec, meta: (rec.meta ?? null) as object });
  }
}
