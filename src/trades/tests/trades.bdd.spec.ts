/**
 * trades.bdd.spec.ts — buy/sell outcome shares against the LMSR market maker, settled in naira via the ledger.
 * Real Postgres. No 3rd-party calls in this process (pricing is in-house), so no R-T rows: see README "BDD exceptions".
 *
 * CASE TABLE
 * | H1   | happy           | user ₦5,000; OPEN market b=1000 q=[0,0]     | BUY ₦1,000 of outcome 0                | 201 shares=LMSR, fee 2%      | trade row; outcome q; position; user 400000; fees +2000; market +98000; 3 legs sum 0; audit |
 * | H2   | happy           | user holds 50 shares; q=[50,0]               | SELL 20 shares of outcome 0            | 201 proceeds=LMSR−2%         | position 30 / cost 156000; outcome q=30; user +net; market −gross; audit |
 * | A1   | amber           | user ₦10,000; thin market b=100              | BUY ₦6,000                             | 201 + HIGH_PRICE_IMPACT      | trade written in full; price moved >10pts |
 * | R-V1 | red/validation  | user ₦5,000                                  | BUY without amountKobo                 | 400 VALIDATION_ERROR         | no trade; balance unchanged |
 * | R-V2 | red/validation  | user ₦5,000                                  | BUY amountKobo 5000 (< ₦100)           | 400 VALIDATION_ERROR         | no trade |
 * | R-V3 | red/validation  | user ₦5,000                                  | side HOLD                              | 400 VALIDATION_ERROR         | no trade |
 * | R-V4 | red/validation  | user ₦5,000                                  | SELL without shares                    | 400 VALIDATION_ERROR         | no trade |
 * | R-V5 | red/validation  | user ₦5,000                                  | BUY without idempotencyKey             | 400 VALIDATION_ERROR         | no trade |
 * | R-G1 | red/guard       | no session                                   | BUY                                    | 401 UNAUTHORIZED             | no trade |
 * | R-G2 | red/guard       | expired session                              | BUY                                    | 401 SESSION_EXPIRED          | no trade; balance unchanged |
 * | R-M1 | red/middleware  | trade with key K already exists for user     | BUY with key K                         | 409 DUPLICATE_REQUEST        | still 1 trade; balance unchanged |
 * | R-C1 | red/concurrency | user ₦5,000                                  | 2× BUY same key in parallel            | 201 + 409                    | exactly 1 trade; debited once |
 * | R-C2 | red/concurrency | user ₦1,000 (covers one)                     | 2× BUY ₦1,000 different keys parallel  | 201 + 422                    | exactly 1 trade; balance 0 |
 * | R-S1 | red/data-state  | market closes_at in the past                 | BUY                                    | 422 MARKET_CLOSED            | no trade; q unchanged |
 * | R-S2 | red/data-state  | market RESOLVED                              | BUY                                    | 422 MARKET_CLOSED            | no trade |
 * | R-S3 | red/data-state  | user ₦500                                    | BUY ₦1,000                             | 422 INSUFFICIENT_FUNDS       | no trade; q unchanged |
 * | R-S4 | red/data-state  | user holds 5 shares                          | SELL 10 shares                         | 422 INSUFFICIENT_SHARES      | position unchanged |
 * | R-S5 | red/data-state  | outcome from a different market              | BUY                                    | 404 OUTCOME_NOT_FOUND        | no trade |
 * | R-S6 | red/data-state  | market id does not exist                     | BUY                                    | 404 MARKET_NOT_FOUND         | no trade |
 * | R-S7 | red/data-state  | user ₦5,000                                  | BUY ₦1,000 with minShares 1000         | 422 SLIPPAGE_EXCEEDED        | no trade; balance unchanged |
 */
import { randomUUID } from 'crypto';
import request from 'supertest';
import { ctx, db, SeededUser } from '../../../test/bootstrap';
import { prices, proceedsForSale, sharesForSpend } from '../../utils/lmsr';
import { bpsOf, PAYOUT_PER_SHARE_KOBO } from '../../utils/money';
import { ACCOUNTS } from '../../wallet/constants/wallet.constants';
import { TRADE_EVENTS, TRADE_FEE_BPS } from '../constants/trades.constants';

const buy = (outcomeId: string, amountKobo: number, extra: Record<string, unknown> = {}) =>
  ({ outcomeId, side: 'BUY', amountKobo, idempotencyKey: randomUUID(), ...extra });
