import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { DepositEntity } from './wallet.entity';

@Injectable()
export class DepositsRepository {
  create(m: EntityManager, data: Partial<DepositEntity>) {
    return m.getRepository(DepositEntity).save(m.getRepository(DepositEntity).create(data));
  }
  lockByReference(m: EntityManager, reference: string, userId?: string) {
    return m.getRepository(DepositEntity).findOne({ where: userId ? { reference, userId } : { reference }, lock: { mode: 'pessimistic_write' } });
  }
  setStatus(m: EntityManager, id: string, status: string, paidAt: Date | null = null) {
    return m.getRepository(DepositEntity).update({ id }, { status, paidAt });
  }
}
