import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { ACCOUNT_KIND, ACCOUNTS } from '../constants/wallet.constants';
import { LedgerLeg } from '../interfaces/wallet.interface';
import { AccountEntity, LedgerEntryEntity } from './wallet.entity';

const SYSTEM = [
  { code: ACCOUNTS.FEES, allowNegative: false },
  { code: ACCOUNTS.SUBSIDY, allowNegative: true },
  { code: ACCOUNTS.PAYSTACK_CLEARING, allowNegative: true },
];
const kindOf = (code: string) => code.startsWith('USER:') ? ACCOUNT_KIND.USER : code.startsWith('MARKET:') ? ACCOUNT_KIND.MARKET : ACCOUNT_KIND.SYSTEM;

@Injectable()
export class LedgerRepository {
  constructor(
    @InjectRepository(AccountEntity) private readonly accounts: Repository<AccountEntity>,
    @InjectRepository(LedgerEntryEntity) private readonly entries: Repository<LedgerEntryEntity>,
  ) {}

  async ensureSystemAccounts() {
    for (const a of SYSTEM)
      await this.accounts.createQueryBuilder().insert().values({ code: a.code, kind: ACCOUNT_KIND.SYSTEM, allowNegative: a.allowNegative, balanceKobo: 0 }).orIgnore().execute();
  }

  // Creates missing USER/MARKET accounts, then row-locks every account in code order (deadlock-safe).
  async lockAccounts(m: EntityManager, codes: string[]): Promise<AccountEntity[]> {
    const sorted = [...new Set(codes)].sort();
    const missing = sorted.filter((c) => kindOf(c) !== ACCOUNT_KIND.SYSTEM).map((code) => ({
      code, kind: kindOf(code), userId: kindOf(code) === ACCOUNT_KIND.USER ? code.slice(5) : null, balanceKobo: 0, allowNegative: false,
    }));
    if (missing.length) await m.createQueryBuilder().insert().into(AccountEntity).values(missing).orIgnore().execute();
    return m.getRepository(AccountEntity).createQueryBuilder('a').setLock('pessimistic_write')
      .where({ code: In(sorted) }).orderBy('a.code', 'ASC').getMany();
  }

  async applyLegs(m: EntityManager, txRef: string, kind: string, legs: LedgerLeg[], locked: AccountEntity[]) {
    const byCode = new Map(locked.map((a) => [a.code, a]));
    for (const leg of legs) {
      const acc = byCode.get(leg.accountCode)!;
      acc.balanceKobo += leg.amountKobo;
      await m.getRepository(AccountEntity).update({ id: acc.id }, { balanceKobo: acc.balanceKobo });
      await m.getRepository(LedgerEntryEntity).insert({ txRef, kind, accountId: acc.id, amountKobo: leg.amountKobo, balanceAfterKobo: acc.balanceKobo });
    }
    return locked;
  }

  async balance(code: string, m?: EntityManager): Promise<number> {
    const acc = await (m ?? this.accounts.manager).getRepository(AccountEntity).findOne({ where: { code } });
    return acc?.balanceKobo ?? 0;
  }

  async entriesFor(code: string, limit: number) {
    const acc = await this.accounts.findOne({ where: { code } });
    return acc ? this.entries.find({ where: { accountId: acc.id }, order: { createdAt: 'DESC' }, take: limit }) : [];
  }
}
