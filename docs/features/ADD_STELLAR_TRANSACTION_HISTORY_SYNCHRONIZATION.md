# Add Stellar Transaction History Synchronization

**Issue #386** — Scheduled background sync of wallet transactions from the Stellar Horizon network.

## Overview

This feature adds a robust, scheduled background service that keeps local wallet transaction records in sync with the Stellar Horizon network using incremental (cursor-based) pagination.

## Architecture

```
TransactionSyncScheduler (setInterval, default 15 min)
  └── TransactionSyncService.syncWalletTransactions(publicKey)
        ├── Reads wallet.last_cursor  → passes to Horizon as cursor param
        ├── Fetches only NEW transactions (asc order from cursor)
        ├── Creates local Transaction records for unseen txs
        └── Updates wallet.last_cursor + wallet.last_synced_at
```

## New Files

| File | Purpose |
|------|---------|
| `src/services/TransactionSyncScheduler.js` | Background scheduler service |
| `tests/add-stellar-transaction-history-synchronization.test.js` | Feature test suite |
| `docs/features/ADD_STELLAR_TRANSACTION_HISTORY_SYNCHRONIZATION.md` | This document |

## Modified Files

| File | Change |
|------|--------|
| `src/routes/models/wallet.js` | Added `last_synced_at` and `last_cursor` fields |
| `src/services/TransactionSyncService.js` | Incremental sync using `last_cursor`; updates both fields on success |
| `src/config/serviceContainer.js` | Registers `TransactionSyncScheduler` singleton |
| `src/routes/app.js` | Starts/stops scheduler; adds `POST /admin/sync`; adds `transactionSync` to `/health` |

## Schema Changes

Two new fields are added to the `Wallet` model (JSON file store):

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `last_synced_at` | ISO 8601 string \| null | `null` | Timestamp of the last successful sync attempt |
| `last_cursor` | string \| null | `null` | Horizon paging token of the last synced transaction |

## API

### `POST /admin/sync`

Triggers an immediate full sync for all registered wallets. Requires admin role.

**Request:** No body required.

**Response `200 OK`:**
```json
{
  "success": true,
  "message": "Transaction sync complete",
  "data": {
    "wallets": 5,
    "synced": 12,
    "errors": 0,
    "completedAt": "2026-03-27T22:50:18.409Z"
  }
}
```

**Response `403 Forbidden`:** Non-admin API key.

### `GET /health` — `transactionSync` field

The health endpoint now includes a `transactionSync` object:

```json
{
  "status": "healthy",
  "transactionSync": {
    "lastSyncAt": "2026-03-27T22:50:18.409Z",
    "lastSyncResult": {
      "wallets": 5,
      "synced": 12,
      "errors": 0,
      "completedAt": "2026-03-27T22:50:18.409Z"
    }
  }
}
```

`lastSyncAt` and `lastSyncResult` are `null` until the first sync completes.

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `TX_SYNC_INTERVAL_MS` | `900000` (15 min) | How often the scheduler runs a full sync pass |

## JSDoc Reference

### `TransactionSyncScheduler`

```js
/**
 * @class TransactionSyncScheduler
 * @param {Object} stellarService - StellarService or MockStellarService instance
 * @param {Object} [options]
 * @param {number} [options.intervalMs] - Override sync interval in milliseconds
 */

/**
 * Start the scheduler. Runs an immediate sync, then repeats on every intervalMs.
 * @method start
 * @returns {void}
 */

/**
 * Stop the scheduler and clear the interval.
 * @method stop
 * @returns {void}
 */

/**
 * Trigger an immediate sync for all wallets. Safe to call from admin endpoints.
 * @method syncAllWallets
 * @returns {Promise<{wallets: number, synced: number, errors: number, completedAt: string}>}
 */

/**
 * Return the status of the last global sync for health reporting.
 * @method getSyncStatus
 * @returns {{lastSyncAt: string|null, lastSyncResult: Object|null}}
 */
```

### `TransactionSyncService.syncWalletTransactions` (updated)

```js
/**
 * Sync wallet transactions from Stellar network to local database.
 * Fetches only transactions AFTER the wallet's last_cursor (incremental sync).
 * On success, updates wallet's last_cursor and last_synced_at.
 *
 * @param {string} publicKey - Stellar public key to sync
 * @param {number} [maxTransactions=500] - Upper bound on transactions fetched per call
 * @returns {Promise<{synced: number, transactions: Array}>}
 */
```

## Partial Failure Handling

If one wallet fails to sync (e.g. Horizon timeout, account not found), the scheduler:

1. Logs the error with `walletId`, `address`, and `error.message`
2. Increments the `errors` counter in the result
3. **Continues** to the next wallet — the entire pass is never aborted

This ensures a single bad wallet cannot block synchronization for all others.

## Testing

```bash
# Run the feature tests
npm test tests/add-stellar-transaction-history-synchronization.test.js

# Run with coverage
npm run test:coverage -- --testPathPattern=add-stellar-transaction-history-synchronization
```

All tests use `MockStellarService` — no live Stellar network calls are made.
