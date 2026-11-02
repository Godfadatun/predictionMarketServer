process.env.APP_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/pm_test';
process.env.JWT_SECRET = 'test-secret';
process.env.PAYSTACK_BASE_URL = 'https://paystack.test';
process.env.PAYSTACK_SECRET_KEY = 'sk_test_bdd';
process.env.PARTNER_TIMEOUT_MS = '1000';
