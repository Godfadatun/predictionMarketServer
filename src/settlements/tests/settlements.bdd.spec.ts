/**
 * settlements.bdd.spec.ts — two-admin (four-eyes) market resolution, winner payouts and void refunds.
 * Real Postgres. No 3rd-party calls (admins resolve from the INEC/Spotify source by hand), so no R-T rows: see README.
 *
 * CASE TABLE
 * | H1   | happy           | market past close; admin A                       | POST propose {outcomeId, sourceUrl}     | 201 PENDING_RESOLUTION   | resolution row proposed_by A; market PENDING_RESOLUTION; no payouts |
 * | H2   | happy           | pending (A, outcome X); U1 10 X, U2 5 Y; admin B | POST confirm                            | 200 RESOLVED             | U1 +100000; U2 +0; market acct 0; subsidy +rest; positions payout; audit |
 * | H3   | happy           | pending VOID by A; U1 cost 60000, U2 cost 30000  | POST confirm (admin B)                  | 200 VOID                 | U1 +60000; U2 +30000; market VOID; market acct 0 |
 * | A1   | amber           | pending (A, outcome X); nobody holds X           | POST confirm (admin B)                  | 200 + NO_WINNING_POSITIONS | market RESOLVED; whole pool back to subsidy |
 * | R-V1 | red/validation  | market past close; admin A                       | propose without sourceUrl               | 400 VALIDATION_ERROR     | no resolution row; market OPEN |
 * | R-V2 | red/validation  | market past close; admin A                       | propose with outcomeId AND void         | 400 VALIDATION_ERROR     | no resolution row |
 * | R-G1 | red/guard       | USER role                                        | propose                                 | 403 FORBIDDEN            | no resolution row |
 * | R-G2 | red/guard       | pending proposed by A                            | A confirms own proposal                 | 403 FOUR_EYES_REQUIRED   | market PENDING_RESOLUTION; no payouts |
 * | R-G3 | red/guard       | no session                                       | propose                                 | 401 UNAUTHORIZED         | no resolution row |
 * | R-M1 | red/middleware  | market already PENDING_RESOLUTION                | propose again                           | 409 RESOLUTION_ALREADY_PROPOSED | still one resolution row |
 * | R-C1 | red/concurrency | pending (A, X); U1 10 X                          | admins B and C confirm in parallel      | 200 + 422                | U1 paid exactly once |
 * | R-S1 | red/data-state  | market still open (closes in future)             | propose                                 | 422 MARKET_STILL_OPEN    | no resolution row; market OPEN |
 * | R-S2 | red/data-state  | market closed, nothing proposed                  | confirm                                 | 422 NO_PENDING_RESOLUTION | market unchanged |
 * | R-S3 | red/data-state  | market past close                                | propose with another market's outcome   | 404 OUTCOME_NOT_FOUND    | no resolution row |
 */
import request from 'supertest';
import { ctx, db, SeededUser } from '../../../test/bootstrap';
import { ACCOUNTS } from '../../wallet/constants/wallet.constants';
import { SETTLEMENT_EVENTS } from '../constants/settlements.constants';

const CLOSED = -60_000;
const SOURCE = 'https://inecelectionresults.ng/elections/2027/presidential';
const proposeUrl = (id: string) => `/markets/${id}/resolution/propose`;
const confirmUrl = (id: string) => `/markets/${id}/resolution/confirm`;

