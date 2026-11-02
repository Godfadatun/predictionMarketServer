import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { PayoutAccountEntity, WithdrawalEntity } from './payouts.entity';

@Injectable()
export class PayoutsRepository {
  constructor(
    @InjectRepository(PayoutAccountEntity) private readonly accounts: Repository<PayoutAccountEntity>,
    @InjectRepository(WithdrawalEntity) private readonly withdrawals: Repository<WithdrawalEntity>,
  ) {}

  findAccount(userId: string) { return this.accounts.findOne({ where: { userId } }); }
  lockAccountByCustomer(m: EntityManager, paystackCustomerCode: string) {
    return m.getRepository(PayoutAccountEntity).findOne({ where: { paystackCustomerCode }, order: { createdAt: 'DESC' }, lock: { mode: 'pessimistic_write' } });
  }
  async upsertAccount(m: EntityManager, data: Partial<PayoutAccountEntity> & { userId: string }) {
    await m.getRepository(PayoutAccountEntity).upsert(data, ['userId']);
    return m.getRepository(PayoutAccountEntity).findOneOrFail({ where: { userId: data.userId } });
  }
  updateAccount(m: EntityManager, id: string, patch: Partial<PayoutAccountEntity>) { return m.getRepository(PayoutAccountEntity).update({ id }, patch); }

  findWithdrawalByKey(m: EntityManager, userId: string, idempotencyKey: string) {
    return m.getRepository(WithdrawalEntity).findOne({ where: { userId, idempotencyKey } });
  }
  createWithdrawal(m: EntityManager, data: Partial<WithdrawalEntity>) {
    return m.getRepository(WithdrawalEntity).save(m.getRepository(WithdrawalEntity).create(data));
  }
  lockWithdrawal(m: EntityManager, reference: string) {
    return m.getRepository(WithdrawalEntity).findOne({ where: { reference }, lock: { mode: 'pessimistic_write' } });
  }
  updateWithdrawal(m: EntityManager, id: string, patch: Partial<WithdrawalEntity>) { return m.getRepository(WithdrawalEntity).update({ id }, patch); }
  listWithdrawals(userId: string, limit: number) { return this.withdrawals.find({ where: { userId }, order: { createdAt: 'DESC' }, take: limit }); }
}
