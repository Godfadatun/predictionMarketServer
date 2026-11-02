// In-process events shared by more than one feature.
export const APP_EVENTS = {
  PAYSTACK_WEBHOOK: 'paystack.webhook.received',
  MARKET_SETTLED: 'settlements.market.settled',
} as const;
export interface MarketSettledEvent { marketId: string; isVoid: boolean; payouts: { userId: string; amountKobo: number }[] }
