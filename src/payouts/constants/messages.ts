export const PAYOUT_MESSAGES = {
  ACCOUNT_SUBMITTED: 'We are verifying your BVN with your bank. This usually takes a few minutes.',
  INVALID_BANK_ACCOUNT: 'We could not find that account number at the selected bank',
  NAME_MISMATCH: 'The bank account name does not match the name on your profile',
  PAYOUT_ACCOUNT_EXISTS: 'You already have a verified payout account. Contact support to change it.',
  VERIFICATION_IN_PROGRESS: 'Your payout account is still being verified',
  PAYOUT_ACCOUNT_NOT_VERIFIED: 'Add and verify a payout bank account before withdrawing',
  DUPLICATE_REQUEST: 'This withdrawal was already received',
  WITHDRAWAL_SENT: 'Withdrawal sent to your bank',
  WITHDRAWAL_PENDING: 'Withdrawal is processing',
  WITHDRAWAL_UNKNOWN: 'Withdrawal is processing; we will confirm it with the bank shortly',
  PARTNER_UNAVAILABLE: 'The transfer could not be made and your wallet has been refunded',
} as const;
