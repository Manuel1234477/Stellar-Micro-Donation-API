# Transaction Rollback on Partial Failure

## Problem

When a Stellar transaction succeeds but the subsequent database write fails, the system is left in an inconsistent state: the blockchain has the transaction but the local database does not. These are called **orphaned transactions**.

## Solution

A compensation mechanism detects orphaned Stellar transactions during each reconciliation cycle and creates a local DB record for each one, restoring consistency without touching the blockchain.

## Changes

### Database

`stellar_tx_id TEXT UNIQUE` and `is_orphan INTEGER NOT NULL DEFAULT 0` columns added to the `transactions` table.

- `stellar_tx_id` — cross-references the local record with the on-chain transaction.
- `is_orphan` — flags records created by the compensation mechanism (`1`) vs. normal flow (`0`).

### TransactionReconciliationService

Enhanced with three new capabilities:

| Method | Description |
|---|---|
| `detectAndCompensateOrphans()` | Compares Stellar tx store against DB; compensates each orphan |
| `compensateOrphan(orphan)` | Inserts a local DB record for a single orphaned Stellar tx |
| `_emitOrphanAlert(orphans)` | Logs an ERROR-level alert when orphan count ≥ threshold |
| `getOrphanedTransactionCount()` | Returns lifetime orphan count since service start |
| `_getAllStellarTransactions()` | Collects deduplicated tx list from the Stellar service |

`getStatus()` now includes `orphanedTransactionCount`.

### DonationService

`sendCustodialDonation` now stores `stellar_tx_id` in the DB insert immediately after the Stellar transaction succeeds.

### New Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/admin/reconcile` | Admin | Trigger a reconciliation cycle synchronously |
| `GET` | `/admin/orphaned-transactions` | Admin | List all orphaned transaction records |
| `GET` | `/stats/orphaned-transactions` | Any API key | Orphan count and total amount |

## API Reference

### POST /admin/reconcile

```
POST /admin/reconcile
x-api-key: <admin-key>
```

Response `200`:
```json
{
  "success": true,
  "message": "Reconciliation complete",
  "data": {
    "corrected": 0,
    "errors": 0,
    "orphansDetected": 2,
    "orphansCompensated": 2
  }
}
```

Errors: `401` (no key), `403` (non-admin), `409` (already in progress).

### GET /stats/orphaned-transactions

```
GET /stats/orphaned-transactions
x-api-key: <any-key>
```

Response `200`:
```json
{
  "success": true,
  "data": {
    "orphaned_transactions": 2,
    "totalOrphanedAmount": 55.5
  }
}
```

### GET /admin/orphaned-transactions

```
GET /admin/orphaned-transactions
x-api-key: <admin-key>
```

Response `200`:
```json
{
  "success": true,
  "data": {
    "count": 1,
    "transactions": [{ "id": 5, "stellar_tx_id": "mock_abc...", "amount": 30, ... }],
    "lifetimeDetected": 1
  }
}
```

## Alerting

When `orphansDetected >= ORPHAN_ALERT_THRESHOLD` (default `1`, configurable via env var `ORPHAN_ALERT_THRESHOLD`), the service logs an `ERROR`-level alert:

```
[RECONCILIATION] ALERT: Orphaned transactions exceed threshold
  threshold: 1, count: 2, stellarTxIds: [...]
```

## Security

- All admin endpoints require an API key with the `admin` role.
- Compensation uses `INSERT OR IGNORE` to prevent duplicate records.
- `stellar_tx_id` has a `UNIQUE` constraint at the DB level.
- No private keys or secrets are exposed in orphan records.

## Files Changed

- `src/services/TransactionReconciliationService.js`
- `src/services/DonationService.js`
- `src/services/StatsService.js`
- `src/routes/app.js`
- `src/routes/stats.js`
- `src/scripts/initDB.js`
- `tests/globalSetup.js`
- `tests/implement-transaction-rollback-on-partial-failure.test.js`
