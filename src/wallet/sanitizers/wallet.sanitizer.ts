import { Success } from '@/common/responses';
import { DepositRecord, LedgerEntryRecord } from '../interfaces/wallet.interface';

export const sanitizeDeposit = (r: Success<DepositRecord>) => ({
  ...r, data: { reference: r.data.reference, amountKobo: r.data.amountKobo, status: r.data.status, authorizationUrl: r.data.authorizationUrl },
});

export const sanitizeLedger = (r: Success<LedgerEntryRecord[]>) => ({
  ...r, data: r.data.map((e) => ({ id: e.id, kind: e.kind, amountKobo: e.amountKobo, balanceAfterKobo: e.balanceAfterKobo, createdAt: e.createdAt })),
});
