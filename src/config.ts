import 'dotenv/config';

export const config = {
  appEnv: process.env.APP_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/pm_dev',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret',
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? 72),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
  partnerTimeoutMs: Number(process.env.PARTNER_TIMEOUT_MS ?? 8000),
  paystack: {
    baseUrl: process.env.PAYSTACK_BASE_URL ?? 'https://api.paystack.co',
    secretKey: process.env.PAYSTACK_SECRET_KEY ?? 'sk_test_dev',
    callbackUrl: process.env.PAYSTACK_CALLBACK_URL ?? 'http://localhost:3000/wallet/callback',
  },
  mockSettings: (process.env.MOCK_SETTINGS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
};
