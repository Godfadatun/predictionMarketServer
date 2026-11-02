export interface LedgerLeg { accountCode: string; amountKobo: number }
export interface PostTxInput { txRef: string; kind: string; legs: LedgerLeg[] }
export interface DepositInitInput { amountKobo: number }
export interface PaystackInitResult { reference: string; authorizationUrl: string }
export interface PaystackVerifyResult { reference: string; status: string; amountKobo: number }
export interface DepositRecord {
  id: string; userId: string; reference: string; amountKobo: number; status: string; provider: string;
  authorizationUrl: string | null; paidAt: Date | null; createdAt: Date;
}
export interface AccountRecord { id: string; code: string; kind: string; userId: string | null; balanceKobo: number; allowNegative: boolean }
export interface LedgerEntryRecord { id: string; txRef: string; accountId: string; amountKobo: number; balanceAfterKobo: number; kind: string; createdAt: Date }
export interface PaystackWebhookEvent { event: string; data: { reference: string; amount: number; status: string } & Record<string, unknown> }
