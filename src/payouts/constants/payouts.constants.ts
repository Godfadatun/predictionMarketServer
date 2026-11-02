export const PAYOUT_CODES = {
  INVALID_BANK_ACCOUNT: 'INVALID_BANK_ACCOUNT',
  NAME_MISMATCH: 'NAME_MISMATCH',
  PAYOUT_ACCOUNT_EXISTS: 'PAYOUT_ACCOUNT_EXISTS',
  VERIFICATION_IN_PROGRESS: 'VERIFICATION_IN_PROGRESS',
  PAYOUT_ACCOUNT_NOT_VERIFIED: 'PAYOUT_ACCOUNT_NOT_VERIFIED',
  DUPLICATE_REQUEST: 'DUPLICATE_REQUEST',
  PARTNER_UNAVAILABLE: 'PARTNER_UNAVAILABLE',
} as const;
export const PAYOUT_EVENTS = {
  ACCOUNT_SUBMITTED: 'payouts.account.submit.success',
  ACCOUNT_VERIFIED: 'payouts.account.verify.success',
  ACCOUNT_REJECTED: 'payouts.account.verify.failed',
  WITHDRAWAL_CREATED: 'payouts.withdrawal.create.success',
  WITHDRAWAL_SETTLED: 'payouts.withdrawal.settle.success',
  WITHDRAWAL_FAILED: 'payouts.withdrawal.settle.failed',
} as const;
export const PAYOUT_ACCOUNT_STATUS = { PENDING: 'PENDING_VERIFICATION', VERIFIED: 'VERIFIED', FAILED: 'FAILED' } as const;
export const WITHDRAWAL_STATUS = { PENDING: 'PENDING', SUCCESS: 'SUCCESS', FAILED: 'FAILED', REVERSED: 'REVERSED' } as const;
export const WITHDRAWAL_SOURCE = { MANUAL: 'MANUAL', AUTO_PAYOUT: 'AUTO_PAYOUT' } as const;
export const PAYOUT_WARNINGS = { TRANSFER_PENDING: 'TRANSFER_PENDING', TRANSFER_STATUS_UNKNOWN: 'TRANSFER_STATUS_UNKNOWN' } as const;
export const PAYSTACK_PAYOUT_EVENTS = {
  IDENTIFICATION_SUCCESS: 'customeridentification.success',
  IDENTIFICATION_FAILED: 'customeridentification.failed',
  TRANSFER_SUCCESS: 'transfer.success',
  TRANSFER_FAILED: 'transfer.failed',
  TRANSFER_REVERSED: 'transfer.reversed',
} as const;
export const PAYSTACK_TRANSFER_STATUS = { SUCCESS: 'success', FAILED: 'failed', REVERSED: 'reversed' } as const;
export const WITHDRAWAL_LIMITS_KOBO = { MIN: 50_000, MAX: 500_000_000 } as const; // ₦500 – ₦5,000,000
export const AUTO_PAYOUT_MIN_KOBO = 100_000; // winnings of ₦1,000+ are sent to the bank automatically
// Paystack NGN transfer fees (absorbed by the house): ≤₦5k ₦10, ≤₦50k ₦25, above ₦50.
export const TRANSFER_FEE_TIERS_KOBO = [{ upTo: 500_000, fee: 1_000 }, { upTo: 5_000_000, fee: 2_500 }, { upTo: Infinity, fee: 5_000 }] as const;
export const NAME_MATCH_MIN_TOKENS = 2;
export const BANKS_CACHE_MS = 24 * 3_600_000;
export const TRANSFER_OUTCOME = { ACCEPTED: 'ACCEPTED', REJECTED: 'REJECTED', UNKNOWN: 'UNKNOWN' } as const;
