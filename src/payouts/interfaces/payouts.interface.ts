export interface SubmitAccountInput { bankCode: string; accountNumber: string; bvn: string }
export interface WithdrawInput { amountKobo: number; idempotencyKey: string }
export interface PayoutAccountRecord {
  id: string; userId: string; bankCode: string; bankName: string | null; accountNumber: string; accountName: string; bvnLast4: string;
  status: string; failureReason: string | null; paystackCustomerCode: string; recipientCode: string | null; verifiedAt: Date | null; createdAt: Date;
}
export interface WithdrawalRecord {
  id: string; userId: string; reference: string; amountKobo: number; feeKobo: number; status: string; source: string;
  failureReason: string | null; completedAt: Date | null; createdAt: Date;
}
export interface PaystackPayoutEvent { event: string; data: Record<string, any> }
export type TransferOutcome = 'ACCEPTED' | 'REJECTED' | 'UNKNOWN';
export interface TransferResult { outcome: TransferOutcome; status: string; transferCode: string | null; message?: string }
export interface Bank { name: string; code: string }
