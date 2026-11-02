/**
 * markets.bdd.spec.ts — admin market tools: create with starting odds, edit, close early, weekly Spotify template.
 * Real Postgres. No 3rd-party calls (in-house pricing), so no R-T rows: see README "Known lint conflicts".
 *
 * CASE TABLE
 * | H1   | happy           | ADMIN                                   | POST /markets initialPrices [0.6,0.3,0.1]     | 201 prices ≈ given           | q_i = b·ln(p_i/p_min); pool = b·ln(1/p_min); subsidy debited same; audit |
 * | H2   | happy           | ADMIN                                   | POST /markets without initialPrices           | 201 equal prices             | q all 0; pool = b·ln(n) |
 * | H3   | happy           | ADMIN; OPEN market, no trades           | PATCH description + closesAt + rules          | 200                          | row updated; audit UPDATED |
 * | H4   | happy           | ADMIN; OPEN market                      | POST /markets/:id/close                       | 200                          | closes_at <= now; status OPEN; audit CLOSED |
 * | H5   | happy           | ADMIN                                   | POST spotify-weekly {weekStart: Friday}       | 201                          | slug spotify-ng-weekly-<date>; closes Thu 23:00 WAT; 8 artists |
 * | A1   | amber           | ADMIN                                   | POST /markets initialPrices summing 0.995     | 201 + PRICES_NORMALIZED      | prices renormalised to sum 1 |
 * | A2   | amber           | ADMIN; this week's Spotify market exists| POST spotify-weekly same week                 | 200 + ALREADY_EXISTS         | still one market with that slug |
 * | R-V1 | red/validation  | ADMIN                                   | initialPrices length ≠ outcomes               | 400 VALIDATION_ERROR         | no market |
 * | R-V2 | red/validation  | ADMIN                                   | an initial price below 0.01                   | 400 VALIDATION_ERROR         | no market |
 * | R-V3 | red/validation  | ADMIN                                   | initialPrices summing 0.8                     | 400 VALIDATION_ERROR         | no market |
 * | R-V4 | red/validation  | ADMIN                                   | spotify weekStart not a Friday                | 400 VALIDATION_ERROR         | no market |
 * | R-V5 | red/validation  | ADMIN; OPEN market                      | PATCH closesAt in the past                    | 400 VALIDATION_ERROR         | row unchanged |
 * | R-G1 | red/guard       | USER                                    | POST /markets                                 | 403 FORBIDDEN                | no market |
 * | R-G2 | red/guard       | no session                              | PATCH market                                  | 401 UNAUTHORIZED             | row unchanged |
 * | R-M1 | red/middleware  | slug already used                       | POST /markets same slug                       | 409 SLUG_TAKEN               | one market with slug |
 * | R-C1 | red/concurrency | ADMIN                                   | 2× POST same new slug in parallel             | 201 + 409                    | exactly one market; subsidy debited once |
 * | R-S1 | red/data-state  | OPEN market with trades                 | PATCH resolutionRules                         | 422 MARKET_HAS_TRADES        | rules unchanged |
 * | R-S2 | red/data-state  | RESOLVED market                         | POST close                                    | 422 MARKET_NOT_OPEN          | row unchanged |
 * | R-S3 | red/data-state  | unknown market id                       | PATCH                                         | 404 MARKET_NOT_FOUND         | nothing written |
 */
import { randomUUID } from 'crypto';
import request from 'supertest';
import { ctx, db, SeededUser } from '../../../test/bootstrap';
import { prices } from '../../utils/lmsr';
import { PAYOUT_PER_SHARE_KOBO } from '../../utils/money';
import { ACCOUNTS } from '../../wallet/constants/wallet.constants';
import { MARKET_EVENTS, SPOTIFY_WEEKLY } from '../constants/markets.constants';

const WEEK = 7 * 86_400_000;
const future = (ms = WEEK) => new Date(Date.now() + ms).toISOString();
const newMarket = (extra: Record<string, unknown> = {}) => ({
  slug: `bdd-${randomUUID().slice(0, 8)}`, title: 'Who will win the BDD test race?', description: 'Fixture market', category: 'GOVERNORSHIP',
  state: 'Lagos', closesAt: future(), resolutionSource: 'INEC', resolutionRules: 'Resolves on INEC declaration', liquidityB: 100,
  outcomes: ['Candidate A (APC)', 'Candidate B (ADC)', 'Candidate C (LP)'], ...extra,
});
const nextFriday = (weeksAhead: number) => {
  const d = new Date(Date.UTC(2030, 0, 4)); // 4 Jan 2030 is a Friday; far from seeded data
  return new Date(d.getTime() + weeksAhead * WEEK).toISOString().slice(0, 10);
};

