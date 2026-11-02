import { Success } from '@/common/responses';
import { ResolutionView } from '../interfaces/settlements.interface';

export const sanitizeResolution = <T extends ResolutionView | null>(r: Success<T>) => ({ ...r, data: r.data && { ...r.data } });
