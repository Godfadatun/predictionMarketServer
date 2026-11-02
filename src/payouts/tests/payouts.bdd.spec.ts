/**
 * payouts.bdd.spec.ts — payout bank account + BVN KYC (Paystack), withdrawals, and auto-payout of winnings on settlement.
 * Real Postgres; Paystack mocked with nock using PaystackPayoutsMockV1 fixtures.
 *
 * CASE TABLE
 * | H1   | happy           | user "Ada Obi"; bank name "OBI ADA CHIOMA"     | POST /payouts/account                         | 202 PENDING_VERIFICATION      | row pending; bvn_last4 only; customer + identification called; tpl rows; audit |
 * | H2   | happy           | PENDING account                                | webhook customeridentification.success        | 200                           | recipient created; status VERIFIED; recipient_code saved |
 * | H3   | happy           | VERIFIED; balance ₦10,000                      | POST withdrawals ₦5,000; transfer success     | 201 SUCCESS                   | user 500000; in-flight 0; clearing +amt+fee; fee ₦10 from transfer-fees; row SUCCESS |
 * | H4   | happy           | PENDING withdrawal (in flight)                 | webhook transfer.success                      | 200                           | row SUCCESS; in-flight −amt; clearing +amt |
 * | H5   | happy           | winner (VERIFIED) holds 10 shares; pending res.| admin B confirms                              | 200                           | AUTO_PAYOUT withdrawal ₦1,000 SUCCESS; user balance back to 0 |
 * | A1   | amber           | VERIFIED; balance ₦10,000                      | withdraw; Paystack says pending               | 202 PENDING + TRANSFER_PENDING | user debited; funds held in flight |
 * | A2   | amber           | VERIFIED; balance ₦10,000                      | withdraw; Paystack times out                  | 202 PENDING + TRANSFER_STATUS_UNKNOWN | user debited; NOT refunded; row PENDING |
 * | A3   | amber           | winner holds 6 shares (₦600 < ₦1,000)          | admin B confirms                              | 200                           | no withdrawal; ₦600 stays in wallet |
 * | A4   | amber           | PENDING account                                | webhook customeridentification.failed         | 200                           | status FAILED with reason; no recipient |
 * | R-V1 | red/validation  | user                                           | account number with 9 digits                  | 400 VALIDATION_ERROR          | no row; no Paystack call |
 * | R-V2 | red/validation  | user                                           | BVN missing                                   | 400 VALIDATION_ERROR          | no row |
 * | R-V3 | red/validation  | VERIFIED                                       | withdraw ₦100 (< ₦500)                        | 400 VALIDATION_ERROR          | no withdrawal; balance unchanged |
 * | R-G1 | red/guard       | no session                                     | POST /payouts/account                         | 401 UNAUTHORIZED              | no row |
 * | R-G2 | red/guard       | no verified payout account                     | POST withdrawals                              | 403 PAYOUT_ACCOUNT_NOT_VERIFIED | no withdrawal; balance unchanged |
 * | R-M1 | red/middleware  | withdrawal with key K exists                   | POST withdrawals key K                        | 409 DUPLICATE_REQUEST         | still one withdrawal; balance unchanged |
 * | R-M2 | red/middleware  | PENDING withdrawal                             | transfer.success webhook with bad signature   | 401 INVALID_SIGNATURE         | row PENDING; in-flight unchanged |
 * | R-T1 | red/3rd-party   | Paystack resolve says account not found        | POST /payouts/account                         | 422 INVALID_BANK_ACCOUNT      | no row; tpl row 422 |
 * | R-T2 | red/3rd-party   | Paystack resolve 500                           | POST /payouts/account                         | 502 PARTNER_UNAVAILABLE       | no row |
 * | R-T3 | red/3rd-party   | Paystack rejects transfer (400)                | POST withdrawals                              | 502 PARTNER_UNAVAILABLE       | row FAILED; user refunded in full |
 * | R-T4 | red/3rd-party   | PENDING withdrawal                             | webhook transfer.failed                       | 200                           | row FAILED; user refunded; in-flight −amt |
 * | R-C1 | red/concurrency | VERIFIED; balance ₦5,000                       | 2× withdraw ₦5,000 (different keys) parallel  | 201 + 422                     | one withdrawal; balance 0 |
 * | R-S1 | red/data-state  | user "Ada Obi"; bank name "JOHN DOE"           | POST /payouts/account                         | 422 NAME_MISMATCH             | no row; no identification call |
 * | R-S2 | red/data-state  | VERIFIED account exists                        | POST /payouts/account                         | 409 PAYOUT_ACCOUNT_EXISTS     | account unchanged |
 * | R-S3 | red/data-state  | VERIFIED; balance ₦1,000                       | withdraw ₦5,000                               | 422 INSUFFICIENT_FUNDS        | no withdrawal |
 * | R-S4 | red/data-state  | SUCCESS withdrawal                             | webhook transfer.success replay               | 200                           | ledger unchanged |
 */