const tradeUrl = (marketId: string) => `/markets/${marketId}/trades`;

describe('Trades — Happy paths', () => {
  const fx: Record<string, any> = {};
  beforeAll(async () => {
    await db.ensureSystemAccounts();
    fx.H1 = await db.seedUser({ balanceKobo: 500000 });
    fx.H1m = await db.seedMarket({ b: 1000 });
    fx.H2 = await db.seedUser({ balanceKobo: 0 });
    fx.H2m = await db.seedMarket({ b: 1000, shares: [50, 0] });
    await db.seedPosition(fx.H2.user.id, fx.H2m.market.id, fx.H2m.outcomes[0].id, 50, 260000);
  });
  afterAll(async () => { await db.clean([fx.H1, fx.H2] as SeededUser[], [fx.H1m.market.id, fx.H2m.market.id]); });

  it('H1 — given a funded user and an open market, when they buy ₦1,000 of an outcome, then LMSR shares are issued and the ledger moves exactly ₦1,000', async () => {
    const fee = bpsOf(100000, TRADE_FEE_BPS);
    const shares = sharesForSpend([0, 0], 1000, 0, (100000 - fee) / PAYOUT_PER_SHARE_KOBO);
    const feesBefore = await db.balance(ACCOUNTS.FEES);
    const marketBefore = await db.balance(ACCOUNTS.market(fx.H1m.market.id));
    const body = buy(fx.H1m.outcomes[0].id, 100000);

    const res = await request(ctx.http).post(tradeUrl(fx.H1m.market.id)).set(fx.H1.auth).send(body);

    expect(res.status).toBe(201);
    expect(res.body.data.trade).toMatchObject({ side: 'BUY', outcomeId: fx.H1m.outcomes[0].id, amountKobo: 100000, feeKobo: fee, priceBefore: 0.5 });
    expect(res.body.data.trade.shares).toBeCloseTo(shares, 9);
    expect(res.body.data.trade.priceAfter).toBeCloseTo(prices([shares, 0], 1000)[0], 9);
    expect(res.body.data.balanceKobo).toBe(400000);
    const trade = await db.findOne('trades', { idempotency_key: body.idempotencyKey });
    expect(trade).toMatchObject({ user_id: fx.H1.user.id, side: 'BUY', amount_kobo: '100000', fee_kobo: String(fee) });
    expect((await db.findOne('outcomes', { id: fx.H1m.outcomes[0].id }))!.shares).toBeCloseTo(shares, 9);
    expect((await db.findOne('positions', { user_id: fx.H1.user.id, outcome_id: fx.H1m.outcomes[0].id }))).toMatchObject({ cost_kobo: String(100000 - fee) });
    expect(await db.balance(ACCOUNTS.user(fx.H1.user.id))).toBe(400000);
    expect(await db.balance(ACCOUNTS.FEES)).toBe(feesBefore + fee);
    expect(await db.balance(ACCOUNTS.market(fx.H1m.market.id))).toBe(marketBefore + 100000 - fee);
    const legs = await db.findMany('ledger_entries', { tx_ref: `trade:${trade!.id}` });
    expect(legs.reduce((s, l) => s + Number(l.amount_kobo), 0)).toBe(0);
    expect(legs.length).toBe(3);
    expect(await db.findOne('audit_logs', { event: TRADE_EVENTS.BUY, table_id: trade!.id })).toMatchObject({ actor_id: fx.H1.user.id, session_id: fx.H1.sessionId });
  });

  it('H2 — given a user holding 50 shares, when they sell 20, then they receive LMSR proceeds minus 2% and their position and cost basis shrink', async () => {
    const gross = Math.floor(proceedsForSale([50, 0], 1000, 0, 20) * PAYOUT_PER_SHARE_KOBO);
    const fee = bpsOf(gross, TRADE_FEE_BPS);
    const marketBefore = await db.balance(ACCOUNTS.market(fx.H2m.market.id));
    const body = { outcomeId: fx.H2m.outcomes[0].id, side: 'SELL', shares: 20, idempotencyKey: randomUUID() };

    const res = await request(ctx.http).post(tradeUrl(fx.H2m.market.id)).set(fx.H2.auth).send(body);

    expect(res.status).toBe(201);
    expect(res.body.data.trade).toMatchObject({ side: 'SELL', shares: 20, amountKobo: gross, feeKobo: fee });
    expect(res.body.data.balanceKobo).toBe(gross - fee);
    expect(await db.findOne('positions', { user_id: fx.H2.user.id, outcome_id: fx.H2m.outcomes[0].id })).toMatchObject({ shares: 30, cost_kobo: '156000' });
    expect((await db.findOne('outcomes', { id: fx.H2m.outcomes[0].id }))!.shares).toBeCloseTo(30, 9);
    expect(await db.balance(ACCOUNTS.user(fx.H2.user.id))).toBe(gross - fee);
    expect(await db.balance(ACCOUNTS.market(fx.H2m.market.id))).toBe(marketBefore - gross);
    expect(await db.findOne('audit_logs', { event: TRADE_EVENTS.SELL, actor_id: fx.H2.user.id })).toMatchObject({ status: 'SUCCESS' });
  });
});

