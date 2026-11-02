export const AUTH_CODES = {
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  PHONE_TAKEN: 'PHONE_TAKEN',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
} as const;
export const AUTH_EVENTS = {
  REGISTERED: 'auth.user.register.success',
  LOGGED_IN: 'auth.session.create.success',
  LOGGED_OUT: 'auth.session.revoke.success',
} as const;
export const USER_STATUS = { ACTIVE: 'ACTIVE', SUSPENDED: 'SUSPENDED' } as const;
export const NG_PHONE = /^(\+234|0)[789][01]\d{8}$/;
export const BCRYPT_ROUNDS = 10;
