import { Injectable, OnModuleInit } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AppError, UnprocessableError } from '@/errors';
import { ERROR_CODES, MESSAGES } from '@/constants/messages';
import { LedgerRepository } from '../repositories/ledger.repository';
import { WALLET_CODES } from '../constants/wallet.constants';
import { WALLET_MESSAGES } from '../constants/messages';
import { PostTxInput } from '../interfaces/wallet.interface';

// Double-entry ledger: every transaction's legs sum to zero; balances move only through post().
@Injectable()
export class LedgerService implements OnModuleInit {
  constructor(private readonly repo: LedgerRepository) {}

  async onModuleInit() { await this.repo.ensureSystemAccounts(); }

  async post(m: EntityManager, tx: PostTxInput) {
    const legs = tx.legs.filter((l) => l.amountKobo !== 0);
    const sum = legs.reduce((s, l) => s + l.amountKobo, 0);
    if (sum !== 0 || legs.some((l) => !Number.isInteger(l.amountKobo))) throw new AppError(WALLET_CODES.UNBALANCED_TRANSACTION, WALLET_MESSAGES.UNBALANCED_TRANSACTION, 500);
    const locked = await this.repo.lockAccounts(m, legs.map((l) => l.accountCode));
    const byCode = new Map(locked.map((a) => [a.code, a]));
    const overdrawn = legs.some((l) => !byCode.get(l.accountCode)!.allowNegative && byCode.get(l.accountCode)!.balanceKobo + l.amountKobo < 0);
    if (overdrawn) throw new UnprocessableError(ERROR_CODES.INSUFFICIENT_FUNDS, MESSAGES.INSUFFICIENT_FUNDS);
    return this.repo.applyLegs(m, tx.txRef, tx.kind, legs, locked);
  }

  async lockedBalance(m: EntityManager, code: string): Promise<number> {
    const [acc] = await this.repo.lockAccounts(m, [code]);
    return this.repo.balance(acc.code, m);
  }

  balance(code: string, m?: EntityManager) { return this.repo.balance(code, m); }
  entries(code: string, limit: number) { return this.repo.entriesFor(code, limit); }
}
