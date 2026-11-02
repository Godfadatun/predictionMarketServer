import { ValueTransformer } from 'typeorm';

// Money is stored as BIGINT kobo; node-postgres returns BIGINT as string, so convert at the column.
export const bigintKobo: ValueTransformer = {
  to: (v?: number | null) => v,
  from: (v?: string | null) => (v === null || v === undefined ? v : Number(v)),
};
