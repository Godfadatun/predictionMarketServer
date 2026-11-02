/**
 * wallet.bdd.spec.ts — naira deposits via Paystack, credited through the double-entry ledger.
 * Real Postgres; Paystack mocked with nock at the HTTP boundary using PaystackMockV1 fixtures.
 *
 * CASE TABLE
 * | H1   | happy           | user, ACTIVE session                    | POST /wallet/deposits {amountKobo:500000}       | 201 PENDING + authorizationUrl     | deposits row PENDING; tpl row paystack 200; audit DEPOSIT_INITIATED |
 * | H2   | happy           | PENDING deposit, Paystack says success  | POST /wallet/deposits/:ref/verify               | 200 SUCCESS                        | deposit SUCCESS; user +500000; clearing -500000; 2 ledger legs sum 0; audit DEPOSIT_CREDITED |
 * | H3   | happy           | PENDING deposit                         | POST /wallet/webhooks/paystack charge.success   | 200                                | deposit SUCCESS; user +amount (verified with Paystack first) |
 * | H4   | happy           | user with balance 123400                | GET /wallet                                     | 200 balanceKobo 123400             | accounts row unchanged |
 * | A1   | amber           | PENDING deposit, Paystack says ongoing  | POST verify                                     | 200 PENDING + PAYMENT_NOT_COMPLETED | deposit PENDING; balance unchanged |
 * | R-V1 | red/validation  | user                                    | POST deposits {amountKobo: 5000} (< ₦100)       | 400 VALIDATION_ERROR               | no deposit row; no Paystack call |
 * | R-V2 | red/validation  | user                                    | POST deposits {amountKobo: 600000000} (> ₦5m)   | 400 VALIDATION_ERROR               | no deposit row |
 * | R-V3 | red/validation  | user                                    | POST deposits {}                                | 400 VALIDATION_ERROR               | no deposit row |
 * | R-G1 | red/guard       | no session                              | POST deposits                                   | 401 UNAUTHORIZED                   | no deposit row |
 * | R-G2 | red/guard       | expired session                         | POST deposits                                   | 401 SESSION_EXPIRED                | no deposit row |
 * | R-M1 | red/middleware  | PENDING deposit                         | POST webhook with bad signature                 | 401 INVALID_SIGNATURE              | deposit PENDING; balance unchanged |
 * | R-T1 | red/3rd-party   | Paystack initialize returns 500         | POST deposits                                   | 502 PARTNER_UNAVAILABLE            | no deposit row; tpl row status 500 |
 * | R-T2 | red/3rd-party   | Paystack initialize times out           | POST deposits                                   | 502 PARTNER_UNAVAILABLE            | no deposit row; tpl row status null |
 * | R-T3 | red/3rd-party   | Paystack verify returns malformed body  | POST verify                                     | 502 PARTNER_UNAVAILABLE            | deposit PENDING; balance unchanged |
 * | R-C1 | red/concurrency | PENDING deposit                         | 2× POST verify in parallel                      | 200 + 422                          | credited exactly once |
 * | R-S1 | red/data-state  | deposit already SUCCESS                 | POST verify                                     | 422 ALREADY_PROCESSED              | balance unchanged; no Paystack call |
 * | R-S2 | red/data-state  | Paystack paid amount ≠ deposit amount   | POST verify                                     | 422 AMOUNT_MISMATCH                | deposit FLAGGED; balance unchanged |
 * | R-S3 | red/data-state  | deposit belongs to another user         | POST verify                                     | 404 DEPOSIT_NOT_FOUND              | deposit unchanged |
 * | R-S4 | red/data-state  | deposit already SUCCESS                 | webhook replay charge.success                   | 200                                | balance unchanged; no new ledger rows |
 */
import nock from 'nock';
import request from 'supertest';
import { ctx, db, paystackSignature, SeededUser } from '../../../test/bootstrap';
import { PaystackMockV1 } from '../integrations/paystack/mocks/v1';
import { ACCOUNTS, WALLET_EVENTS } from '../constants/wallet.constants';

const PAYSTACK = 'https://paystack.test';
const paystack = new PaystackMockV1();