describe('Settlements — Happy paths', () => {
  const fx: Record<string, any> = {};
  beforeAll(async () => {
    await db.ensureSystemAccounts();
    fx.A = await db.seedUser({ role: 'ADMIN' });
    fx.B = await db.seedUser({ role: 'ADMIN' });
    fx.U1 = await db.seedUser();
    fx.U2 = await db.seedUser();
    fx.H1m = await db.seedMarket({ closesInMs: CLOSED });
    fx.H2m = await db.seedMarket({ closesInMs: CLOSED, shares: [10, 5] });
    await db.seedPosition(fx.U1.user.id, fx.H2m.market.id, fx.H2m.outcomes[0].id, 10, 60000);
    await db.seedPosition(fx.U2.user.id, fx.H2m.market.id, fx.H2m.outcomes[1].id, 5, 30000);
    await db.seedResolution(fx.H2m.market.id, fx.A.user.id, fx.H2m.outcomes[0].id);
    fx.H3m = await db.seedMarket({ closesInMs: CLOSED, shares: [10, 5] });
    await db.seedPosition(fx.U1.user.id, fx.H3m.market.id, fx.H3m.outcomes[0].id, 10, 60000);
    await db.seedPosition(fx.U2.user.id, fx.H3m.market.id, fx.H3m.outcomes[1].id, 5, 30000);
    await db.seedResolution(fx.H3m.market.id, fx.A.user.id, null);
  });
  afterAll(async () => { await db.clean([fx.A, fx.B, fx.U1, fx.U2] as SeededUser[], [fx.H1m.market.id, fx.H2m.market.id, fx.H3m.market.id]); });

  it('H1 — given a market past its close, when admin A proposes the winner with a source, then the market waits for a second admin and nobody is paid yet', async () => {
    const res = await request(ctx.http).post(proposeUrl(fx.H1m.market.id)).set(fx.A.auth).send({ outcomeId: fx.H1m.outcomes[1].id, sourceUrl: SOURCE, note: 'INEC Form EC8E' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ marketId: fx.H1m.market.id, status: 'PENDING_RESOLUTION', outcomeId: fx.H1m.outcomes[1].id, isVoid: false, proposedBy: fx.A.user.id });
    expect(await db.findOne('resolutions', { market_id: fx.H1m.market.id })).toMatchObject({ outcome_id: fx.H1m.outcomes[1].id, proposed_by: fx.A.user.id, confirmed_by: null, source_url: SOURCE });
    expect(await db.findOne('markets', { id: fx.H1m.market.id })).toMatchObject({ status: 'PENDING_RESOLUTION' });
    expect(await db.findOne('audit_logs', { event: SETTLEMENT_EVENTS.PROPOSED, table_id: fx.H1m.market.id })).toMatchObject({ actor_id: fx.A.user.id });
  });

  it('H2 — given a pending resolution by admin A, when admin B confirms, then each winning share pays ₦100, losers get nothing and the pool is emptied', async () => {
    const pool = await db.balance(ACCOUNTS.market(fx.H2m.market.id));
    const subsidyBefore = await db.balance(ACCOUNTS.SUBSIDY);

    const res = await request(ctx.http).post(confirmUrl(fx.H2m.market.id)).set(fx.B.auth).send({});

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ marketId: fx.H2m.market.id, status: 'RESOLVED', outcomeId: fx.H2m.outcomes[0].id, confirmedBy: fx.B.user.id, totalPaidKobo: 100000, winners: 1 });
    expect(await db.balance(ACCOUNTS.user(fx.U1.user.id))).toBe(100000);
    expect(await db.balance(ACCOUNTS.user(fx.U2.user.id))).toBe(0);
    expect(await db.balance(ACCOUNTS.market(fx.H2m.market.id))).toBe(0);
    expect(await db.balance(ACCOUNTS.SUBSIDY)).toBe(subsidyBefore + pool - 100000);
    expect(await db.findOne('markets', { id: fx.H2m.market.id })).toMatchObject({ status: 'RESOLVED' });
    expect(await db.findOne('positions', { user_id: fx.U1.user.id, market_id: fx.H2m.market.id })).toMatchObject({ payout_kobo: '100000' });
    expect(await db.findOne('resolutions', { market_id: fx.H2m.market.id })).toMatchObject({ confirmed_by: fx.B.user.id });
    expect(await db.findOne('audit_logs', { event: SETTLEMENT_EVENTS.RESOLVED, table_id: fx.H2m.market.id })).toMatchObject({ actor_id: fx.B.user.id, session_id: fx.B.sessionId });
  });

  it('H3 — given a pending VOID by admin A, when admin B confirms, then every holder gets their stake back and the market is VOID', async () => {
    const res = await request(ctx.http).post(confirmUrl(fx.H3m.market.id)).set(fx.B.auth).send({});

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ marketId: fx.H3m.market.id, status: 'VOID', isVoid: true, totalPaidKobo: 90000 });
    expect(await db.findOne('markets', { id: fx.H3m.market.id })).toMatchObject({ status: 'VOID' });
    expect(await db.findOne('positions', { user_id: fx.U1.user.id, market_id: fx.H3m.market.id })).toMatchObject({ payout_kobo: '60000' });
    expect(await db.findOne('positions', { user_id: fx.U2.user.id, market_id: fx.H3m.market.id })).toMatchObject({ payout_kobo: '30000' });
    expect(await db.balance(ACCOUNTS.market(fx.H3m.market.id))).toBe(0);
    expect(await db.findOne('audit_logs', { event: SETTLEMENT_EVENTS.VOIDED, table_id: fx.H3m.market.id })).toMatchObject({ actor_id: fx.B.user.id });
  });
});

