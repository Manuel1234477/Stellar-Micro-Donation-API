# End-to-End Testing — Stellar Testnet

This document describes the E2E test suite that runs real transactions against the Stellar testnet network.

## Overview

The E2E test suite provides comprehensive coverage of the entire donation lifecycle on the real Stellar testnet:

- **Account Creation**: Tests fund accounts via Friendbot and verify balances
- **XLM Transfers**: Tests real XLM payments using the StellarService
- **Donation API**: Tests API endpoints for creating and verifying donations
- **Transaction Verification**: Tests that transactions are recorded on the ledger
- **Idempotency**: Tests that repeated requests return cached responses

## Running E2E Tests Locally

### Prerequisites

1. **Environment Variables**: Set up your `.env` file with:
   ```env
   MOCK_STELLAR=false
   STELLAR_ENVIRONMENT=testnet
   ENCRYPTION_KEY=<your-64-char-hex-key>
   API_KEYS=e2e-test-key,e2e-admin-key
   ```

2. **Node.js**: Requires Node.js 20 or higher

3. **Network Access**: Your environment must have internet access to Stellar testnet

### Running the Test Suite

To run the E2E test suite against Stellar testnet:

```bash
npm run test:e2e
```

This command:
- Uses `jest.config.e2e.js` configuration
- Targets only `tests/e2e/**/*.e2e.test.js` files
- Sets MOCK_STELLAR=false to ensure real network calls
- Runs tests serially (maxWorkers: 1) to respect Friendbot rate limits
- Applies a 60-second timeout per test for real network operations

### Running Specific E2E Tests

To run a single E2E test file:

```bash
npm run test:e2e tests/e2e/donation.e2e.test.js
```

To run a specific test within a file:

```bash
npm run test:e2e --testNamePattern="sends a real XLM payment"
```

## Nightly CI Workflow

The nightly E2E workflow automatically runs at midnight UTC and on manual dispatch:

**Workflow File**: `.github/workflows/e2e-nightly.yml`

**Triggers**:
- Scheduled: Every day at midnight UTC
- Manual: Dispatch via GitHub Actions UI

**Failure Notification**:
- Automatically posts a comment on the commit when the nightly run fails
- Provides links to the workflow run and common troubleshooting tips

**Configuration**:
- Uses funded test accounts stored in GitHub Secrets
- Sets MOCK_STELLAR=false for real network testing
- Runs with a 30-minute timeout for the entire suite
- Targets Stellar testnet environment

## E2E Test Files

### `tests/e2e/donation.e2e.test.js`

Tests the donation lifecycle:
- Service-layer direct calls to StellarService
- HTTP API endpoints for donations
- Transaction verification on ledger
- Idempotency key handling

**Coverage**:
- `POST /api/v1/donations` — Create non-custodial donation
- `POST /api/v1/donations/send` — Custodial donation (decrypts secret from DB)
- `POST /api/v1/donations/verify` — Verify transaction on ledger
- Idempotency: same request returns cached response
- Error handling: missing encryptedSecret, invalid amounts

### `tests/e2e/wallet.e2e.test.js`

Tests wallet management:
- Wallet creation and metadata storage
- Account balance queries
- Transaction history retrieval

### `tests/e2e/transaction.e2e.test.js`

Tests transaction operations:
- Direct Stellar network calls
- Transaction building and submission
- Ledger confirmation

## E2E Helpers

### `tests/e2e/helpers/testnet.js`

Provides utilities for testnet interactions:
- `createTestnetService()` — Create StellarService for testnet
- `createFundedAccount()` — Fund an account via Friendbot
- `createFundedUser()` — Create and store a user in the database
- `generateKeypair()` — Generate a new Stellar keypair
- `waitForBalance()` — Poll until account shows expected balance

### `tests/e2e/helpers/retry.js`

Provides retry logic for transient failures:
- `withRetry()` — Retry a function with exponential backoff
- `waitUntil()` — Poll until a condition becomes true
- `computeBackoff()` — Calculate exponential backoff delay

