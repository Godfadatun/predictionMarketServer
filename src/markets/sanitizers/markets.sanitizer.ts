import { Success } from '@/common/responses';
import { MarketView } from '../interfaces/markets.interface';

const CREATED = 201;
const OK = 200;

const view = (m: MarketView) => ({
  id: m.id, slug: m.slug, title: m.title, description: m.description, category: m.category, state: m.state, status: m.status,
  closesAt: m.closesAt, resolutionSource: m.resolutionSource, resolutionRules: m.resolutionRules, liquidityB: m.liquidityB,
  tradeCount: m.tradeCount, volumeKobo: m.volumeKobo,
  outcomes: m.outcomes.map((o) => ({ id: o.id, label: o.label, price: o.price, shares: o.shares })),
});

export const sanitizeMarket = (r: Success<MarketView>) => ({ ...r, data: view(r.data) });
export const sanitizeMarkets = (r: Success<MarketView[]>) => ({ ...r, data: r.data.map(view) });
// Template calls are idempotent: a newly created market is 201, an existing one is 200.
export const templateStatus = (r: Success<MarketView>) => (r.warnings?.length ? OK : CREATED);
