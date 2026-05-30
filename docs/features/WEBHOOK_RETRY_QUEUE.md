# Webhook Retry Queue

Failed webhook deliveries are automatically retried with exponential backoff. Permanently failed deliveries are moved to a dead-letter store for manual inspection and replay.

## How It Works

1. A webhook delivery fails (network error, non-2xx response, timeout).
2. `scheduleRetry` inserts a row into `webhook_retries` with a `next_retry_at` timestamp calculated using exponential backoff.
3. The scheduler calls `processRetryQueue()` every 60 s, picking up all due entries.
4. On success the entry is removed. On failure it is re-inserted with `attempt + 1`.
5. When `attempt >= 6` (configurable via `RETRY_MAX_ATTEMPTS`), the entry is promoted to `webhook_dead_letters` instead of being re-queued.

## Backoff Formula

```
delay = 30s * 2^attempt
```

| Attempt | Delay  |
|---------|--------|
| 0       | 30 s   |
| 1       | 60 s   |
| 2       | 120 s  |
| 3       | 240 s  |
| 4       | 480 s  |
| 5       | 960 s  |
| 6       | → dead-letter |

## Database Tables

### `webhook_retries`
Pending retry entries. Rows are deleted on each attempt (success or failure) and re-inserted on failure.

| Column         | Type     | Description                        |
|----------------|----------|------------------------------------|
| `id`           | INTEGER  | Primary key                        |
| `webhook_id`   | INTEGER  | References `webhooks.id`           |
| `event`        | TEXT     | Event type                         |
| `payload`      | TEXT     | JSON-encoded event payload         |
| `attempt`      | INTEGER  | Current attempt number (0-based)   |
| `next_retry_at`| DATETIME | When to next attempt delivery      |
| `last_error`   | TEXT     | Error message from last attempt    |
| `created_at`   | DATETIME | Row creation time                  |

### `webhook_dead_letters`
Permanently failed deliveries. Insert-only; removed only on replay.

| Column       | Type     | Description                        |
|--------------|----------|------------------------------------|
| `id`         | INTEGER  | Primary key                        |
| `webhook_id` | INTEGER  | References `webhooks.id`           |
| `event`      | TEXT     | Event type                         |
| `payload`    | TEXT     | JSON-encoded event payload         |
| `attempts`   | INTEGER  | Total attempts made                |
| `last_error` | TEXT     | Final error message                |
| `created_at` | DATETIME | When promoted to dead-letter       |

## Admin API Endpoints

Both endpoints require the **admin** role.

### List dead-letter entries

```
GET /admin/webhooks/dead-letter?limit=50&offset=0
```

**Response:**
```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "id": 1,
      "webhookId": 3,
      "event": "transaction.confirmed",
      "payload": { "donationId": "don-123" },
      "attempts": 6,
      "lastError": "connection refused",
      "createdAt": "2026-03-30T10:00:00.000Z"
    }
  ]
}
```

### Replay a dead-letter entry

```
POST /admin/webhooks/dead-letter/:id/replay
```

Re-schedules the entry as a fresh retry (attempt 0) and removes it from the dead-letter store.

**Response:**
```json
{
  "success": true,
  "data": { "replayed": true, "id": 1 }
}
```

Returns `404` if the entry does not exist.

## Service Methods

### `WebhookService.scheduleRetry({ webhookId, event, payload, attempt, lastError })`

Inserts a retry row or promotes to dead-letter when `attempt >= RETRY_MAX_ATTEMPTS`.

### `WebhookService.processRetryQueue()`

Processes all due retry entries. Returns `{ processed, succeeded, failed }`. Called by the scheduler every 60 s.

### `WebhookService.listDeadLetters({ limit, offset })`

Returns paginated dead-letter entries with parsed payloads.

### `WebhookService.replayDeadLetter(id)`

Re-schedules a dead-letter entry as attempt 0 and deletes it from the dead-letter store. Throws `404` if not found.

## Retry State Persistence

All retry state is stored in SQLite (`webhook_retries`, `webhook_dead_letters`). State survives server restarts — the scheduler picks up due entries on the next tick after startup.
