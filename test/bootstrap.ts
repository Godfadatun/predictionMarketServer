import { INestApplication } from '@nestjs/common';
import { randomUUID, createHmac } from 'crypto';
import jwt from 'jsonwebtoken';
import { DataSource } from 'typeorm';
import { createApp } from '../src/app.factory';
import { cost } from '../src/utils/lmsr';
import { PAYOUT_PER_SHARE_KOBO } from '../src/utils/money';

// Shared e2e harness: one Nest app + real Postgres per spec file; 3rd parties mocked with nock at the HTTP boundary.
let app: INestApplication;
let ds: DataSource;

export const ctx = {
  get http() { return app.getHttpServer(); },
  async start() {
    app = await createApp();
    await app.init();
    ds = app.get(DataSource);
  },
  async stop() { await app?.close(); },
};

type Row = Record<string, any>;
const where = (w: Row, offset = 0) => {
  const keys = Object.keys(w);
  const sql = keys.map((k, i) => (w[k] === null ? `"${k}" IS NULL` : `"${k}" = $${i + 1 + offset}`)).join(' AND ');
  return { sql: keys.length ? `WHERE ${sql}` : '', params: keys.filter((k) => w[k] !== null).map((k) => w[k]) };
};
const insert = async (table: string, row: Row) => {
  const keys = Object.keys(row);
  const [r] = await ds.query(
    `INSERT INTO ${table} (${keys.map((k) => `"${k}"`).join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
    keys.map((k) => row[k]));
  return r as Row;
};

export interface SeededUser { user: Row; sessionId: string; token: string; auth: { Authorization: string } }

export const db = {
  async findOne(table: string, w: Row): Promise<Row | null> {
    const q = where(w);
    const [r] = await ds.query(`SELECT * FROM ${table} ${q.sql} LIMIT 1`, q.params);
    return r ?? null;
  },
  async findMany(table: string, w: Row): Promise<Row[]> {
    const q = where(w);
    return ds.query(`SELECT * FROM ${table} ${q.sql} ORDER BY ctid`, q.params); // insertion order; not every table has created_at
  },
  async count(table: string, w: Row = {}): Promise<number> {
    const q = where(w);
    const [r] = await ds.query(`SELECT COUNT(*)::int AS n FROM ${table} ${q.sql}`, q.params);
    return r.n;
  },
  async balance(code: string): Promise<number> {
    const [r] = await ds.query(`SELECT balance_kobo FROM accounts WHERE code = $1`, [code]);
    return r ? Number(r.balance_kobo) : 0;
  },
  async ensureSystemAccounts() {
    for (const code of ['HOUSE:FEES', 'HOUSE:SUBSIDY', 'CLEARING:PAYSTACK', 'CLEARING:PAYOUTS', 'HOUSE:TRANSFER_FEES'])
      await ds.query(`INSERT INTO accounts (code, kind, balance_kobo, allow_negative) VALUES ($1, 'SYSTEM', 0, $2) ON CONFLICT (code) DO NOTHING`,
        [code, code !== 'HOUSE:FEES']);
  },
  async seedUser(opts: { role?: 'USER' | 'ADMIN'; balanceKobo?: number; sessionExpired?: boolean; fullName?: string } = {}): Promise<SeededUser> {
    const tag = randomUUID().slice(0, 8);
    const user = await insert('users', {
      email: `u-${tag}@test.ng`, phone: `+23480${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
      full_name: opts.fullName ?? `Test ${tag}`, password_hash: 'x', role: opts.role ?? 'USER', status: 'ACTIVE',
    });
    const expires = new Date(Date.now() + (opts.sessionExpired ? -3_600_000 : 3_600_000));
    const session = await insert('sessions', { user_id: user.id, expires_at: expires });
    await insert('accounts', { code: `USER:${user.id}`, kind: 'USER', user_id: user.id, balance_kobo: opts.balanceKobo ?? 0, allow_negative: false });
    const token = jwt.sign({ sid: session.id, sub: user.id }, process.env.JWT_SECRET!);
    return { user, sessionId: session.id, token, auth: { Authorization: `Bearer ${token}` } };
  },
  async seedMarket(opts: { outcomes?: string[]; b?: number; status?: string; closesInMs?: number; shares?: number[]; tradeCount?: number; slug?: string } = {}) {
    const labels = opts.outcomes ?? ['Yes', 'No'];
    const b = opts.b ?? 1000;
    const shares = opts.shares ?? labels.map(() => 0);
    const tag = randomUUID().slice(0, 8);
    const market = await insert('markets', {
      slug: opts.slug ?? `test-${tag}`, title: `Test market ${tag}`, description: 'BDD fixture', category: 'PRESIDENTIAL', state: null,
      status: opts.status ?? 'OPEN', liquidity_b: b, closes_at: new Date(Date.now() + (opts.closesInMs ?? 7 * 86_400_000)),
      resolution_source: 'INEC declaration', resolution_rules: 'Resolves on INEC declaration',
      ...(opts.tradeCount !== undefined && { trade_count: opts.tradeCount }),
    });
    const outcomes = [];
    for (const [i, label] of labels.entries())
      outcomes.push(await insert('outcomes', { market_id: market.id, label, shares: shares[i], sort_order: i }));
    await insert('accounts', { code: `MARKET:${market.id}`, kind: 'MARKET', balance_kobo: Math.ceil(cost(shares, b) * PAYOUT_PER_SHARE_KOBO), allow_negative: false });
    return { market, outcomes };
  },
  async seedPosition(userId: string, marketId: string, outcomeId: string, shares: number, costKobo: number) {
    return insert('positions', { user_id: userId, market_id: marketId, outcome_id: outcomeId, shares, cost_kobo: costKobo });
  },
  async seedTrade(userId: string, marketId: string, outcomeId: string, idempotencyKey: string) {
    return insert('trades', {
      user_id: userId, market_id: marketId, outcome_id: outcomeId, side: 'BUY', shares: 1, amount_kobo: 10000, fee_kobo: 0,
      price_before: 0.5, price_after: 0.5, idempotency_key: idempotencyKey,
    });
  },
  async seedDeposit(userId: string, opts: { amountKobo?: number; status?: string } = {}) {
    return insert('deposits', {
      user_id: userId, reference: `dep_${randomUUID().replace(/-/g, '').slice(0, 20)}`, amount_kobo: opts.amountKobo ?? 500000,
      status: opts.status ?? 'PENDING', provider: 'paystack', authorization_url: 'https://checkout.paystack.test/x',
    });
  },
  async seedPayoutAccount(userId: string, opts: { status?: string; customerCode?: string; recipientCode?: string | null; accountName?: string } = {}) {
    return insert('payout_accounts', {
      user_id: userId, bank_code: '058', bank_name: 'Guaranty Trust Bank', account_number: '0123456789', account_name: opts.accountName ?? 'ADA OBI',
      bvn_last4: '6789', bvn_hash: 'x', status: opts.status ?? 'VERIFIED', paystack_customer_code: opts.customerCode ?? `CUS_${randomUUID().slice(0, 10)}`,
      recipient_code: opts.recipientCode === undefined ? `RCP_${randomUUID().slice(0, 10)}` : opts.recipientCode,
    });
  },
  async seedWithdrawal(userId: string, opts: { status?: string; amountKobo?: number } = {}) {
    return insert('withdrawals', {
      user_id: userId, reference: `wd_${randomUUID().replace(/-/g, '').slice(0, 20)}`, amount_kobo: opts.amountKobo ?? 500000, fee_kobo: 0,
      status: opts.status ?? 'PENDING', source: 'MANUAL', idempotency_key: randomUUID(),
    });
  },
  async seedResolution(marketId: string, proposedBy: string, outcomeId: string | null) {
    await ds.query(`UPDATE markets SET status = 'PENDING_RESOLUTION' WHERE id = $1`, [marketId]);
    return insert('resolutions', { market_id: marketId, outcome_id: outcomeId, is_void: outcomeId === null, source_url: 'https://inecelectionresults.ng', proposed_by: proposedBy });
  },
  // Removes everything a describe seeded (users, markets) and the rows the process wrote for them.
  async clean(users: SeededUser[], marketIds: string[] = []) {
    const uids = users.map((u) => u.user.id);
    const accCodes = [...uids.map((id) => `USER:${id}`), ...marketIds.map((id) => `MARKET:${id}`)];
    const ids = [...uids, ...marketIds];
    await ds.query(`DELETE FROM ledger_entries WHERE tx_ref IN (SELECT tx_ref FROM ledger_entries le JOIN accounts a ON a.id = le.account_id WHERE a.code = ANY($1))`, [accCodes]).catch(() => undefined);
    for (const [t, col, vals] of [
      ['trades', 'user_id', uids], ['trades', 'market_id', marketIds], ['positions', 'user_id', uids], ['positions', 'market_id', marketIds],
      ['deposits', 'user_id', uids], ['withdrawals', 'user_id', uids], ['payout_accounts', 'user_id', uids], ['resolutions', 'market_id', marketIds], ['outcomes', 'market_id', marketIds],
      ['audit_logs', 'actor_id', uids], ['sessions', 'user_id', uids], ['accounts', 'code', accCodes], ['markets', 'id', marketIds], ['users', 'id', uids],
    ] as const) await ds.query(`DELETE FROM ${t} WHERE ${col}::text = ANY($1)`, [vals]).catch(() => undefined);
    await ds.query(`DELETE FROM audit_logs WHERE table_id = ANY($1)`, [ids]).catch(() => undefined);
  },
  async cleanPartnerLogs(provider: string) { await ds.query(`DELETE FROM third_party_logs WHERE provider = $1`, [provider]); },
};

export const paystackSignature = (body: object) =>
  createHmac('sha512', process.env.PAYSTACK_SECRET_KEY!).update(JSON.stringify(body)).digest('hex');
