# Recurring Donation Scheduling – Flexible Intervals

## Overview

Users can schedule automated donations at **daily**, **weekly**, **monthly**, or **custom** (N-day) intervals. The scheduler executes donations in the background, retries failures with exponential backoff, and sends a webhook notification when all retries are exhausted.

---

## API Endpoints

### Create a recurring donation schedule

```
POST /donations/recurring
```

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `donorPublicKey` | string | ✅ | Stellar public key of the donor |
| `recipientPublicKey` | string | ✅ | Stellar public key of the recipient |
| `amount` | number | ✅ | XLM amount per execution |
| `frequency` | string | ✅ | `daily` \| `weekly` \| `monthly` \| `custom` |
| `customIntervalDays` | integer | ✅ if `custom` | Interval in days (≥ 1) |
| `maxExecutions` | integer | ❌ | Stop after N executions (omit = unlimited) |
| `webhookUrl` | string | ❌ | URL to POST on persistent failure |
| `startDate` | ISO string | ❌ | First execution date (default: now + 1 interval) |

**Response 201**

```json
{
  "success": true,
  "message": "Recurring donation schedule created successfully",
  "data": {
    "id": 42,
    "donorPublicKey": "GDONOR...",
    "recipientPublicKey": "GRECIP...",
    "amount": 5,
    "frequency": "custom",
    "customIntervalDays": 14,
    "maxExecutions": 10,
    "webhookUrl": "https://example.com/hook",
    "nextExecutionDate": "2026-03-11T10:00:00.000Z",
    "status": "active",
    "executionCount": 0,
    "failureCount": 0
  }
}
```

---

### List all schedules

```
GET /donations/recurring?status=active
```

Optional query param: `status` (`active` | `paused` | `cancelled` | `completed`)

---

### Get a specific schedule

```
GET /donations/recurring/:id
```

---

### Cancel a schedule

```
DELETE /donations/recurring/:id
```

Returns `409` if already cancelled.

---

### Get execution history

```
GET /donations/recurring/:id/history?limit=20&offset=0
```

Returns paginated execution log entries with status (`SUCCESS` | `FAILED`), transaction hash, error message, and timestamp.

---

## Scheduler Behaviour

### Execution cycle

The `RecurringDonationScheduler` polls the database every **60 seconds** for active schedules whose `nextExecutionDate ≤ now`. Due schedules are executed concurrently with duplicate-execution prevention.

### Retry logic

| Parameter | Value |
|---|---|
| Max attempts | 3 |
| Initial backoff | 1 second |
| Max backoff | 30 seconds |
| Multiplier | 2× |
| Jitter | ±30 % |

### Persistent failure webhook

When all 3 attempts fail, the scheduler:
1. Increments `failureCount` in the database
2. Persists `lastFailureReason`
3. POSTs to `webhookUrl` (if configured) with:

```json
{
  "event": "recurring_donation.persistent_failure",
  "scheduleId": 42,
  "donorPublicKey": "GDONOR...",
  "recipientPublicKey": "GRECIP...",
  "amount": "5.00",
  "frequency": "custom",
  "errorMessage": "Insufficient balance",
  "failureCount": 3,
  "timestamp": "2026-03-11T10:00:00.000Z"
}
```

Webhook delivery failures are logged but do not affect the schedule state.

---

## Database Schema

### `recurring_donations` (enhanced)

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `donorId` | INTEGER FK | References `users.id` |
| `recipientId` | INTEGER FK | References `users.id` |
| `amount` | REAL | XLM per execution |
| `frequency` | TEXT | `daily` / `weekly` / `monthly` / `custom` |
| `customIntervalDays` | INTEGER | Days between executions (custom only) |
| `maxExecutions` | INTEGER | Max executions (NULL = unlimited) |
| `webhookUrl` | TEXT | Failure notification URL |
| `failureCount` | INTEGER | Consecutive persistent failures |
| `lastFailureReason` | TEXT | Last error message |
| `nextExecutionDate` | DATETIME | Next scheduled execution |
| `lastExecutionDate` | DATETIME | Last successful execution |
| `executionCount` | INTEGER | Total successful executions |
| `status` | TEXT | `active` / `paused` / `cancelled` / `completed` |

### `recurring_donation_logs`

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `scheduleId` | INTEGER FK | References `recurring_donations.id` |
| `status` | TEXT | `SUCCESS` or `FAILED` |
| `transactionHash` | TEXT | Stellar tx hash (success only) |
| `errorMessage` | TEXT | Error detail (failure only) |
| `attemptNumber` | INTEGER | Which retry attempt (1–3) |
| `timestamp` | DATETIME | Execution time |
| `correlationId` | TEXT | Distributed trace ID |

---

## Security

- All endpoints require a valid API key (`x-api-key` header)
- `stream:create` permission required to create schedules
- `stream:read` permission required to list/view schedules and history
- `stream:delete` permission required to cancel schedules
- Webhook URL is validated as a proper URL before storage
- No private keys are stored or transmitted

---

## Running Tests

```bash
npm test tests/implement-recurring-donation-scheduling-with-flexi.test.js
```

No live Stellar network required — all tests use `MockStellarService`.
