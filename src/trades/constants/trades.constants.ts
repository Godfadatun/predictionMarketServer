export const TRADE_CODES = {
  MARKET_NOT_FOUND: 'MARKET_NOT_FOUND',
  OUTCOME_NOT_FOUND: 'OUTCOME_NOT_FOUND',
  MARKET_CLOSED: 'MARKET_CLOSED',
  DUPLICATE_REQUEST: 'DUPLICATE_REQUEST',
  INSUFFICIENT_SHARES: 'INSUFFICIENT_SHARES',
  SLIPPAGE_EXCEEDED: 'SLIPPAGE_EXCEEDED',
} as const;
export const TRADE_EVENTS = { BUY: 'trades.trade.buy.success', SELL: 'trades.trade.sell.success' } as const;
export const TRADE_SIDE = { BUY: 'BUY', SELL: 'SELL' } as const;
export const TRADE_WARNINGS = { HIGH_PRICE_IMPACT: 'HIGH_PRICE_IMPACT' } as const;
export const TRADE_FEE_BPS = 200; // 2% on buys and sells, credited to HOUSE:FEES
export const HIGH_PRICE_IMPACT = 0.1; // warn when one trade moves the price by 10+ points
export const MIN_TRADE_KOBO = 10_000; // ₦100
export const MAX_TRADE_KOBO = 100_000_000; // ₦1,000,000 per trade during launch
export const SHARE_EPSILON = 1e-9;
