export interface PlaceTradeInput {
  outcomeId: string; side: 'BUY' | 'SELL'; amountKobo?: number; shares?: number; idempotencyKey: string;
  minShares?: number; minProceedsKobo?: number;
}
export interface Fill { shares: number; amountKobo: number; feeKobo: number; legs: { accountCode: string; amountKobo: number }[]; positionShares: number; positionCost: number }
export interface TradeResult {
  trade: { id: string; side: string; outcomeId: string; shares: number; amountKobo: number; feeKobo: number; priceBefore: number; priceAfter: number };
  balanceKobo: number;
  position: { outcomeId: string; shares: number; costKobo: number };
  prices: { outcomeId: string; price: number }[];
}
export interface PositionView {
  id: string; marketId: string; outcomeId: string; shares: number; costKobo: number; payoutKobo: number;
  marketTitle: string; marketSlug: string; marketStatus: string; outcomeLabel: string;
}