describe('Markets — Happy paths', () => {
  const fx: Record<string, any> = {};
  beforeAll(async () => {
    await db.ensureSystemAccounts();
    fx.admin = await db.seedUser({ role: 'ADMIN' });
    fx.H1 = newMarket({ initialPrices: [0.6, 0.3, 0.1] });
    fx.H2 = newMarket();
    fx.H3m = await db.seedMarket();
    fx.H4m = await db.seedMarket();
    fx.H5week = nextFriday(0);
  });
  afterAll(async () => {
    const created = await Promise.all([fx.H1.slug, fx.H2.slug, `${SPOTIFY_WEEKLY.SLUG_PREFIX}${fx.H5week}`].map((slug) => db.findOne('markets', { slug })));
    await db.clean([fx.admin] as SeededUser[], [fx.H3m.market.id, fx.H4m.market.id, ...created.filter(Boolean).map((m) => m!.id)]);
  });

  it('H1 — given an admin, when they create a market with starting odds 60/30/10, then prices open there and the pool holds exactly the worst-case loss', async () => {
    const subsidyBefore = await db.balance(ACCOUNTS.SUBSIDY);
    const pool = Math.ceil(100 * Math.log(1 / 0.1) * PAYOUT_PER_SHARE_KOBO);

    const res = await request(ctx.http).post('/markets').set(fx.admin.auth).send(fx.H1);

    expect(res.status).toBe(201);
    expect(res.body.data.outcomes.map((o: any) => Number(o.price.toFixed(6)))).toEqual([0.6, 0.3, 0.1]);
    const market = await db.findOne('markets', { slug: fx.H1.slug });
    const outcomes = await db.findMany('outcomes', { market_id: market!.id });
    expect(outcomes.map((o) => Number(o.shares.toFixed(9))).sort((a, b) => b - a)).toEqual([100 * Math.log(6), 100 * Math.log(3), 0].map((x) => Number(x.toFixed(9))));
    expect(prices(outcomes.sort((a, b) => a.sort_order - b.sort_order).map((o) => o.shares), 100).map((p) => Number(p.toFixed(6)))).toEqual([0.6, 0.3, 0.1]);
    expect(await db.balance(ACCOUNTS.market(market!.id))).toBe(pool);
    expect(await db.balance(ACCOUNTS.SUBSIDY)).toBe(subsidyBefore - pool);
    expect(await db.findOne('audit_logs', { event: MARKET_EVENTS.CREATED, table_id: market!.id })).toMatchObject({ actor_id: fx.admin.user.id });
  });

  it('H2 — given an admin, when they create a market without starting odds, then every outcome opens at an equal price', async () => {
    const res = await request(ctx.http).post('/markets').set(fx.admin.auth).send(fx.H2);

    expect(res.status).toBe(201);
    expect(res.body.data.outcomes.map((o: any) => Number(o.price.toFixed(6)))).toEqual([0.333333, 0.333333, 0.333333]);
    const market = await db.findOne('markets', { slug: fx.H2.slug });
    expect(await db.balance(ACCOUNTS.market(market!.id))).toBe(Math.ceil(100 * Math.log(3) * PAYOUT_PER_SHARE_KOBO));
    expect((await db.findMany('outcomes', { market_id: market!.id })).map((o) => o.shares)).toEqual([0, 0, 0]);
  });

  it('H3 — given an open market nobody has traded, when an admin edits the description, rules and close time, then the market is updated and audited', async () => {
    const closesAt = future(2 * WEEK);
    const res = await request(ctx.http).patch(`/markets/${fx.H3m.market.id}`).set(fx.admin.auth)
      .send({ description: 'Updated description', resolutionRules: 'Updated rules', closesAt });

    expect(res.status).toBe(200);
    expect(await db.findOne('markets', { id: fx.H3m.market.id })).toMatchObject({ description: 'Updated description', resolution_rules: 'Updated rules', closes_at: new Date(closesAt) });
    expect(await db.findOne('audit_logs', { event: MARKET_EVENTS.UPDATED, table_id: fx.H3m.market.id })).toMatchObject({ actor_id: fx.admin.user.id });
  });

  it('H4 — given an open market, when an admin closes it early, then trading stops now and the market waits for resolution', async () => {
    const res = await request(ctx.http).post(`/markets/${fx.H4m.market.id}/close`).set(fx.admin.auth).send({});

    expect(res.status).toBe(200);
    const row = await db.findOne('markets', { id: fx.H4m.market.id });
    expect(new Date(row!.closes_at).getTime()).toBeLessThanOrEqual(Date.now());
    expect(row).toMatchObject({ status: 'OPEN' });
    expect(await db.findOne('audit_logs', { event: MARKET_EVENTS.CLOSED, table_id: fx.H4m.market.id })).toMatchObject({ actor_id: fx.admin.user.id });
  });

  it("H5 — given an admin, when they open next week's Spotify market, then it uses the standard artists and closes at 23:00 WAT the Thursday before", async () => {
    const res = await request(ctx.http).post('/markets/templates/spotify-weekly').set(fx.admin.auth).send({ weekStart: fx.H5week });

    expect(res.status).toBe(201);
    const row = await db.findOne('markets', { slug: `${SPOTIFY_WEEKLY.SLUG_PREFIX}${fx.H5week}` });
    expect(row).toMatchObject({ category: 'MUSIC', status: 'OPEN', liquidity_b: SPOTIFY_WEEKLY.LIQUIDITY_B });
    expect(new Date(row!.closes_at).toISOString()).toBe(new Date(new Date(`${fx.H5week}T00:00:00+01:00`).getTime() - SPOTIFY_WEEKLY.CLOSE_OFFSET_MS).toISOString());
    expect((await db.findMany('outcomes', { market_id: row!.id })).map((o) => o.label).sort()).toEqual([...SPOTIFY_WEEKLY.ARTISTS].sort());
  });
});

