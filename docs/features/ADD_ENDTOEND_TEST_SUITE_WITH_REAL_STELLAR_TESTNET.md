# End-to-End Test Suite with Real Stellar Testnet

## Overview

This document describes the e2e test suite added in issue #371. Unlike the existing unit tests that use `MockStellarService`, the e2e suite runs against the **live Stellar testnet** to validate real blockchain interactions including Friendbot account funding, XLM payment submission, ledger confirmation, and balance queries.

---

## Why E2E Tests?

The mock service is fast and deterministic, but it cannot catch:

- Sequence number management issues on the real Stellar network
- Friendbot funding quirks (rate limits, network delays)
- Horizon API response format changes
- Transaction submission and confirmation timing
- Real balance deduction after a payment

The e2e suite fills that gap by running the full stack — HTTP request → Express middleware → service layer → Stellar SDK → Horizon API → Stellar testnet — against real infrastructure.

---

## Directory Structure

```
tests/e2e/
├── setup.js                  # Global setup: env vars + DB bootstrap
├── teardown.js               # Global teardown: wallet store cleanup
├── helpers/
│   ├── retry.js              # withRetry(), waitUntil(), computeBackoff()
│   └── testnet.js            # Account creation, Friendbot, DB seeding
├── wallet.e2e.test.js        # Wallet creation, balance, metadata tests
├── donation.e2e.test.js      # Full donation workflow tests
└── transaction.e2e.test.js   # Transaction history and verification tests

jest.config.e2e.js            # Separate Jest config for the e2e suite
.github/workflows/e2e-nightly.yml  # Nightly CI job
```

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Node.js 18+ | Same as the main app |
| Internet access | The suite calls `horizon-testnet.stellar.org` |
| No special API key | Friendbot is public; no credentials needed |
| `ENCRYPTION_KEY` env var | Optional locally — falls back to a hardcoded dev value |

---

## Running Locally

```bash
# Install dependencies (if not already done)
npm ci

# Run the full e2e suite
npm run test:e2e
```

> **Expected duration**: 3–10 minutes depending on testnet responsiveness.
> Tests run **serially** (`maxWorkers: 1`) to stay within Friendbot rate limits.

### Required Environment Variables

All variables have sensible defaults for local development. In CI they are supplied explicitly:

| Variable | Required in CI | Default (local) | Description |
|---|---|---|---|
| `MOCK_STELLAR` | Yes (`false`) | `false` (set by `setup.js`) | Must be `false` to hit the real testnet |
| `STELLAR_ENVIRONMENT` | Yes (`testnet`) | `testnet` | Targets testnet Horizon |
| `NODE_ENV` | Yes (`test`) | `test` | Disables production-only validations |
| `API_KEYS` | Yes | `e2e-test-key,e2e-admin-key` | Keys used by the e2e HTTP tests |
| `ENCRYPTION_KEY` | Recommended | Auto-generated dev value | Stable key for DB-seeded secrets |

---

## How Test Accounts Are Created

Each test suite that needs funded accounts calls `createFundedAccount()` or `createFundedUser()` from `tests/e2e/helpers/testnet.js`:

1. A random Stellar keypair is generated with `StellarSdk.Keypair.random()`.
2. The public key is passed to `StellarService.fundWithFriendbot()`, which calls the Stellar testnet Friendbot endpoint. Friendbot deposits **10,000 XLM** into the new account.
3. `waitForBalance()` polls Horizon until the balance is confirmed on-chain before any test sends a transaction from that account.

For custodial donation tests (where the API decrypts a secret from the DB):

4. The secret key is encrypted with `encryption.encrypt()` using the configured `ENCRYPTION_KEY`.
5. The user row is inserted into the SQLite DB with `Database.run('INSERT INTO users ...')`.

---

## Retry Logic

Testnet operations are inherently flaky. The `withRetry()` helper in `tests/e2e/helpers/retry.js` wraps any async operation with exponential backoff:

```
delay = random(0, min(baseDelayMs × 2^(attempt-1), maxDelayMs))
```

| Parameter | Friendbot calls | Transaction verification |
|---|---|---|
| `maxAttempts` | 5 | 5 |
| `baseDelayMs` | 2 000 ms | 2 000 ms |
| `maxDelayMs` | 30 000 ms | 30 000 ms |

The `shouldRetry` predicate (optional) lets callers surface non-retryable errors immediately (e.g. validation errors) without burning through all attempts.

---

## CI: Nightly Run

The nightly workflow at `.github/workflows/e2e-nightly.yml`:

- Triggers automatically at **midnight UTC** every day via `cron: '0 0 * * *'`.
- Can also be triggered manually from the GitHub Actions UI (`workflow_dispatch`).
- Has a 30-minute wall-clock limit.
- On failure, posts a comment on the failing commit with a link to the run log.

### Adding the Encryption Key Secret

In the GitHub repository settings, add a secret named `E2E_ENCRYPTION_KEY` with any 32-character string. This ensures the same key is used to encrypt and later decrypt test secrets during CI runs.

```
Settings → Secrets and variables → Actions → New repository secret
Name: E2E_ENCRYPTION_KEY
Value: <32-character string>
```

---

## Test Coverage

| Area | Test file | What is tested |
|---|---|---|
| Wallet creation | `wallet.e2e.test.js` | POST /wallets auto-funds via Friendbot; GET balance returns positive XLM |
| Wallet metadata | `wallet.e2e.test.js` | PATCH updates label and ownerName; GET by ID returns correct data |
| Wallet listing | `wallet.e2e.test.js` | GET /wallets returns paginated list |
| Donation (service) | `donation.e2e.test.js` | `sendDonation()` returns a 64-char tx hash; balance decreases by donation amount |
| Donation (HTTP) | `donation.e2e.test.js` | POST /donations/send decrypts secret, submits real tx, returns transactionId |
| Idempotency | `donation.e2e.test.js` | Replaying same idempotency key returns cached response, no second tx |
| Non-custodial record | `donation.e2e.test.js` | POST /donations creates a record without an on-chain tx |
| Verification (service) | `donation.e2e.test.js` | `verifyTransaction()` returns `verified: true` for a known hash |
| Verification (HTTP) | `donation.e2e.test.js` | POST /donations/verify returns verified: true |
| Transaction history | `transaction.e2e.test.js` | `getTransactionHistory()` returns real on-chain records for the account |
| Transaction list API | `transaction.e2e.test.js` | GET /transactions returns paginated DB records |
| Wallet transactions | `transaction.e2e.test.js` | GET /wallets/:publicKey/transactions returns DB history for a wallet |

---

## Troubleshooting

**Tests time out waiting for Friendbot**
Stellar testnet can be under load. The Friendbot retry loop allows up to 5 attempts with up to 30 s delay. If the testnet is in maintenance, wait and re-run manually with `workflow_dispatch`.

**"Sender has no secret key configured" error**
The `ENCRYPTION_KEY` used when seeding the DB does not match the key used when the app decrypts it. Ensure the key is stable across setup and test execution (see [Adding the Encryption Key Secret](#adding-the-encryption-key-secret)).

**Duplicate wallet address error**
The wallets.json was not cleaned up from a previous run. Delete `./data/wallets.json` and re-run. The `teardown.js` normally handles this automatically.

**"SQLITE_CONSTRAINT: UNIQUE" on transactions**
Two test runs sharing the same DB. The `setup.js` deletes and recreates `./data/stellar_donations.db` at the start of each run.
