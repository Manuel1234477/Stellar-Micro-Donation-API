# Configurable Data Retention Policies

Automatically anonymizes or deletes personal data after configurable retention periods, supporting GDPR and other privacy regulations.

## Configuration

Set retention periods via environment variables (all default to safe values if unset):

| Variable | Default | Description |
|---|---|---|
| `RETENTION_TRANSACTIONS_DAYS` | `365` | Days before transaction memos are anonymized |
| `RETENTION_AUDIT_LOGS_DAYS` | `90` | Days before audit log entries are deleted |
| `RETENTION_USER_DATA_DAYS` | `730` | Days before user public keys are anonymized |

## Anonymization Strategy

PII is replaced with a SHA-256 hash prefixed with `anon:` rather than deleted outright. This preserves referential integrity and allows aggregate analytics while making the original value unrecoverable.

```
"GABC123..." → "anon:e3b0c44298fc1c149afb..."
```

Already-anonymized records are never processed twice.

## Service: `RetentionService`

Located at `src/services/RetentionService.js`.

### Methods

#### `runTransactionRetention(days?)`
Anonymizes the `memo` field of transactions older than the retention period.

#### `runAuditLogRetention(days?)`
Deletes audit log entries older than the retention period.

#### `runUserDataRetention(days?)`
Anonymizes the `publicKey` field of user records older than the retention period.

#### `runAll()`
Runs all three jobs concurrently. Returns `{ transactions, auditLogs, userData }` with counts of affected records.

#### `getStatus()`
Returns current configuration and record counts:
```json
{
  "config": {
    "transactionRetentionDays": 365,
    "auditLogRetentionDays": 90,
    "userDataRetentionDays": 730
  },
  "stats": {
    "transactions": { "total": 1200, "anonymized": 45 },
    "auditLogs": { "total": 8000 },
    "users": { "total": 300, "anonymized": 12 }
  }
}
```

## Scheduled Execution

The retention job runs automatically via `RecurringDonationScheduler` once per `cleanupInterval` (default: every hour). No additional configuration is required.

## Admin Endpoints

Both endpoints require admin role (`*` permission).

### `GET /admin/retention/status`

Returns current retention configuration and record counts.

```bash
curl -H "x-api-key: <admin-key>" http://localhost:3000/admin/retention/status
```

### `POST /admin/retention/run`

Manually triggers a full retention run immediately.

```bash
curl -X POST -H "x-api-key: <admin-key>" http://localhost:3000/admin/retention/run
```

Response:
```json
{ "success": true, "data": { "transactions": 3, "auditLogs": 120, "userData": 1 } }
```

## Testing

```bash
npm test tests/implement-configurable-data-retention-policies.test.js
```

No live Stellar network required.
