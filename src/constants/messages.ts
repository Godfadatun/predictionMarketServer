export const MESSAGES = {
  UNAUTHORIZED: 'Authentication required',
  SESSION_EXPIRED: 'Your session has expired, please log in again',
  FORBIDDEN: 'You do not have permission to do this',
  INTERNAL_ERROR: 'Something went wrong, please try again',
  PARTNER_UNAVAILABLE: 'Our payment provider is temporarily unavailable, please retry',
  INSUFFICIENT_FUNDS: 'Your wallet balance is too low for this',
} as const;

export const ERROR_CODES = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  FORBIDDEN: 'FORBIDDEN',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
} as const;

export const ROLES = { USER: 'USER', ADMIN: 'ADMIN' } as const;
export type Role = (typeof ROLES)[keyof typeof ROLES];