import { randomUUID } from 'crypto';
import nock from 'nock';
import request from 'supertest';
import { ctx, db, paystackSignature, SeededUser } from '../../../test/bootstrap';
import { ACCOUNTS } from '../../wallet/constants/wallet.constants';
import { PaystackPayoutsMockV1 } from '../integrations/paystack/mocks/v1';
import { PAYOUT_EVENTS } from '../constants/payouts.constants';

const PAYSTACK = 'https://paystack.test';
const ps = new PaystackPayoutsMockV1();
const ACCOUNT = { bankCode: '058', accountNumber: '0123456789', bvn: '22212345678' };
const withdraw = (amountKobo: number, idempotencyKey = randomUUID()) => ({ amountKobo, idempotencyKey });
const echoTransfer = (status: string) => (_u: string, body: any) => ps.transferBody(body.reference, body.amount, status);
const signed = (event: object) => ({ 'x-paystack-signature': paystackSignature(event) });

describe('Payouts — Happy paths', () => {
  const fx: Record<string, any> = {};
  beforeAll(async () => {
    await db.ensureSystemAccounts();
    fx.H1 = await db.seedUser({ fullName: 'Ada Obi' });
    fx.H2 = await db.seedUser({ fullName: 'Ada Obi' });
    fx.H2acc = await db.seedPayoutAccount(fx.H2.user.id, { status: 'PENDING_VERIFICATION', recipientCode: null });
    fx.H3 = await db.seedUser({ balanceKobo: 1000000 });
    await db.seedPayoutAccount(fx.H3.user.id);
    fx.H4 = await db.seedUser();
    fx.H4wd = await db.seedWithdrawal(fx.H4.user.id, { amountKobo: 300000 });
    fx.A = await db.seedUser({ role: 'ADMIN' });
    fx.B = await db.seedUser({ role: 'ADMIN' });
    fx.H5 = await db.seedUser();
    await db.seedPayoutAccount(fx.H5.user.id);
    fx.H5m = await db.seedMarket({ closesInMs: -60_000, shares: [10, 0] });
    await db.seedPosition(fx.H5.user.id, fx.H5m.market.id, fx.H5m.outcomes[0].id, 10, 55000);
    await db.seedResolution(fx.H5m.market.id, fx.A.user.id, fx.H5m.outcomes[0].id);
  });
  afterAll(async () => { await db.clean([fx.H1, fx.H2, fx.H3, fx.H4, fx.A, fx.B, fx.H5] as SeededUser[], [fx.H5m.market.id]); await db.cleanPartnerLogs('paystack'); nock.cleanAll(); });

  it('H1 — given a user whose bank name matches their profile, when they add a payout account, then BVN verification starts and only the last 4 BVN digits are kept', async () => {
    nock(PAYSTACK).get('/bank/resolve').query({ account_number: ACCOUNT.accountNumber, bank_code: ACCOUNT.bankCode }).reply(200, ps.resolveBody(ACCOUNT.accountNumber, 'OBI ADA CHIOMA'));
    nock(PAYSTACK).post('/customer').reply(200, ps.customerBody('CUS_h1', fx.H1.user.email));
    nock(PAYSTACK).post('/customer/CUS_h1/identification').reply(202, ps.identificationAcceptedBody());

    const res = await request(ctx.http).post('/payouts/account').set(fx.H1.auth).send(ACCOUNT);

    expect(res.status).toBe(202);
    expect(res.body.data).toMatchObject({ status: 'PENDING_VERIFICATION', accountName: 'OBI ADA CHIOMA', accountNumber: '******6789', bankCode: '058' });
    const row = await db.findOne('payout_accounts', { user_id: fx.H1.user.id });
    expect(row).toMatchObject({ status: 'PENDING_VERIFICATION', paystack_customer_code: 'CUS_h1', bvn_last4: '5678', recipient_code: null });
    expect(JSON.stringify(row)).not.toContain(ACCOUNT.bvn);
    expect(nock.isDone()).toBe(true);
    expect(await db.findOne('third_party_logs', { provider: 'paystack', event: 'paystack.customer.identification' })).toMatchObject({ status_code: 202 });
    expect(await db.findOne('audit_logs', { event: PAYOUT_EVENTS.ACCOUNT_SUBMITTED, actor_id: fx.H1.user.id })).toMatchObject({ session_id: fx.H1.sessionId });
  });

  it('H2 — given a pending account, when Paystack confirms the BVN matches it, then a transfer recipient is created and the account is VERIFIED', async () => {
    const event = ps.identificationSuccessEvent(fx.H2acc.paystack_customer_code, fx.H2.user.email, fx.H2acc.account_number, fx.H2acc.bank_code);
    nock(PAYSTACK).post('/transferrecipient').reply(201, ps.recipientBody('RCP_h2'));

    const res = await request(ctx.http).post('/wallet/webhooks/paystack').set(signed(event)).send(event);

    expect(res.status).toBe(200);
    expect(await db.findOne('payout_accounts', { id: fx.H2acc.id })).toMatchObject({ status: 'VERIFIED', recipient_code: 'RCP_h2' });
    expect(await db.findOne('audit_logs', { event: PAYOUT_EVENTS.ACCOUNT_VERIFIED, table_id: fx.H2acc.id })).toMatchObject({ status: 'SUCCESS' });
  });

  it('H3 — given a verified account and ₦10,000, when the user withdraws ₦5,000 and Paystack pays at once, then the money leaves the wallet and the house absorbs the ₦10 fee', async () => {
    const clearingBefore = await db.balance(ACCOUNTS.PAYSTACK_CLEARING);
    const feesBefore = await db.balance(ACCOUNTS.TRANSFER_FEES);
    nock(PAYSTACK).post('/transfer').reply(200, echoTransfer('success'));

    const res = await request(ctx.http).post('/payouts/withdrawals').set(fx.H3.auth).send(withdraw(500000));

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ amountKobo: 500000, status: 'SUCCESS', balanceKobo: 500000 });
    expect(await db.findOne('withdrawals', { user_id: fx.H3.user.id })).toMatchObject({ status: 'SUCCESS', amount_kobo: '500000', fee_kobo: '1000', source: 'MANUAL' });
    expect(await db.balance(ACCOUNTS.user(fx.H3.user.id))).toBe(500000);
    expect(await db.balance(ACCOUNTS.PAYSTACK_CLEARING)).toBe(clearingBefore + 500000 + 1000);
    expect(await db.balance(ACCOUNTS.TRANSFER_FEES)).toBe(feesBefore - 1000);
    expect(await db.findOne('audit_logs', { event: PAYOUT_EVENTS.WITHDRAWAL_SETTLED, actor_id: fx.H3.user.id })).toMatchObject({ status: 'SUCCESS' });
  });

  it('H4 — given a withdrawal in flight, when Paystack sends transfer.success, then it is marked SUCCESS and leaves the in-flight account', async () => {
    const event = ps.transferEvent('transfer.success', fx.H4wd.reference, 300000, 'success');
    const inFlightBefore = await db.balance(ACCOUNTS.PAYOUTS_IN_FLIGHT);

    const res = await request(ctx.http).post('/wallet/webhooks/paystack').set(signed(event)).send(event);

    expect(res.status).toBe(200);
    expect(await db.findOne('withdrawals', { id: fx.H4wd.id })).toMatchObject({ status: 'SUCCESS' });
    expect(await db.balance(ACCOUNTS.PAYOUTS_IN_FLIGHT)).toBe(inFlightBefore - 300000);
  });

  it('H5 — given a verified winner holding 10 winning shares, when a second admin confirms the result, then ₦1,000 is sent straight to their bank', async () => {
    nock(PAYSTACK).post('/transfer').reply(200, echoTransfer('success'));

    const res = await request(ctx.http).post(`/markets/${fx.H5m.market.id}/resolution/confirm`).set(fx.B.auth).send({});

    expect(res.status).toBe(200);
    expect(await db.findOne('withdrawals', { user_id: fx.H5.user.id })).toMatchObject({ source: 'AUTO_PAYOUT', amount_kobo: '100000', status: 'SUCCESS' });
    expect(await db.balance(ACCOUNTS.user(fx.H5.user.id))).toBe(0);
    expect(nock.isDone()).toBe(true);
  });
});

