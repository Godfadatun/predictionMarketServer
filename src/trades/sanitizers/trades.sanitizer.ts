import { Success } from '@/common/responses';
import { PositionView } from '../interfaces/trades.interface';

export const sanitizePositions = (r: Success<PositionView[]>) => ({
  ...r, data: r.data.map((p) => ({ ...p, shares: Number(p.shares), costKobo: Number(p.costKobo), payoutKobo: Number(p.payoutKobo) })),
});