describe('Settlements — Amber paths', () => {
  const fx: Record<string, any> = {};
  beforeAll(async () => {
    await db.ensureSystemAccounts();
    fx.A = await db.seedUser({ role: 'ADMIN' });
    fx.B = await db.seedUser({ role: 'ADMIN' });
    fx.U1 = await db.seedUser();
    fx.m = await db.seedMarket({ closesInMs: CLOSED, shares: [0, 8] });
    await db.seedPosition(fx.U1.user.id, fx.m.market.id, fx.m.outcomes[1].id, 8, 45000);
    await db.seedResolution(fx.m.market.id, fx.A.user.id, fx.m.outcomes[0].id);
  });
  afterAll(async () => { await db.clean([fx.A, fx.B, fx.U1], [fx.m.market.id]); });

  it('A1 — given nobody holds the winning outcome, when admin B confirms, then the market resolves with a warning and the whole pool returns to the subsidy account', async () => {
    const pool = await db.balance(ACCOUNTS.market(fx.m.market.id));
    const subsidyBefore = await db.balance(ACCOUNTS.SUBSIDY);

    const res = await request(ctx.http).post(confirmUrl(fx.m.market.id)).set(fx.B.auth).send({});

    expect(res.status).toBe(200);
    expect(res.body.warnings).toEqual(['NO_WINNING_POSITIONS']);
    expect(res.body.data).toMatchObject({ status: 'RESOLVED', totalPaidKobo: 0, winners: 0 });
    expect(await db.findOne('markets', { id: fx.m.market.id })).toMatchObject({ status: 'RESOLVED' });
    expect(await db.balance(ACCOUNTS.SUBSIDY)).toBe(subsidyBefore + pool);
    expect(await db.balance(ACCOUNTS.user(fx.U1.user.id))).toBe(0);
  });
});

