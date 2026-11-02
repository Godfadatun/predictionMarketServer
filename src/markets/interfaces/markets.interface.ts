export interface MarketFilters { category?: string; state?: string; status?: string; limit: number; offset: number }
export interface CreateMarketInput {
  slug: string; title: string; description: string; category: string; state?: string | null; closesAt: Date;
  resolutionSource: string; resolutionRules: string; liquidityB: number; outcomes: string[];
}
export interface OutcomeRecord { id: string; marketId: string; label: string; shares: number; sortOrder: number }
export interface MarketRecord {
  id: string; slug: string; title: string; description: string; category: string; state: string | null; status: string;
  liquidityB: number; closesAt: Date; resolutionSource: string; resolutionRules: string; createdAt: Date;
}
export interface MarketView extends MarketRecord { outcomes: (OutcomeRecord & { price: number })[] }