describe('Wallet deposits — Happy paths', () => {
  const fx: Record<string, any> = {};
  beforeAll(async () => {
    await db.ensureSystemAccounts();
    fx.H1 = await db.seedUser();
    fx.H2 = await db.seedUser();
    fx.H2dep = await db.seedDeposit(fx.H2.user.id, { amountKobo: 500000 });
    fx.H3 = await db.seedUser();
    fx.H3dep = await db.seedDeposit(fx.H3.user.id, { amountKobo: 250000 });
    fx.H4 = await db.seedUser({ balanceKobo: 123400 });
  });
  afterAll(async () => { await db.clean([fx.H1, fx.H2, fx.H3, fx.H4] as SeededUser[]); await db.cleanPartnerLogs('paystack'); nock.cleanAll(); });

  it('H1 — given an active user, when they start a ₦5,000 deposit, then a PENDING deposit and a Paystack checkout link are created', async () => {
    nock(PAYSTACK).post('/transaction/initialize').reply(200, (_u, body: any) => paystack.initializeBody(body.reference));

    const res = await request(ctx.http).post('/wallet/deposits').set(fx.H1.auth).send({ amountKobo: 500000 });

    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ reference: expect.stringMatching(/^dep_/), amountKobo: 500000, status: 'PENDING', authorizationUrl: `https://checkout.paystack.com/${res.body.data.reference}` });
    expect(await db.findOne('deposits', { reference: res.body.data.reference })).toMatchObject({ user_id: fx.H1.user.id, status: 'PENDING', provider: 'paystack' });
    expect(await db.findOne('third_party_logs', { provider: 'paystack', event: 'paystack.transaction.initialize' })).toMatchObject({ status_code: 200, method: 'POST' });
    expect(await db.findOne('audit_logs', { event: WALLET_EVENTS.DEPOSIT_INITIATED, actor_id: fx.H1.user.id })).toMatchObject({ status: 'SUCCESS', session_id: fx.H1.sessionId });
  });

  it('H2 — given a PENDING deposit that Paystack confirms, when the user verifies it, then the wallet is credited through a balanced ledger transaction', async () => {
    const clearingBefore = await db.balance(ACCOUNTS.PAYSTACK_CLEARING);
    nock(PAYSTACK).get(`/transaction/verify/${fx.H2dep.reference}`).reply(200, paystack.verifyBody(fx.H2dep.reference, 500000));

    const res = await request(ctx.http).post(`/wallet/deposits/${fx.H2dep.reference}/verify`).set(fx.H2.auth).send({});

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ reference: fx.H2dep.reference, amountKobo: 500000, status: 'SUCCESS', balanceKobo: 500000 });
    expect(await db.findOne('deposits', { id: fx.H2dep.id })).toMatchObject({ status: 'SUCCESS' });
    expect(await db.balance(ACCOUNTS.user(fx.H2.user.id))).toBe(500000);
    expect(await db.balance(ACCOUNTS.PAYSTACK_CLEARING)).toBe(clearingBefore - 500000);
    const legs = await db.findMany('ledger_entries', { tx_ref: `deposit:${fx.H2dep.reference}` });
    expect(legs.map((l) => Number(l.amount_kobo)).sort((a, b) => a - b)).toEqual([-500000, 500000]);
    expect(await db.findOne('audit_logs', { event: WALLET_EVENTS.DEPOSIT_CREDITED, table_id: fx.H2dep.id })).toMatchObject({ status: 'SUCCESS', actor_id: fx.H2.user.id });
  });

  it('H3 — given a PENDING deposit, when Paystack sends a signed charge.success webhook, then the deposit is re-verified with Paystack and credited', async () => {
    const event = paystack.chargeSuccessEvent(fx.H3dep.reference, 250000);
    nock(PAYSTACK).get(`/transaction/verify/${fx.H3dep.reference}`).reply(200, paystack.verifyBody(fx.H3dep.reference, 250000));

    const res = await request(ctx.http).post('/wallet/webhooks/paystack').set('x-paystack-signature', paystackSignature(event)).send(event);

    expect(res.status).toBe(200);
    expect(await db.findOne('deposits', { id: fx.H3dep.id })).toMatchObject({ status: 'SUCCESS' });
    expect(await db.balance(ACCOUNTS.user(fx.H3.user.id))).toBe(250000);
    expect(nock.isDone()).toBe(true);
  });

  it('H4 — given a user with ₦1,234 in their wallet, when they fetch the wallet, then the balance matches the ledger account', async () => {
    const res = await request(ctx.http).get('/wallet').set(fx.H4.auth);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ balanceKobo: 123400, currency: 'NGN' });
    expect(await db.balance(ACCOUNTS.user(fx.H4.user.id))).toBe(123400);
  });
});