describe('Settlements — Red paths', () => {
  const fx: Record<string, any> = {};
  beforeAll(async () => {
    await db.ensureSystemAccounts();
    fx.A = await db.seedUser({ role: 'ADMIN' });
    fx.B = await db.seedUser({ role: 'ADMIN' });
    fx.C = await db.seedUser({ role: 'ADMIN' });
    fx.U = await db.seedUser();
    fx.U1 = await db.seedUser();
    fx.mV = await db.seedMarket({ closesInMs: CLOSED });
    fx.mG2 = await db.seedMarket({ closesInMs: CLOSED });
    await db.seedResolution(fx.mG2.market.id, fx.A.user.id, fx.mG2.outcomes[0].id);
    fx.mM1 = await db.seedMarket({ closesInMs: CLOSED });
    await db.seedResolution(fx.mM1.market.id, fx.A.user.id, fx.mM1.outcomes[0].id);
    fx.mC1 = await db.seedMarket({ closesInMs: CLOSED, shares: [10, 0] });
    await db.seedPosition(fx.U1.user.id, fx.mC1.market.id, fx.mC1.outcomes[0].id, 10, 52000);
    await db.seedResolution(fx.mC1.market.id, fx.A.user.id, fx.mC1.outcomes[0].id);
    fx.mOpen = await db.seedMarket();
    fx.mNone = await db.seedMarket({ closesInMs: CLOSED });
    fx.mOther = await db.seedMarket({ closesInMs: CLOSED });
  });
  afterAll(async () => {
    await db.clean([fx.A, fx.B, fx.C, fx.U, fx.U1],
      [fx.mV.market.id, fx.mG2.market.id, fx.mM1.market.id, fx.mC1.market.id, fx.mOpen.market.id, fx.mNone.market.id, fx.mOther.market.id]);
  });

  it('R-V1 — given a closed market, when admin A proposes without a sourceUrl, then 400 VALIDATION_ERROR and nothing is written', async () => {
    const res = await request(ctx.http).post(proposeUrl(fx.mV.market.id)).set(fx.A.auth).send({ outcomeId: fx.mV.outcomes[0].id });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(await db.count('resolutions', { market_id: fx.mV.market.id })).toBe(0);
    expect(await db.findOne('markets', { id: fx.mV.market.id })).toMatchObject({ status: 'OPEN' });
  });

  it('R-V2 — given a closed market, when admin A proposes both a winner and void, then 400 VALIDATION_ERROR and nothing is written', async () => {
    const res = await request(ctx.http).post(proposeUrl(fx.mV.market.id)).set(fx.A.auth).send({ outcomeId: fx.mV.outcomes[0].id, void: true, sourceUrl: SOURCE });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(await db.count('resolutions', { market_id: fx.mV.market.id })).toBe(0);
  });

  it('R-G1 — given a USER, when they propose a resolution, then 403 FORBIDDEN and nothing is written', async () => {
    const res = await request(ctx.http).post(proposeUrl(fx.mV.market.id)).set(fx.U.auth).send({ outcomeId: fx.mV.outcomes[0].id, sourceUrl: SOURCE });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
    expect(await db.count('resolutions', { market_id: fx.mV.market.id })).toBe(0);
  });

  it('R-G2 — given admin A proposed, when admin A also tries to confirm, then 403 FOUR_EYES_REQUIRED and nobody is paid', async () => {
    const res = await request(ctx.http).post(confirmUrl(fx.mG2.market.id)).set(fx.A.auth).send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FOUR_EYES_REQUIRED');
    expect(await db.findOne('markets', { id: fx.mG2.market.id })).toMatchObject({ status: 'PENDING_RESOLUTION' });
    expect(await db.findOne('resolutions', { market_id: fx.mG2.market.id })).toMatchObject({ confirmed_by: null });
  });

  it('R-G3 — given no session, when a resolution is proposed, then 401 UNAUTHORIZED and nothing is written', async () => {
    const res = await request(ctx.http).post(proposeUrl(fx.mV.market.id)).send({ outcomeId: fx.mV.outcomes[0].id, sourceUrl: SOURCE });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
    expect(await db.count('resolutions', { market_id: fx.mV.market.id })).toBe(0);
  });

  it('R-M1 — given a resolution already pending, when another proposal is posted, then 409 RESOLUTION_ALREADY_PROPOSED and there is still one proposal', async () => {
    const res = await request(ctx.http).post(proposeUrl(fx.mM1.market.id)).set(fx.B.auth).send({ outcomeId: fx.mM1.outcomes[1].id, sourceUrl: SOURCE });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('RESOLUTION_ALREADY_PROPOSED');
    expect(await db.count('resolutions', { market_id: fx.mM1.market.id })).toBe(1);
    expect(await db.findOne('resolutions', { market_id: fx.mM1.market.id })).toMatchObject({ outcome_id: fx.mM1.outcomes[0].id });
  });

  it('R-C1 — given a pending resolution, when admins B and C confirm at the same time, then exactly one settles and the winner is paid once', async () => {
    const [a, b] = await Promise.all([
      request(ctx.http).post(confirmUrl(fx.mC1.market.id)).set(fx.B.auth).send({}),
      request(ctx.http).post(confirmUrl(fx.mC1.market.id)).set(fx.C.auth).send({}),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 422]);
    expect(await db.balance(ACCOUNTS.user(fx.U1.user.id))).toBe(100000);
    expect(await db.count('ledger_entries', { kind: 'PAYOUT', tx_ref: `settle:${fx.mC1.market.id}` })).toBe(2);
  });

  it('R-S1 — given a market still open for trading, when a resolution is proposed, then 422 MARKET_STILL_OPEN and nothing is written', async () => {
    const res = await request(ctx.http).post(proposeUrl(fx.mOpen.market.id)).set(fx.A.auth).send({ outcomeId: fx.mOpen.outcomes[0].id, sourceUrl: SOURCE });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('MARKET_STILL_OPEN');
    expect(await db.count('resolutions', { market_id: fx.mOpen.market.id })).toBe(0);
    expect(await db.findOne('markets', { id: fx.mOpen.market.id })).toMatchObject({ status: 'OPEN' });
  });

  it('R-S2 — given no pending proposal, when an admin confirms, then 422 NO_PENDING_RESOLUTION and the market is unchanged', async () => {
    const res = await request(ctx.http).post(confirmUrl(fx.mNone.market.id)).set(fx.B.auth).send({});
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('NO_PENDING_RESOLUTION');
    expect(await db.findOne('markets', { id: fx.mNone.market.id })).toMatchObject({ status: 'OPEN' });
  });

  it("R-S3 — given a closed market, when the proposed outcome belongs to another market, then 404 OUTCOME_NOT_FOUND and nothing is written", async () => {
    const res = await request(ctx.http).post(proposeUrl(fx.mNone.market.id)).set(fx.A.auth).send({ outcomeId: fx.mOther.outcomes[0].id, sourceUrl: SOURCE });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('OUTCOME_NOT_FOUND');
    expect(await db.count('resolutions', { market_id: fx.mNone.market.id })).toBe(0);
  });
});
