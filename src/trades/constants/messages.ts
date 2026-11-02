export const TRADE_MESSAGES = {
  BOUGHT: 'Trade placed',
  SOLD: 'Shares sold',
  MARKET_NOT_FOUND: 'Market not found',
  OUTCOME_NOT_FOUND: 'Outcome not found in this market',
  MARKET_CLOSED: 'This market is no longer open for trading',
  DUPLICATE_REQUEST: 'This trade was already received',
  INSUFFICIENT_SHARES: 'You do not hold enough shares to sell',
  SLIPPAGE_EXCEEDED: 'The price moved past your limit; nothing was traded',
  HIGH_PRICE_IMPACT: 'This trade moved the price significantly',
} as const;