describe('Wallet deposits — Amber paths', () => {
  const fx: Record<string, any> = {};
  beforeAll(async () => {
    await db.ensureSystemAccounts();
    fx.A1 = await db.seedUser();
    fx.A1dep = await db.seedDeposit(fx.A1.user.id, { amountKobo: 300000 });
  });
  afterAll(async () => { await db.clean([fx.A1]); await db.cleanPartnerLogs('paystack'); nock.cleanAll(); });

  it('A1 — given Paystack reports the payment as ongoing, when the user verifies, then the deposit stays PENDING with a warning and nothing is credited', async () => {
    nock(PAYSTACK).get(`/transaction/verify/${fx.A1dep.reference}`).reply(200, paystack.verifyBody(fx.A1dep.reference, 300000, 'ongoing'));

    const res = await request(ctx.http).post(`/wallet/deposits/${fx.A1dep.reference}/verify`).set(fx.A1.auth).send({});

    expect(res.status).toBe(200);
    expect(res.body.warnings).toEqual(['PAYMENT_NOT_COMPLETED']);
    expect(res.body.data).toEqual({ reference: fx.A1dep.reference, amountKobo: 300000, status: 'PENDING', balanceKobo: 0 });
    expect(await db.findOne('deposits', { id: fx.A1dep.id })).toMatchObject({ status: 'PENDING' });
    expect(await db.balance(ACCOUNTS.user(fx.A1.user.id))).toBe(0);
  });
});