describe('Payouts — Amber paths', () => {
  const fx: Record<string, any> = {};
  beforeAll(async () => {
    await db.ensureSystemAccounts();
    fx.A1 = await db.seedUser({ balanceKobo: 1000000 });
    await db.seedPayoutAccount(fx.A1.user.id);
    fx.A2 = await db.seedUser({ balanceKobo: 1000000 });
    await db.seedPayoutAccount(fx.A2.user.id);
    fx.adminA = await db.seedUser({ role: 'ADMIN' });
    fx.adminB = await db.seedUser({ role: 'ADMIN' });
    fx.A3 = await db.seedUser();
    await db.seedPayoutAccount(fx.A3.user.id);
    fx.A3m = await db.seedMarket({ closesInMs: -60_000, shares: [6, 0] });
    await db.seedPosition(fx.A3.user.id, fx.A3m.market.id, fx.A3m.outcomes[0].id, 6, 33000);
    await db.seedResolution(fx.A3m.market.id, fx.adminA.user.id, fx.A3m.outcomes[0].id);
    fx.A4 = await db.seedUser();
    fx.A4acc = await db.seedPayoutAccount(fx.A4.user.id, { status: 'PENDING_VERIFICATION', recipientCode: null });
  });
  afterAll(async () => { await db.clean([fx.A1, fx.A2, fx.adminA, fx.adminB, fx.A3, fx.A4], [fx.A3m.market.id]); await db.cleanPartnerLogs('paystack'); nock.cleanAll(); });

  it('A1 — given Paystack queues the transfer as pending, when the user withdraws, then it is accepted as PENDING and the funds are held in flight', async () => {
    const inFlightBefore = await db.balance(ACCOUNTS.PAYOUTS_IN_FLIGHT);
    nock(PAYSTACK).post('/transfer').reply(200, echoTransfer('pending'));

    const res = await request(ctx.http).post('/payouts/withdrawals').set(fx.A1.auth).send(withdraw(400000));

    expect(res.status).toBe(202);
    expect(res.body.warnings).toEqual(['TRANSFER_PENDING']);
    expect(await db.findOne('withdrawals', { user_id: fx.A1.user.id })).toMatchObject({ status: 'PENDING' });
    expect(await db.balance(ACCOUNTS.user(fx.A1.user.id))).toBe(600000);
    expect(await db.balance(ACCOUNTS.PAYOUTS_IN_FLIGHT)).toBe(inFlightBefore + 400000);
  });

  it('A2 — given Paystack times out, when the user withdraws, then it stays PENDING with an unknown-status warning and is NOT refunded (the transfer may have gone through)', async () => {
    nock(PAYSTACK).post('/transfer').delayConnection(1500).reply(200, echoTransfer('success'));

    const res = await request(ctx.http).post('/payouts/withdrawals').set(fx.A2.auth).send(withdraw(400000));

    expect(res.status).toBe(202);
    expect(res.body.warnings).toEqual(['TRANSFER_STATUS_UNKNOWN']);
    expect(await db.findOne('withdrawals', { user_id: fx.A2.user.id })).toMatchObject({ status: 'PENDING' });
    expect(await db.balance(ACCOUNTS.user(fx.A2.user.id))).toBe(600000);
  });

  it('A3 — given winnings of ₦600 (below the ₦1,000 auto-payout floor), when the market settles, then the money stays in the wallet and no transfer is made', async () => {
    const res = await request(ctx.http).post(`/markets/${fx.A3m.market.id}/resolution/confirm`).set(fx.adminB.auth).send({});

    expect(res.status).toBe(200);
    expect(await db.count('withdrawals', { user_id: fx.A3.user.id })).toBe(0);
    expect(await db.balance(ACCOUNTS.user(fx.A3.user.id))).toBe(60000);
  });

  it('A4 — given a pending account, when Paystack reports the BVN does not match, then the account is FAILED with the reason and the user can try again', async () => {
    const event = ps.identificationFailedEvent(fx.A4acc.paystack_customer_code, fx.A4.user.email);

    const res = await request(ctx.http).post('/wallet/webhooks/paystack').set(signed(event)).send(event);

    expect(res.status).toBe(200);
    expect(await db.findOne('payout_accounts', { id: fx.A4acc.id })).toMatchObject({ status: 'FAILED', failure_reason: 'Account number or BVN is incorrect', recipient_code: null });
  });
});

