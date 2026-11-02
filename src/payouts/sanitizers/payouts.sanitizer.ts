import { Success } from '@/common/responses';
import { WITHDRAWAL_STATUS } from '../constants/payouts.constants';
import { PayoutAccountRecord, WithdrawalRecord } from '../interfaces/payouts.interface';

const CREATED = 201;
const ACCEPTED = 202;
const mask = (n: string) => `******${n.slice(-4)}`;

const account = (a: PayoutAccountRecord) => ({
  bankCode: a.bankCode, bankName: a.bankName, accountNumber: mask(a.accountNumber), accountName: a.accountName,
  status: a.status, failureReason: a.failureReason, verifiedAt: a.verifiedAt,
});
export const sanitizeAccount = (r: Success<PayoutAccountRecord | null>) => ({ ...r, data: r.data && account(r.data) });
export const sanitizeWithdrawals = (r: Success<WithdrawalRecord[]>) => ({
  ...r, data: r.data.map((w) => ({ reference: w.reference, amountKobo: w.amountKobo, status: w.status, source: w.source, createdAt: w.createdAt, completedAt: w.completedAt })),
});
// A transfer Paystack completed is 201; one still processing (or of unknown status) is 202.
export const withdrawalStatus = (r: Success<{ status: string }>) => (r.data.status === WITHDRAWAL_STATUS.SUCCESS ? CREATED : ACCEPTED);
