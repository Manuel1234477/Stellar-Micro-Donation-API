# Transaction Reconciliation

Background service that compares database transaction states against the Stellar network (Horizon) and flags discrepancies for operational review.

## How It Works

1. Every 10 minutes the scheduler calls `reconcile()`.
2. All `pending` and `submitted` transactions with a `stellarTxId` are verified against Horizon.
3. If Horizon confirms a transaction that is still pending in the database:
   - The service attempts an automatic status update to `confirmed`.
   - If the state machine rejects the transition (e.g. invalid status), the transaction is flagged as `reconciliation_needed=true` for manual review.
4. Flagged transactions are visible via `GET /admin/reconciliation/report`.
5. An operator resolves them via `POST /admin/reconciliation/resolve/:txId`.

## Schedule

| Setting | Value |
|---|---|
| Interval | 10 minutes |
| Configured in | `TransactionReconciliationService.checkInterval` |

## Discrepancy Fields

When a transaction is flagged, three fields are added to its record:

| Field | Description |
|---|---|
| `reconciliation_needed` | `true` while the discrepancy is unresolved |
| `reconciliation_reason` | Human-readable explanation |
| `reconciliation_flagged_at` | ISO timestamp when flagged |
| `reconciliation_resolved_at` | ISO timestamp when resolved (set on resolution) |

## API Endpoints

### GET /admin/reconciliation/report

Returns all transactions currently flagged as `reconciliation_needed`.

**Auth**: admin API key required

**Response**:
```json
{
  "success": true,
  "data": {
    "discrepancyCount": 2,
    "transactions": [
      {
        "id": "abc-123",
        "stellarTxId": "hash...",
        "status": "pending",
        "reconciliation_needed": true,
        "reconciliation_reason": "Confirmed on-chain (hash...) but DB status is 'pending'",
        "reconciliation_flagged_at": "2026-03-29T10:00:00.000Z"
      }
    ],
    "serviceStatus": {
      "isRunning": true,
      "checkIntervalMinutes": 10,
      "reconciliationInProgress": false,
      "orphanedTransactionCount": 0
    },
    "generatedAt": "2026-03-29T10:05:00.000Z"
  }
}
```

### POST /admin/reconciliation/resolve/:txId

Manually resolve a flagged transaction.

**Auth**: admin API key required

**Body**:
```json
{ "status": "confirmed" }
```

Accepted values for `status`: any valid transaction state (`confirmed`, `failed`, `cancelled`, etc.)

**Response**: `200` with the updated transaction record, or `404` if not found, `400` if `status` is missing.

## Error Handling

- Horizon `404` responses are treated as "not yet on-chain" — no flag, no crash.
- Other Horizon errors are logged and counted in the cycle result's `errors` field.
- The reconciliation loop never crashes the process; all errors are caught and logged.

## Service Methods

| Method | Description |
|---|---|
| `flagDiscrepancy(txId, reason)` | Mark a transaction as needing review |
| `resolveDiscrepancy(txId, newStatus)` | Clear the flag and set a new status |
| `getDiscrepancies()` | Return `{ count, transactions }` of all flagged records |
| `getStatus()` | Return service health info |