## Test Isolation and Cleanup

Each E2E test runs with:
- Fresh funded keypairs created via Friendbot
- Independent database tables
- No shared state between tests

**Global Setup** (`tests/e2e/setup.js`):
- Clears the database before the suite runs
- Sets MOCK_STELLAR=false
- Ensures encryption key is stable for CI

**Global Teardown** (`tests/e2e/teardown.js`):
- Cleans up test resources
- Restores any backed-up data

## Troubleshooting

### Tests Time Out

**Cause**: Stellar testnet is slow or Friendbot is rate-limited

**Solution**:
- Wait 1-2 hours for rate limits to reset
- Check Stellar testnet status: https://status.stellar.org/

### "Friendbot Rate Limit Exceeded"

**Cause**: Too many account creation requests in a short time

**Solution**:
- The E2E suite runs serially (maxWorkers: 1) to minimize this
- If running locally in parallel, set `maxWorkers: 1` in jest.config.e2e.js
- Wait an hour before retrying

### "No Balance After Friendbot Fund"

**Cause**: Testnet network lag

**Solution**:
- The test suite includes `waitForBalance()` helper with retry logic
- If this fails repeatedly, check testnet status

### Transaction Fails to Verify

**Cause**: Ledger hasn't closed yet

**Solution**:
- Tests include `withRetry()` helper with exponential backoff
- If you see this in CI, report it to the Stellar team

## Configuration

### Environment Variables

- `MOCK_STELLAR`: Must be `false` for E2E tests (enforced in setup.js)
- `STELLAR_ENVIRONMENT`: Must be `testnet` (enforced in setup.js)
- `ENCRYPTION_KEY`: Stable 64-char hex key for secrets (can be overridden with GitHub Secret)
- `API_KEYS`: E2E test API keys (default: `e2e-test-key,e2e-admin-key`)

### Jest Configuration

Located in `jest.config.e2e.js`:
- `testMatch`: Only targets `**/*.e2e.test.js` files
- `maxWorkers: 1`: Serial execution to avoid Friendbot rate limits
- `testTimeout: 60000`: 60-second timeout per test for real network ops
- `globalSetup`/`globalTeardown`: E2E-specific setup and cleanup

## Integration with CI

The nightly workflow (`.github/workflows/e2e-nightly.yml`):

1. Triggers daily at 00:00 UTC
2. Runs `npm run test:e2e` on Ubuntu
3. Uses GitHub Secrets for ENCRYPTION_KEY and other sensitive values
4. Posts failure comments to the commit with links and troubleshooting tips
5. Returns non-zero exit code on test failure (blocks merge if branch protection is enabled)

To manually trigger the nightly run:
1. Go to GitHub Actions
2. Select "E2E Testnet Nightly" workflow
3. Click "Run workflow"

## Best Practices

1. **Run E2E tests before merging to main**
   - Fix any real-network issues before they reach production
   - The nightly workflow catches issues automatically

2. **Isolate E2E tests from unit tests**
   - Keep E2E tests in `tests/e2e/**/*.e2e.test.js`
   - Use `npm run test:e2e` for E2E, `npm test` for unit tests

3. **Use retry logic for transient failures**
   - Network hiccups are common on testnet
   - The helpers include retry and waitUntil utilities

4. **Mock Stellar for unit/integration tests**
   - E2E tests verify real behavior
   - Unit tests verify code logic (faster, no network dependency)
   - Set `MOCK_STELLAR=true` (default) for standard tests

## See Also

- [Stellar Testnet Documentation](https://developers.stellar.org/learn/networks/testnet)
- [Friendbot Faucet](https://developers.stellar.org/learn/networks/testnet#fund-your-account)
- [Jest Configuration Guide](https://jestjs.io/docs/configuration)
- [CI Pipeline Documentation](./CI_PIPELINE.md)