describe('Payouts — Red paths', () => {
  const fx: Record<string, any> = {};
  beforeAll(async () => {
    await db.ensureSystemAccounts();
    fx.RV = await db.seedUser({ fullName: 'Ada Obi' });
    fx.RV3 = await db.seedUser({ balanceKobo: 1000000 });
    await db.seedPayoutAccount(fx.RV3.user.id);
    fx.RG2 = await db.seedUser({ balanceKobo: 1000000 });
    fx.RM1 = await db.seedUser({ balanceKobo: 1000000 });
    await db.seedPayoutAccount(fx.RM1.user.id);
    fx.RM1wd = await db.seedWithdrawal(fx.RM1.user.id, { status: 'SUCCESS' });
    fx.RM2 = await db.seedUser();
    fx.RM2wd = await db.seedWithdrawal(fx.RM2.user.id, { amountKobo: 200000 });
    fx.RT = await db.seedUser({ fullName: 'Ada Obi' });
    fx.RT3 = await db.seedUser({ balanceKobo: 1000000 });
    await db.seedPayoutAccount(fx.RT3.user.id);
    fx.RT4 = await db.seedUser();
    fx.RT4wd = await db.seedWithdrawal(fx.RT4.user.id, { amountKobo: 250000 });
    fx.RC1 = await db.seedUser({ balanceKobo: 500000 });
    await db.seedPayoutAccount(fx.RC1.user.id);
    fx.RS1 = await db.seedUser({ fullName: 'Ada Obi' });
    fx.RS2 = await db.seedUser({ fullName: 'Ada Obi' });
    fx.RS2acc = await db.seedPayoutAccount(fx.RS2.user.id);
    fx.RS3 = await db.seedUser({ balanceKobo: 100000 });
    await db.seedPayoutAccount(fx.RS3.user.id);
    fx.RS4 = await db.seedUser();
    fx.RS4wd = await db.seedWithdrawal(fx.RS4.user.id, { status: 'SUCCESS', amountKobo: 150000 });
  });
  afterAll(async () => {
    await db.clean([fx.RV, fx.RV3, fx.RG2, fx.RM1, fx.RM2, fx.RT, fx.RT3, fx.RT4, fx.RC1, fx.RS1, fx.RS2, fx.RS3, fx.RS4]);
    await db.cleanPartnerLogs('paystack');
    nock.cleanAll();
  });

  it('R-V1 — given a user, when the account number has 9 digits, then 400 VALIDATION_ERROR and nothing is written', async () => {
    const res = await request(ctx.http).post('/payouts/account').set(fx.RV.auth).send({ ...ACCOUNT, accountNumber: '012345678' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(await db.count('payout_accounts', { user_id: fx.RV.user.id })).toBe(0);
  });

  it('R-V2 — given a user, when the BVN is missing, then 400 VALIDATION_ERROR and nothing is written', async () => {
    const res = await request(ctx.http).post('/payouts/account').set(fx.RV.auth).send({ bankCode: '058', accountNumber: '0123456789' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(await db.count('payout_accounts', { user_id: fx.RV.user.id })).toBe(0);
  });

  it('R-V3 — given a verified user, when they withdraw ₦100 (below ₦500), then 400 VALIDATION_ERROR and the balance is unchanged', async () => {
    const res = await request(ctx.http).post('/payouts/withdrawals').set(fx.RV3.auth).send(withdraw(10000));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(await db.count('withdrawals', { user_id: fx.RV3.user.id })).toBe(0);
    expect(await db.balance(ACCOUNTS.user(fx.RV3.user.id))).toBe(1000000);
  });

  it('R-G1 — given no session, when a payout account is submitted, then 401 UNAUTHORIZED and nothing is written', async () => {
    const before = await db.count('payout_accounts');
    const res = await request(ctx.http).post('/payouts/account').send(ACCOUNT);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
    expect(await db.count('payout_accounts')).toBe(before);
  });

  it('R-G2 — given a user with no verified payout account, when they withdraw, then 403 PAYOUT_ACCOUNT_NOT_VERIFIED and the balance is unchanged', async () => {
    const res = await request(ctx.http).post('/payouts/withdrawals').set(fx.RG2.auth).send(withdraw(500000));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PAYOUT_ACCOUNT_NOT_VERIFIED');
    expect(await db.count('withdrawals', { user_id: fx.RG2.user.id })).toBe(0);
    expect(await db.balance(ACCOUNTS.user(fx.RG2.user.id))).toBe(1000000);
  });

  it('R-M1 — given a withdrawal already made with key K, when key K is sent again, then 409 DUPLICATE_REQUEST and nothing more is debited', async () => {
    const res = await request(ctx.http).post('/payouts/withdrawals').set(fx.RM1.auth).send(withdraw(500000, fx.RM1wd.idempotency_key));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUPLICATE_REQUEST');
    expect(await db.count('withdrawals', { user_id: fx.RM1.user.id })).toBe(1);
    expect(await db.balance(ACCOUNTS.user(fx.RM1.user.id))).toBe(1000000);
  });

  it('R-M2 — given a withdrawal in flight, when a transfer.success webhook arrives with a bad signature, then 401 INVALID_SIGNATURE and nothing changes', async () => {
    const event = ps.transferEvent('transfer.success', fx.RM2wd.reference, 200000, 'success');
    const res = await request(ctx.http).post('/wallet/webhooks/paystack').set('x-paystack-signature', 'forged').send(event);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_SIGNATURE');
    expect(await db.findOne('withdrawals', { id: fx.RM2wd.id })).toMatchObject({ status: 'PENDING' });
  });

  it('R-T1 — given Paystack cannot find the account, when it is submitted, then 422 INVALID_BANK_ACCOUNT, no row and a logged partner call', async () => {
    await db.cleanPartnerLogs('paystack');
    nock(PAYSTACK).get('/bank/resolve').query(true).reply(422, ps.resolveNotFoundBody());
    const res = await request(ctx.http).post('/payouts/account').set(fx.RT.auth).send(ACCOUNT);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INVALID_BANK_ACCOUNT');
    expect(await db.count('payout_accounts', { user_id: fx.RT.user.id })).toBe(0);
    expect(await db.findOne('third_party_logs', { provider: 'paystack', event: 'paystack.bank.resolve' })).toMatchObject({ status_code: 422 });
  });

  it('R-T2 — given Paystack resolve returns 500, when an account is submitted, then 502 PARTNER_UNAVAILABLE and no row', async () => {
    nock(PAYSTACK).get('/bank/resolve').query(true).reply(500, ps.serverErrorBody());
    const res = await request(ctx.http).post('/payouts/account').set(fx.RT.auth).send(ACCOUNT);
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('PARTNER_UNAVAILABLE');
    expect(await db.count('payout_accounts', { user_id: fx.RT.user.id })).toBe(0);
  });

  it('R-T3 — given Paystack rejects the transfer, when the user withdraws, then 502 PARTNER_UNAVAILABLE, the withdrawal is FAILED and the wallet is refunded in full', async () => {
    nock(PAYSTACK).post('/transfer').reply(400, ps.transferRejectedBody());
    const res = await request(ctx.http).post('/payouts/withdrawals').set(fx.RT3.auth).send(withdraw(500000));
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('PARTNER_UNAVAILABLE');
    expect(await db.findOne('withdrawals', { user_id: fx.RT3.user.id })).toMatchObject({ status: 'FAILED' });
    expect(await db.balance(ACCOUNTS.user(fx.RT3.user.id))).toBe(1000000);
  });

  it('R-T4 — given a withdrawal in flight, when Paystack sends transfer.failed, then it is FAILED and the user is refunded', async () => {
    const event = ps.transferEvent('transfer.failed', fx.RT4wd.reference, 250000, 'failed');
    const inFlightBefore = await db.balance(ACCOUNTS.PAYOUTS_IN_FLIGHT);
    const res = await request(ctx.http).post('/wallet/webhooks/paystack').set(signed(event)).send(event);
    expect(res.status).toBe(200);
    expect(await db.findOne('withdrawals', { id: fx.RT4wd.id })).toMatchObject({ status: 'FAILED' });
    expect(await db.balance(ACCOUNTS.user(fx.RT4.user.id))).toBe(250000);
    expect(await db.balance(ACCOUNTS.PAYOUTS_IN_FLIGHT)).toBe(inFlightBefore - 250000);
  });

  it('R-C1 — given ₦5,000 and a verified account, when two ₦5,000 withdrawals race, then one is sent, one is rejected and the balance never goes negative', async () => {
    nock(PAYSTACK).post('/transfer').reply(200, echoTransfer('success'));
    const [a, b] = await Promise.all([
      request(ctx.http).post('/payouts/withdrawals').set(fx.RC1.auth).send(withdraw(500000)),
      request(ctx.http).post('/payouts/withdrawals').set(fx.RC1.auth).send(withdraw(500000)),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 422]);
    expect(await db.count('withdrawals', { user_id: fx.RC1.user.id })).toBe(1);
    expect(await db.balance(ACCOUNTS.user(fx.RC1.user.id))).toBe(0);
  });

  it("R-S1 — given a bank account in someone else's name, when it is submitted, then 422 NAME_MISMATCH and BVN verification is never requested", async () => {
    nock(PAYSTACK).get('/bank/resolve').query(true).reply(200, ps.resolveBody(ACCOUNT.accountNumber, 'JOHN DOE'));
    const res = await request(ctx.http).post('/payouts/account').set(fx.RS1.auth).send(ACCOUNT);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('NAME_MISMATCH');
    expect(await db.count('payout_accounts', { user_id: fx.RS1.user.id })).toBe(0);
    expect(nock.isDone()).toBe(true);
  });

  it('R-S2 — given a verified payout account, when the user submits another, then 409 PAYOUT_ACCOUNT_EXISTS and the account is unchanged', async () => {
    const res = await request(ctx.http).post('/payouts/account').set(fx.RS2.auth).send({ ...ACCOUNT, accountNumber: '9999999999' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PAYOUT_ACCOUNT_EXISTS');
    expect(await db.findOne('payout_accounts', { user_id: fx.RS2.user.id })).toMatchObject({ account_number: fx.RS2acc.account_number, status: 'VERIFIED' });
  });

  it('R-S3 — given ₦1,000 in the wallet, when the user withdraws ₦5,000, then 422 INSUFFICIENT_FUNDS and no withdrawal is created', async () => {
    const res = await request(ctx.http).post('/payouts/withdrawals').set(fx.RS3.auth).send(withdraw(500000));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INSUFFICIENT_FUNDS');
    expect(await db.count('withdrawals', { user_id: fx.RS3.user.id })).toBe(0);
    expect(await db.balance(ACCOUNTS.user(fx.RS3.user.id))).toBe(100000);
  });

  it('R-S4 — given a withdrawal already SUCCESS, when Paystack replays transfer.success, then it is acknowledged and the ledger does not move', async () => {
    const event = ps.transferEvent('transfer.success', fx.RS4wd.reference, 150000, 'success');
    const ledgerBefore = await db.count('ledger_entries');
    const res = await request(ctx.http).post('/wallet/webhooks/paystack').set(signed(event)).send(event);
    expect(res.status).toBe(200);
    expect(await db.findOne('withdrawals', { id: fx.RS4wd.id })).toMatchObject({ status: 'SUCCESS' });
    expect(await db.count('ledger_entries')).toBe(ledgerBefore);
  });
});
