export const SETTLEMENT_MESSAGES = {
  PROPOSED: 'Resolution proposed; a second admin must confirm it',
  RESOLVED: 'Market resolved and winners paid',
  VOIDED: 'Market voided and stakes refunded',
  MARKET_NOT_FOUND: 'Market not found',
  OUTCOME_NOT_FOUND: 'Outcome not found in this market',
  MARKET_STILL_OPEN: 'Market is still open for trading',
  RESOLUTION_ALREADY_PROPOSED: 'A resolution is already pending or final for this market',
  NO_PENDING_RESOLUTION: 'There is no pending resolution to confirm',
  FOUR_EYES_REQUIRED: 'A different admin must confirm this resolution',
} as const;