describe('Trades — Amber paths', () => {
  const fx: Record<string, any> = {};
  beforeAll(async () => {
    await db.ensureSystemAccounts();
    fx.A1 = await db.seedUser({ balanceKobo: 1000000 });
    fx.A1m = await db.seedMarket({ b: 100 });
  });
  afterAll(async () => { await db.clean([fx.A1], [fx.A1m.market.id]); });

  it('A1 — given a thin market, when a user buys ₦6,000 at once, then the trade fills in full with a HIGH_PRICE_IMPACT warning', async () => {
    const body = buy(fx.A1m.outcomes[0].id, 600000);

    const res = await request(ctx.http).post(tradeUrl(fx.A1m.market.id)).set(fx.A1.auth).send(body);

    expect(res.status).toBe(201);
    expect(res.body.warnings).toEqual(['HIGH_PRICE_IMPACT']);
    expect(res.body.data.trade.priceAfter - res.body.data.trade.priceBefore).toBeGreaterThan(0.1);
    expect(await db.findOne('trades', { idempotency_key: body.idempotencyKey })).toMatchObject({ amount_kobo: '600000' });
    expect(await db.balance(ACCOUNTS.user(fx.A1.user.id))).toBe(400000);
  });
});

describe('Trades — Red paths', () => {
  const fx: Record<string, any> = {};
  beforeAll(async () => {
    await db.ensureSystemAccounts();
    fx.RV = await db.seedUser({ balanceKobo: 500000 });
    fx.RG2 = await db.seedUser({ balanceKobo: 500000, sessionExpired: true });
    fx.RM1 = await db.seedUser({ balanceKobo: 500000 });
    fx.RC1 = await db.seedUser({ balanceKobo: 500000 });
    fx.RC2 = await db.seedUser({ balanceKobo: 100000 });
    fx.RS3 = await db.seedUser({ balanceKobo: 50000 });
    fx.RS4 = await db.seedUser({ balanceKobo: 0 });
    fx.m = await db.seedMarket({ b: 1000 });
    fx.mClosed = await db.seedMarket({ closesInMs: -60_000 });
    fx.mResolved = await db.seedMarket({ status: 'RESOLVED' });
    fx.mOther = await db.seedMarket();
    fx.mHeld = await db.seedMarket({ b: 1000, shares: [5, 0] });
    await db.seedPosition(fx.RS4.user.id, fx.mHeld.market.id, fx.mHeld.outcomes[0].id, 5, 26000);
    fx.usedKey = randomUUID();
    await db.seedTrade(fx.RM1.user.id, fx.m.market.id, fx.m.outcomes[0].id, fx.usedKey);
  });
  afterAll(async () => {
    await db.clean([fx.RV, fx.RG2, fx.RM1, fx.RC1, fx.RC2, fx.RS3, fx.RS4],
      [fx.m.market.id, fx.mClosed.market.id, fx.mResolved.market.id, fx.mOther.market.id, fx.mHeld.market.id]);
  });

  it('R-V1 — given a funded user, when a BUY omits amountKobo, then 400 VALIDATION_ERROR and nothing is written', async () => {
    const res = await request(ctx.http).post(tradeUrl(fx.m.market.id)).set(fx.RV.auth).send({ outcomeId: fx.m.outcomes[0].id, side: 'BUY', idempotencyKey: randomUUID() });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(await db.count('trades', { user_id: fx.RV.user.id })).toBe(0);
    expect(await db.balance(ACCOUNTS.user(fx.RV.user.id))).toBe(500000);
  });

  it('R-V2 — given a funded user, when a BUY is below ₦100, then 400 VALIDATION_ERROR and nothing is written', async () => {
    const res = await request(ctx.http).post(tradeUrl(fx.m.market.id)).set(fx.RV.auth).send(buy(fx.m.outcomes[0].id, 5000));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(await db.count('trades', { user_id: fx.RV.user.id })).toBe(0);
  });

  it('R-V3 — given a funded user, when side is not BUY or SELL, then 400 VALIDATION_ERROR and nothing is written', async () => {
    const res = await request(ctx.http).post(tradeUrl(fx.m.market.id)).set(fx.RV.auth).send(buy(fx.m.outcomes[0].id, 100000, { side: 'HOLD' }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(await db.count('trades', { user_id: fx.RV.user.id })).toBe(0);
  });

  it('R-V4 — given a funded user, when a SELL omits shares, then 400 VALIDATION_ERROR and nothing is written', async () => {
    const res = await request(ctx.http).post(tradeUrl(fx.m.market.id)).set(fx.RV.auth).send({ outcomeId: fx.m.outcomes[0].id, side: 'SELL', idempotencyKey: randomUUID() });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(await db.count('trades', { user_id: fx.RV.user.id })).toBe(0);
  });

  it('R-V5 — given a funded user, when a BUY omits idempotencyKey, then 400 VALIDATION_ERROR and nothing is written', async () => {
    const res = await request(ctx.http).post(tradeUrl(fx.m.market.id)).set(fx.RV.auth).send({ outcomeId: fx.m.outcomes[0].id, side: 'BUY', amountKobo: 100000 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(await db.count('trades', { user_id: fx.RV.user.id })).toBe(0);
  });

  it('R-G1 — given no session, when a BUY is posted, then 401 UNAUTHORIZED and nothing is written', async () => {
    const before = await db.count('trades', { market_id: fx.m.market.id });
    const res = await request(ctx.http).post(tradeUrl(fx.m.market.id)).send(buy(fx.m.outcomes[0].id, 100000));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
    expect(await db.count('trades', { market_id: fx.m.market.id })).toBe(before);
  });

  it('R-G2 — given an expired session, when a BUY is posted, then 401 SESSION_EXPIRED and the balance is untouched', async () => {
    const res = await request(ctx.http).post(tradeUrl(fx.m.market.id)).set(fx.RG2.auth).send(buy(fx.m.outcomes[0].id, 100000));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('SESSION_EXPIRED');
    expect(await db.count('trades', { user_id: fx.RG2.user.id })).toBe(0);
    expect(await db.balance(ACCOUNTS.user(fx.RG2.user.id))).toBe(500000);
  });

  it('R-M1 — given a trade already placed with key K, when the same key is posted again, then 409 DUPLICATE_REQUEST and nothing more is charged', async () => {
    const res = await request(ctx.http).post(tradeUrl(fx.m.market.id)).set(fx.RM1.auth).send(buy(fx.m.outcomes[0].id, 100000, { idempotencyKey: fx.usedKey }));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUPLICATE_REQUEST');
    expect(await db.count('trades', { user_id: fx.RM1.user.id })).toBe(1);
    expect(await db.balance(ACCOUNTS.user(fx.RM1.user.id))).toBe(500000);
  });

  it('R-C1 — given a funded user, when the same BUY (same key) is sent twice in parallel, then exactly one fills and the user is debited once', async () => {
    const body = buy(fx.m.outcomes[1].id, 100000);
    const [a, b] = await Promise.all([
      request(ctx.http).post(tradeUrl(fx.m.market.id)).set(fx.RC1.auth).send(body),
      request(ctx.http).post(tradeUrl(fx.m.market.id)).set(fx.RC1.auth).send(body),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await db.count('trades', { user_id: fx.RC1.user.id })).toBe(1);
    expect(await db.balance(ACCOUNTS.user(fx.RC1.user.id))).toBe(400000);
  });

  it('R-C2 — given a balance that covers one ₦1,000 BUY, when two different BUYs race, then one fills, one is rejected and the balance never goes negative', async () => {
    const [a, b] = await Promise.all([
      request(ctx.http).post(tradeUrl(fx.m.market.id)).set(fx.RC2.auth).send(buy(fx.m.outcomes[0].id, 100000)),
      request(ctx.http).post(tradeUrl(fx.m.market.id)).set(fx.RC2.auth).send(buy(fx.m.outcomes[0].id, 100000)),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 422]);
    expect(await db.count('trades', { user_id: fx.RC2.user.id })).toBe(1);
    expect(await db.balance(ACCOUNTS.user(fx.RC2.user.id))).toBe(0);
  });

  it('R-S1 — given a market past its closing time, when a BUY is posted, then 422 MARKET_CLOSED and prices are unchanged', async () => {
    const res = await request(ctx.http).post(tradeUrl(fx.mClosed.market.id)).set(fx.RV.auth).send(buy(fx.mClosed.outcomes[0].id, 100000));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('MARKET_CLOSED');
    expect(await db.count('trades', { market_id: fx.mClosed.market.id })).toBe(0);
    expect((await db.findOne('outcomes', { id: fx.mClosed.outcomes[0].id }))!.shares).toBe(0);
  });

  it('R-S2 — given a RESOLVED market, when a BUY is posted, then 422 MARKET_CLOSED and nothing is written', async () => {
    const res = await request(ctx.http).post(tradeUrl(fx.mResolved.market.id)).set(fx.RV.auth).send(buy(fx.mResolved.outcomes[0].id, 100000));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('MARKET_CLOSED');
    expect(await db.count('trades', { market_id: fx.mResolved.market.id })).toBe(0);
  });

  it('R-S3 — given a user with ₦500, when they BUY ₦1,000, then 422 INSUFFICIENT_FUNDS and prices are unchanged', async () => {
    const before = (await db.findOne('outcomes', { id: fx.m.outcomes[0].id }))!.shares;
    const res = await request(ctx.http).post(tradeUrl(fx.m.market.id)).set(fx.RS3.auth).send(buy(fx.m.outcomes[0].id, 100000));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INSUFFICIENT_FUNDS');
    expect(await db.count('trades', { user_id: fx.RS3.user.id })).toBe(0);
    expect((await db.findOne('outcomes', { id: fx.m.outcomes[0].id }))!.shares).toBe(before);
    expect(await db.balance(ACCOUNTS.user(fx.RS3.user.id))).toBe(50000);
  });

  it('R-S4 — given a user holding 5 shares, when they SELL 10, then 422 INSUFFICIENT_SHARES and the position is unchanged', async () => {
    const res = await request(ctx.http).post(tradeUrl(fx.mHeld.market.id)).set(fx.RS4.auth).send({ outcomeId: fx.mHeld.outcomes[0].id, side: 'SELL', shares: 10, idempotencyKey: randomUUID() });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INSUFFICIENT_SHARES');
    expect(await db.findOne('positions', { user_id: fx.RS4.user.id, outcome_id: fx.mHeld.outcomes[0].id })).toMatchObject({ shares: 5, cost_kobo: '26000' });
    expect(await db.balance(ACCOUNTS.user(fx.RS4.user.id))).toBe(0);
  });

  it('R-S5 — given an outcome from another market, when a BUY is posted, then 404 OUTCOME_NOT_FOUND and nothing is written', async () => {
    const res = await request(ctx.http).post(tradeUrl(fx.m.market.id)).set(fx.RV.auth).send(buy(fx.mOther.outcomes[0].id, 100000));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('OUTCOME_NOT_FOUND');
    expect(await db.count('trades', { user_id: fx.RV.user.id })).toBe(0);
  });

  it('R-S6 — given a market id that does not exist, when a BUY is posted, then 404 MARKET_NOT_FOUND and nothing is written', async () => {
    const res = await request(ctx.http).post(tradeUrl(randomUUID())).set(fx.RV.auth).send(buy(fx.m.outcomes[0].id, 100000));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('MARKET_NOT_FOUND');
    expect(await db.count('trades', { user_id: fx.RV.user.id })).toBe(0);
  });

  it('R-S7 — given a slippage limit the market cannot meet, when a BUY is posted, then 422 SLIPPAGE_EXCEEDED and nothing is charged', async () => {
    const res = await request(ctx.http).post(tradeUrl(fx.m.market.id)).set(fx.RV.auth).send(buy(fx.m.outcomes[0].id, 100000, { minShares: 1000 }));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('SLIPPAGE_EXCEEDED');
    expect(await db.count('trades', { user_id: fx.RV.user.id })).toBe(0);
    expect(await db.balance(ACCOUNTS.user(fx.RV.user.id))).toBe(500000);
  });
});