describe('Markets — Amber paths', () => {
  const fx: Record<string, any> = {};
  beforeAll(async () => {
    await db.ensureSystemAccounts();
    fx.admin = await db.seedUser({ role: 'ADMIN' });
    fx.A1 = newMarket({ initialPrices: [0.5, 0.3, 0.195] });
    fx.A2week = nextFriday(1);
    fx.A2m = await db.seedMarket({ slug: `${SPOTIFY_WEEKLY.SLUG_PREFIX}${fx.A2week}` });
  });
  afterAll(async () => {
    const a1 = await db.findMany('markets', { slug: fx.A1.slug });
    await db.clean([fx.admin], [fx.A2m.market.id, ...a1.map((m) => m.id)]);
  });

  it('A1 — given starting odds that sum to 0.995, when the market is created, then the odds are renormalised to 100% with a PRICES_NORMALIZED warning', async () => {
    const res = await request(ctx.http).post('/markets').set(fx.admin.auth).send(fx.A1);

    expect(res.status).toBe(201);
    expect(res.body.warnings).toEqual(['PRICES_NORMALIZED']);
    expect(res.body.data.outcomes.reduce((s: number, o: any) => s + o.price, 0)).toBeCloseTo(1, 9);
    expect(res.body.data.outcomes[0].price).toBeCloseTo(0.5 / 0.995, 6);
    expect(await db.count('markets', { slug: fx.A1.slug })).toBe(1);
  });

  it("A2 — given this week's Spotify market already exists, when the template runs again, then the existing market is returned and nothing is duplicated", async () => {
    const res = await request(ctx.http).post('/markets/templates/spotify-weekly').set(fx.admin.auth).send({ weekStart: fx.A2week });

    expect(res.status).toBe(200);
    expect(res.body.warnings).toEqual(['ALREADY_EXISTS']);
    expect(res.body.data.id).toBe(fx.A2m.market.id);
    expect(await db.count('markets', { slug: `${SPOTIFY_WEEKLY.SLUG_PREFIX}${fx.A2week}` })).toBe(1);
  });
});

