export const WALLET_MESSAGES = {
  DEPOSIT_INITIATED: 'Complete your payment on Paystack',
  DEPOSIT_CREDITED: 'Your wallet has been credited',
  PAYMENT_NOT_COMPLETED: 'Payment has not been completed yet',
  DEPOSIT_NOT_FOUND: 'Deposit not found',
  ALREADY_PROCESSED: 'This deposit has already been processed',
  AMOUNT_MISMATCH: 'Paid amount does not match the deposit; our team will review it',
  UNBALANCED_TRANSACTION: 'Ledger transaction does not balance',
  WEBHOOK_ACK: 'Received',
} as const;
