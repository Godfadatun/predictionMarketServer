# Prediction Market API (Nigeria)

The NestJS + Postgres backend for a naira prediction market. Launch markets cover the **2027 presidential election** (national plus all 36 states and the FCT), **2027 governorship races** and the **Spotify Nigeria weekly #1**.

Frontend: [`predictionMarket`](https://github.com/godfadatun/predictionMarket).

## How the money works

| Concept | Implementation |
|---|---|
| Pricing | **LMSR** automated market maker (`src/utils/lmsr.ts`). Each market has liquidity `b`. Prices always sum to 1, so 0.62 means a 62% chance. |
| Shares | A winning share pays **₦100**. A losing share pays ₦0. |
| House risk | When a market is created, its pool is funded from `HOUSE:SUBSIDY` with the LMSR worst-case loss `b·ln(n)`. The seeded catalogue's total exposure is about ₦12.1m at the default `b` values. Tune `liquidityB` per market. |
| Fees | 2% on buys and sells (`TRADE_FEE_BPS`), credited to `HOUSE:FEES`. |
| Ledger | **Double-entry.** Every balance change is a transaction whose legs sum to 0 (`LedgerService.post`). Accounts are row-locked in code order. User accounts can never go negative. |
| Deposits | Paystack `transaction/initialize`, then a user verify call or the signed `charge.success` webhook. Both **re-verify with Paystack** before crediting. A paid amount that doesn't match the deposit marks it `FLAGGED` for manual review. |
| Resolution | **Four-eyes.** Admin A proposes the winner (or VOID) with a source URL. Admin B, who must be someone else, confirms. Winners are paid ₦100/share, VOID refunds net cost basis, and what's left in the pool is swept back to the subsidy account. |

### Resolution policy (baked into the seeded market rules)
- Election markets resolve on the **INEC declaration** (EC8D state collation, EC8E national), cross-checked on IReV. **Later tribunal or court rulings do not change the result.**
- If an election is postponed by more than 30 days, the market is voided and stakes are refunded.
- Spotify markets resolve on the **lead artist** of the #1 track on the official Weekly Top Songs – Nigeria chart.

## API

| Method | Path | Auth |
|---|---|---|
| POST | `/auth/register` · `/auth/login` · `/auth/logout` | – / – / user |
| GET | `/auth/me` | user |
| GET | `/markets?category=&state=&status=` · `/markets/:idOrSlug` | public |
| POST | `/markets` | admin |
| POST | `/markets/:marketId/trades` `{outcomeId, side, amountKobo│shares, idempotencyKey, minShares?, minProceedsKobo?}` | user |
| GET | `/positions` | user |
| GET | `/wallet` · `/wallet/ledger` | user |
| POST | `/wallet/deposits` `{amountKobo}` · `/wallet/deposits/:reference/verify` | user |
| POST | `/wallet/webhooks/paystack` | Paystack HMAC signature |
| GET | `/markets/:marketId/resolution` | public |
| POST | `/markets/:marketId/resolution/propose` · `/confirm` | admin (two different admins) |

Every response is `{ success, message, data, warnings? }`. Errors are `{ success: false, code, message }`.

## Running locally

```bash
cp .env.example .env               # set DATABASE_URL, JWT_SECRET, PAYSTACK_SECRET_KEY
createdb pm_dev && createdb pm_test
npm ci
npm run seed                       # admin user + 49 launch markets (idempotent)
npm run start:dev                  # http://localhost:4000
npm test                           # BDD files against pm_test (Postgres must be running)
```

`synchronize` builds the schema in development and tests. **Switch to TypeORM migrations before production.**

## Code layout

Each feature (`auth`, `wallet`, `markets`, `trades`, `settlements`) follows the feature-module standard: a controller at the root, then `services/`, `repositories/` (the only place entities are touched), `dto/` (Joi), `interfaces/`, `constants/`, `sanitizers/`, `integrations/<provider>/` (client + versioned mocks + `systemSettings` switch) and `tests/`.

Shared code lives at app level: `src/common` (guards, pipes, filters, responses, unit of work, audit), `src/errors`, `src/integrations` (outbound HTTP client that writes `third_party_logs`), and `src/utils` (LMSR, money).

## Proof (BDD)

There is one BDD file per money-moving feature: `src/{wallet,trades,settlements}/tests/*.bdd.spec.ts`. That's **53 cases** (happy, amber and red). Each case asserts the response **and** the DB state, the ledger legs, the audit log and the partner log.

- Red run (commit `26a3761`): `Tests: 53 failed, 53 total`.
- Green run: `Tests: 53 passed, 53 total`. The spec files are unchanged between the red and green commits.

### Known lint conflicts (not fixed by weakening the linters)
1. **`bdd-lint` → "missing mandatory red class: third-party"** for `trades` and `settlements`. Neither feature calls a partner (pricing and resolution are in-house), so an R-T row would be fabricated. The R-T coverage lives in `wallet` (Paystack 500, timeout, malformed body).
2. **`layout-lint` → "comment block longer than 4 lines"** on each `tests/*.bdd.spec.ts`. The BDD standard requires the case table as the spec's header comment, which conflicts with the layout standard's 4-line comment cap.

### Not yet covered
- `auth` and `markets` (create/list) have no BDD file yet.
- The Postman/newman counter-tests against staging aren't generated yet because there is no staging URL.

## Before taking real money
- **Licensing.** Obtain a state gaming licence (for example Lagos LSLGA) plus a reciprocity certificate, and engage the SEC. The legal status of prediction markets is not settled.
- **KYC.** Add BVN/NIN verification before withdrawals. Withdrawals (Paystack Transfers) are not built yet.
- **Withdrawals and limits.** Add per-user exposure caps and responsible-gambling limits.
- **Migrations, rate limiting and admin MFA.**