describe('Markets — Red paths', () => {
  const fx: Record<string, any> = {};
  beforeAll(async () => {
    await db.ensureSystemAccounts();
    fx.admin = await db.seedUser({ role: 'ADMIN' });
    fx.user = await db.seedUser();
    fx.open = await db.seedMarket();
    fx.taken = await db.seedMarket();
    fx.traded = await db.seedMarket({ tradeCount: 3 });
    fx.resolved = await db.seedMarket({ status: 'RESOLVED' });
    fx.raceSlug = `bdd-race-${randomUUID().slice(0, 8)}`;
  });
  afterAll(async () => {
    const race = await db.findMany('markets', { slug: fx.raceSlug });
    await db.clean([fx.admin, fx.user], [fx.open.market.id, fx.taken.market.id, fx.traded.market.id, fx.resolved.market.id, ...race.map((m) => m.id)]);
  });

  it('R-V1 — given an admin, when initialPrices has a different length from outcomes, then 400 VALIDATION_ERROR and no market', async () => {
    const body = newMarket({ initialPrices: [0.5, 0.5] });
    const res = await request(ctx.http).post('/markets').set(fx.admin.auth).send(body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(await db.count('markets', { slug: body.slug })).toBe(0);
  });

  it('R-V2 — given an admin, when a starting price is below 1%, then 400 VALIDATION_ERROR and no market', async () => {
    const body = newMarket({ initialPrices: [0.695, 0.3, 0.005] });
    const res = await request(ctx.http).post('/markets').set(fx.admin.auth).send(body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(await db.count('markets', { slug: body.slug })).toBe(0);
  });

  it('R-V3 — given an admin, when starting prices sum to 80%, then 400 VALIDATION_ERROR and no market', async () => {
    const body = newMarket({ initialPrices: [0.4, 0.3, 0.1] });
    const res = await request(ctx.http).post('/markets').set(fx.admin.auth).send(body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(await db.count('markets', { slug: body.slug })).toBe(0);
  });

  it('R-V4 — given an admin, when the Spotify week does not start on a Friday, then 400 VALIDATION_ERROR and no market', async () => {
    const res = await request(ctx.http).post('/markets/templates/spotify-weekly').set(fx.admin.auth).send({ weekStart: '2030-01-05' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(await db.count('markets', { slug: `${SPOTIFY_WEEKLY.SLUG_PREFIX}2030-01-05` })).toBe(0);
  });

  it('R-V5 — given an open market, when an admin sets closesAt in the past via PATCH, then 400 VALIDATION_ERROR and the row is unchanged', async () => {
    const res = await request(ctx.http).patch(`/markets/${fx.open.market.id}`).set(fx.admin.auth).send({ closesAt: '2020-01-01T00:00:00Z' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(await db.findOne('markets', { id: fx.open.market.id })).toMatchObject({ closes_at: fx.open.market.closes_at });
  });

  it('R-G1 — given a USER, when they create a market, then 403 FORBIDDEN and no market', async () => {
    const body = newMarket();
    const res = await request(ctx.http).post('/markets').set(fx.user.auth).send(body);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
    expect(await db.count('markets', { slug: body.slug })).toBe(0);
  });

  it('R-G2 — given no session, when a market is edited, then 401 UNAUTHORIZED and the row is unchanged', async () => {
    const res = await request(ctx.http).patch(`/markets/${fx.open.market.id}`).send({ description: 'hijacked' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
    expect(await db.findOne('markets', { id: fx.open.market.id })).toMatchObject({ description: 'BDD fixture' });
  });

  it('R-M1 — given a slug already in use, when a market is created with it, then 409 SLUG_TAKEN and there is still one market', async () => {
    const res = await request(ctx.http).post('/markets').set(fx.admin.auth).send(newMarket({ slug: fx.taken.market.slug }));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SLUG_TAKEN');
    expect(await db.count('markets', { slug: fx.taken.market.slug })).toBe(1);
  });

  it('R-C1 — given an admin, when the same new slug is created twice in parallel, then exactly one market exists and the subsidy is debited once', async () => {
    const subsidyBefore = await db.balance(ACCOUNTS.SUBSIDY);
    const body = newMarket({ slug: fx.raceSlug });
    const [a, b] = await Promise.all([
      request(ctx.http).post('/markets').set(fx.admin.auth).send(body),
      request(ctx.http).post('/markets').set(fx.admin.auth).send(body),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await db.count('markets', { slug: fx.raceSlug })).toBe(1);
    expect(await db.balance(ACCOUNTS.SUBSIDY)).toBe(subsidyBefore - Math.ceil(100 * Math.log(3) * PAYOUT_PER_SHARE_KOBO));
  });

  it('R-S1 — given a market people have traded, when an admin changes its resolution rules, then 422 MARKET_HAS_TRADES and the rules are unchanged', async () => {
    const res = await request(ctx.http).patch(`/markets/${fx.traded.market.id}`).set(fx.admin.auth).send({ resolutionRules: 'Moved the goalposts' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('MARKET_HAS_TRADES');
    expect(await db.findOne('markets', { id: fx.traded.market.id })).toMatchObject({ resolution_rules: 'Resolves on INEC declaration' });
  });

  it('R-S2 — given a RESOLVED market, when an admin closes it, then 422 MARKET_NOT_OPEN and the row is unchanged', async () => {
    const res = await request(ctx.http).post(`/markets/${fx.resolved.market.id}/close`).set(fx.admin.auth).send({});
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('MARKET_NOT_OPEN');
    expect(await db.findOne('markets', { id: fx.resolved.market.id })).toMatchObject({ status: 'RESOLVED', closes_at: fx.resolved.market.closes_at });
  });

  it('R-S3 — given an unknown market id, when an admin edits it, then 404 MARKET_NOT_FOUND and nothing is written', async () => {
    const id = randomUUID();
    const res = await request(ctx.http).patch(`/markets/${id}`).set(fx.admin.auth).send({ description: 'x' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('MARKET_NOT_FOUND');
    expect(await db.count('audit_logs', { table_id: id })).toBe(0);
  });
});
