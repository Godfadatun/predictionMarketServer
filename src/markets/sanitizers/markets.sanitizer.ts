import { Success } from '@/common/responses';
import { MarketView } from '../interfaces/markets.interface';

const view = (m: MarketView) => ({
  id: m.id, slug: m.slug, title: m.title, description: m.description, category: m.category, state: m.state, status: m.status,
  closesAt: m.closesAt, resolutionSource: m.resolutionSource, resolutionRules: m.resolutionRules, liquidityB: m.liquidityB,
  outcomes: m.outcomes.map((o) => ({ id: o.id, label: o.label, price: o.price, shares: o.shares })),
});

export const sanitizeMarket = (r: Success<MarketView>) => ({ ...r, data: view(r.data) });
export const sanitizeMarkets = (r: Success<MarketView[]>) => ({ ...r, data: r.data.map(view) });
