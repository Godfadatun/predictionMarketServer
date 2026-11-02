# Prediction Market API (Nigeria)

The NestJS + Postgres backend for a naira prediction market. Launch markets cover the **2027 presidential election** (national plus all 36 states and the FCT), **2027 governorship races** and the **Spotify Nigeria weekly #1**.

Frontend: [`predictionMarket`](https://github.com/godfadatun/predictionMarket).

## How the money works

| Concept | Implementation |
|---|---|
| Pricing | **LMSR** automated market maker (`src/utils/lmsr.ts`). Each market has liquidity `b`. Prices always sum to 1, so 0.62 means a 62% chance. |
| Shares | A winning share pays **₦100**. A losing share pays ₦0. |
| House risk | When a market is created, its pool is funded from `HOUSE:SUBSIDY` with the LMSR worst-case loss `b·ln(n)`. The seeded catalogue's worst-case total is about ₦3.1m. Tune `liquidityB` per market: a lower `b` means cheaper to run but prices move more per trade. |
| Fees | 2% on buys and sells (`TRADE_FEE_BPS`), credited to `HOUSE:FEES`. |
| Ledger | **Double-entry.** Every balance change is a transaction whose legs sum to 0 (`LedgerService.post`). Accounts are row-locked in code order. User accounts can never go negative. |
| Deposits | Paystack `transaction/initialize`, then a user verify call or the signed `charge.success` webhook. Both **re-verify with Paystack** before crediting. A paid amount that doesn't match the deposit marks it `FLAGGED` for manual review. |
| Starting odds | Admins set them when creating a market (`initialPrices`, each ≥1%). The LMSR state is set to `q_i = b·ln(p_i/p_min)` and the pool is funded with the worst case `b·ln(1/p_min)`. Equal odds are used if none are given. |
| Withdrawals | Funds move `USER → CLEARING:PAYOUTS` before Paystack is called. On success they go `→ CLEARING:PAYSTACK`. On rejection the user is refunded. On a **timeout the user is NOT refunded**, because the transfer may have gone through; the `transfer.*` webhook settles it. The house absorbs Paystack's ₦10/₦25/₦50 transfer fee (`HOUSE:TRANSFER_FEES`). |
| Auto-payout | When a market resolves, winnings of **₦1,000 or more** are sent straight to the winner's verified bank account. Smaller amounts, users without a verified account, and any transfer error leave the money in the wallet. |
| KYC | **BVN + name match via Paystack.** `bank/resolve` gives the account name, which must share at least 2 name tokens with the profile. Then `customer/:code/identification` asks Paystack to confirm the BVN owns that account, asynchronously via the `customeridentification.*` webhook. Only the last 4 BVN digits and a peppered hash are stored. |
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
| POST | `/wallet/webhooks/paystack` (charge, transfer and KYC events) | Paystack HMAC signature |
| GET | `/payouts/banks` · `/payouts/account` · `/payouts/withdrawals` | user |
| POST | `/payouts/account` `{bankCode, accountNumber, bvn}` · `/payouts/withdrawals` `{amountKobo, idempotencyKey}` | user |
| PATCH | `/markets/:id` (title, rules and source are frozen after the first trade) | admin |
| POST | `/markets/:id/close` · `/markets/templates/spotify-weekly` `{weekStart}` | admin |
| GET | `/markets/:marketId/resolution` | public |
| POST | `/markets/:marketId/resolution/propose` · `/confirm` | admin (two different admins) |

Every response is `{ success, message, data, warnings? }`. Errors are `{ success: false, code, message }`.

## Running locally

```bash
cp .env.example .env               # set DATABASE_URL, JWT_SECRET, PAYSTACK_SECRET_KEY
createdb pm_dev && createdb pm_test
npm ci
npm run seed                       # admin user + 49 launch markets + next week's Spotify market (idempotent)
npm run start:dev                  # http://localhost:4000
npm test                           # BDD files against pm_test (Postgres must be running)
```

### Paystack dashboard setup
- Webhook URL: `<api>/wallet/webhooks/paystack`. It receives `charge.success`, `transfer.success`, `transfer.failed`, `transfer.reversed`, `customeridentification.success` and `customeridentification.failed`.
- **Disable the transfer OTP** (Settings → Preferences) so API transfers complete without a manual OTP, and keep the Paystack balance funded for payouts.
- A cron opens the next Spotify week's market every Wednesday at 12:00 WAT.

`synchronize` builds the schema in development and tests. **Switch to TypeORM migrations before production.**

## Code layout

Each feature (`auth`, `wallet`, `markets`, `trades`, `settlements`, `payouts`) follows the feature-module standard: a controller at the root, then `services/`, `repositories/` (the only place entities are touched), `dto/` (Joi), `interfaces/`, `constants/`, `sanitizers/`, `integrations/<provider>/` (client + versioned mocks + `systemSettings` switch) and `tests/`.

Shared code lives at app level: `src/common` (guards, pipes, filters, responses, unit of work, audit), `src/errors`, `src/integrations` (outbound HTTP client that writes `third_party_logs`), and `src/utils` (LMSR, money).

## Proof (BDD)

There is one BDD file per feature: `src/{wallet,trades,settlements,markets,payouts}/tests/*.bdd.spec.ts`. That's **97 cases** (happy, amber and red). Each case asserts the response **and** the DB state, the ledger legs, the audit log and the partner log.

- Red runs: commit `26a3761` (wallet, trades, settlements) gave `53 failed`; commit `0fe5eb7` (markets, payouts) gave `44 failed, 0 passed`.
- Green run: `Tests: 97 passed, 97 total`. The spec files are unchanged since their red commits. The only harness change was `findMany` ordering by `ctid`.

### Known lint conflicts (not fixed by weakening the linters)
1. **`bdd-lint` → "missing mandatory red class: third-party"** for `trades`, `settlements` and `markets`. Neither feature calls a partner (pricing and resolution are in-house), so an R-T row would be fabricated. The R-T coverage lives in `wallet` (Paystack 500, timeout, malformed body).
2. **`layout-lint` → "comment block longer than 4 lines"** on each `tests/*.bdd.spec.ts`. The BDD standard requires the case table as the spec's header comment, which conflicts with the layout standard's 4-line comment cap.

### Not yet covered
- `auth` has no BDD file yet.
- The Postman/newman counter-tests against staging aren't generated yet because there is no staging URL.

## Before taking real money
- **Licensing.** Obtain a state gaming licence (for example Lagos LSLGA) plus a reciprocity certificate, and engage the SEC. The legal status of prediction markets is not settled.
- **Reconciliation job.** A cron should call `transfer/verify` for withdrawals stuck in `PENDING` (the unknown-timeout case) and settle them.
- **Limits.** Add per-user exposure caps and responsible-gambling limits.
- **Auto-payout at scale.** Payouts run inline after settlement. Move them to a queue before markets have thousands of winners.
- **Migrations, rate limiting and admin MFA.**