describe('Wallet deposits — Red paths', () => {
  const fx: Record<string, any> = {};
  beforeAll(async () => {
    await db.ensureSystemAccounts();
    fx.RV = await db.seedUser();
    fx.RG2 = await db.seedUser({ sessionExpired: true });
    fx.RM1 = await db.seedUser();
    fx.RM1dep = await db.seedDeposit(fx.RM1.user.id, { amountKobo: 100000 });
    fx.RT = await db.seedUser();
    fx.RT3 = await db.seedUser();
    fx.RT3dep = await db.seedDeposit(fx.RT3.user.id, { amountKobo: 100000 });
    fx.RC1 = await db.seedUser();
    fx.RC1dep = await db.seedDeposit(fx.RC1.user.id, { amountKobo: 700000 });
    fx.RS1 = await db.seedUser({ balanceKobo: 200000 });
    fx.RS1dep = await db.seedDeposit(fx.RS1.user.id, { amountKobo: 200000, status: 'SUCCESS' });
    fx.RS2 = await db.seedUser();
    fx.RS2dep = await db.seedDeposit(fx.RS2.user.id, { amountKobo: 500000 });
    fx.RS3owner = await db.seedUser();
    fx.RS3other = await db.seedUser();
    fx.RS3dep = await db.seedDeposit(fx.RS3owner.user.id, { amountKobo: 100000 });
    fx.RS4 = await db.seedUser({ balanceKobo: 150000 });
    fx.RS4dep = await db.seedDeposit(fx.RS4.user.id, { amountKobo: 150000, status: 'SUCCESS' });
  });
  afterAll(async () => {
    await db.clean([fx.RV, fx.RG2, fx.RM1, fx.RT, fx.RT3, fx.RC1, fx.RS1, fx.RS2, fx.RS3owner, fx.RS3other, fx.RS4]);
    await db.cleanPartnerLogs('paystack');
    nock.cleanAll();
  });

  it('R-V1 — given an active user, when the deposit is below ₦100, then 400 VALIDATION_ERROR and nothing is written', async () => {
    const res = await request(ctx.http).post('/wallet/deposits').set(fx.RV.auth).send({ amountKobo: 5000 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(await db.count('deposits', { user_id: fx.RV.user.id })).toBe(0);
  });

  it('R-V2 — given an active user, when the deposit is above ₦5,000,000, then 400 VALIDATION_ERROR and nothing is written', async () => {
    const res = await request(ctx.http).post('/wallet/deposits').set(fx.RV.auth).send({ amountKobo: 600000000 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(await db.count('deposits', { user_id: fx.RV.user.id })).toBe(0);
  });

  it('R-V3 — given an active user, when amountKobo is missing, then 400 VALIDATION_ERROR and nothing is written', async () => {
    const res = await request(ctx.http).post('/wallet/deposits').set(fx.RV.auth).send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(await db.count('deposits', { user_id: fx.RV.user.id })).toBe(0);
  });

  it('R-G1 — given no session, when a deposit is started, then 401 UNAUTHORIZED and nothing is written', async () => {
    const before = await db.count('deposits');
    const res = await request(ctx.http).post('/wallet/deposits').send({ amountKobo: 500000 });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
    expect(await db.count('deposits')).toBe(before);
  });

  it('R-G2 — given an expired session, when a deposit is started, then 401 SESSION_EXPIRED and nothing is written', async () => {
    const res = await request(ctx.http).post('/wallet/deposits').set(fx.RG2.auth).send({ amountKobo: 500000 });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('SESSION_EXPIRED');
    expect(await db.count('deposits', { user_id: fx.RG2.user.id })).toBe(0);
  });

  it('R-M1 — given a PENDING deposit, when a webhook arrives with a bad signature, then 401 INVALID_SIGNATURE and nothing changes', async () => {
    const event = paystack.chargeSuccessEvent(fx.RM1dep.reference, 100000);
    const res = await request(ctx.http).post('/wallet/webhooks/paystack').set('x-paystack-signature', 'forged').send(event);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_SIGNATURE');
    expect(await db.findOne('deposits', { id: fx.RM1dep.id })).toMatchObject({ status: 'PENDING' });
    expect(await db.balance(ACCOUNTS.user(fx.RM1.user.id))).toBe(0);
  });

  it('R-T1 — given Paystack initialize returns 500, when a deposit is started, then 502 PARTNER_UNAVAILABLE, no deposit row and a logged partner call', async () => {
    await db.cleanPartnerLogs('paystack');
    nock(PAYSTACK).post('/transaction/initialize').reply(500, paystack.serverErrorBody());
    const res = await request(ctx.http).post('/wallet/deposits').set(fx.RT.auth).send({ amountKobo: 500000 });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('PARTNER_UNAVAILABLE');
    expect(await db.count('deposits', { user_id: fx.RT.user.id })).toBe(0);
    expect(await db.findOne('third_party_logs', { provider: 'paystack', event: 'paystack.transaction.initialize' })).toMatchObject({ status_code: 500 });
  });

  it('R-T2 — given Paystack initialize times out, when a deposit is started, then 502 PARTNER_UNAVAILABLE, no deposit row and a partner log with null status', async () => {
    await db.cleanPartnerLogs('paystack');
    nock(PAYSTACK).post('/transaction/initialize').delayConnection(1500).reply(200, paystack.initializeBody('late'));
    const res = await request(ctx.http).post('/wallet/deposits').set(fx.RT.auth).send({ amountKobo: 500000 });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('PARTNER_UNAVAILABLE');
    expect(await db.count('deposits', { user_id: fx.RT.user.id })).toBe(0);
    expect(await db.findOne('third_party_logs', { provider: 'paystack', event: 'paystack.transaction.initialize' })).toMatchObject({ status_code: null, response_message: expect.stringMatching(/timeout/i) });
  });

  it('R-T3 — given Paystack verify returns a malformed body, when the user verifies, then 502 PARTNER_UNAVAILABLE and the deposit stays PENDING', async () => {
    nock(PAYSTACK).get(`/transaction/verify/${fx.RT3dep.reference}`).reply(200, paystack.malformedBody());
    const res = await request(ctx.http).post(`/wallet/deposits/${fx.RT3dep.reference}/verify`).set(fx.RT3.auth).send({});
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('PARTNER_UNAVAILABLE');
    expect(await db.findOne('deposits', { id: fx.RT3dep.id })).toMatchObject({ status: 'PENDING' });
    expect(await db.balance(ACCOUNTS.user(fx.RT3.user.id))).toBe(0);
  });

  it('R-C1 — given a PENDING deposit, when two verifies run in parallel, then one credits and the other is rejected, so the wallet is credited once', async () => {
    nock(PAYSTACK).get(`/transaction/verify/${fx.RC1dep.reference}`).twice().reply(200, paystack.verifyBody(fx.RC1dep.reference, 700000));
    const [a, b] = await Promise.all([
      request(ctx.http).post(`/wallet/deposits/${fx.RC1dep.reference}/verify`).set(fx.RC1.auth).send({}),
      request(ctx.http).post(`/wallet/deposits/${fx.RC1dep.reference}/verify`).set(fx.RC1.auth).send({}),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 422]);
    expect(await db.balance(ACCOUNTS.user(fx.RC1.user.id))).toBe(700000);
    expect(await db.count('ledger_entries', { tx_ref: `deposit:${fx.RC1dep.reference}` })).toBe(2);
  });

  it('R-S1 — given a deposit already credited, when the user verifies again, then 422 ALREADY_PROCESSED and the balance is unchanged', async () => {
    const res = await request(ctx.http).post(`/wallet/deposits/${fx.RS1dep.reference}/verify`).set(fx.RS1.auth).send({});
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('ALREADY_PROCESSED');
    expect(await db.balance(ACCOUNTS.user(fx.RS1.user.id))).toBe(200000);
    expect(await db.count('ledger_entries', { tx_ref: `deposit:${fx.RS1dep.reference}` })).toBe(0);
  });

  it('R-S2 — given Paystack reports a different paid amount, when the user verifies, then 422 AMOUNT_MISMATCH, the deposit is FLAGGED and nothing is credited', async () => {
    nock(PAYSTACK).get(`/transaction/verify/${fx.RS2dep.reference}`).reply(200, paystack.verifyBody(fx.RS2dep.reference, 100000));
    const res = await request(ctx.http).post(`/wallet/deposits/${fx.RS2dep.reference}/verify`).set(fx.RS2.auth).send({});
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('AMOUNT_MISMATCH');
    expect(await db.findOne('deposits', { id: fx.RS2dep.id })).toMatchObject({ status: 'FLAGGED' });
    expect(await db.balance(ACCOUNTS.user(fx.RS2.user.id))).toBe(0);
    expect(await db.findOne('audit_logs', { event: WALLET_EVENTS.DEPOSIT_FLAGGED, table_id: fx.RS2dep.id })).toMatchObject({ status: 'FAILED' });
  });

  it("R-S3 — given a deposit owned by someone else, when a user verifies it, then 404 DEPOSIT_NOT_FOUND and the deposit is unchanged", async () => {
    const res = await request(ctx.http).post(`/wallet/deposits/${fx.RS3dep.reference}/verify`).set(fx.RS3other.auth).send({});
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('DEPOSIT_NOT_FOUND');
    expect(await db.findOne('deposits', { id: fx.RS3dep.id })).toMatchObject({ status: 'PENDING' });
  });

  it('R-S4 — given a deposit already credited, when Paystack replays charge.success, then 200 is acknowledged and nothing is credited twice', async () => {
    const event = paystack.chargeSuccessEvent(fx.RS4dep.reference, 150000);
    const res = await request(ctx.http).post('/wallet/webhooks/paystack').set('x-paystack-signature', paystackSignature(event)).send(event);
    expect(res.status).toBe(200);
    expect(await db.balance(ACCOUNTS.user(fx.RS4.user.id))).toBe(150000);
    expect(await db.count('ledger_entries', { tx_ref: `deposit:${fx.RS4dep.reference}` })).toBe(0);
  });
});
