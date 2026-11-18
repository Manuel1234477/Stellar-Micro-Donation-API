# Webhook Delivery Retry Queue — Exponential Backoff and Dead-Letter Storage

This document describes the webhook delivery retry mechanism that ensures reliable delivery of webhook notifications with automatic retry scheduling, exponential backoff, and dead-letter storage for permanently failed deliveries.

## Overview

The webhook delivery system provides:

- **Persistent Retry Queue**: Failed deliveries are stored in the database and retried automatically
- **Exponential Backoff**: Retry delays increase exponentially to avoid overwhelming failed endpoints
- **Dead-Letter Storage**: Deliveries that exceed maximum retry attempts are moved to dead-letter storage
- **Auto-Disable**: Webhook endpoints that fail 10 consecutive times are automatically disabled
- **Manual Replay**: Failed deliveries can be manually replayed via admin API
- **Delivery History**: Complete audit trail of all delivery attempts

## Architecture

### Database Tables

#### `webhook_retries`
Stores pending webhook deliveries awaiting retry.

```sql
CREATE TABLE webhook_retries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  webhook_id INTEGER NOT NULL,
  event TEXT NOT NULL,
  payload TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  next_retry_at DATETIME NOT NULL,
  last_error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

#### `webhook_dead_letters`
Stores permanently failed deliveries (moved after exceeding max attempts).

```sql
CREATE TABLE webhook_dead_letters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  webhook_id INTEGER NOT NULL,
  event TEXT NOT NULL,
  payload TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  last_error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

#### `webhook_delivery_history`
Complete audit trail of all delivery attempts.

```sql
CREATE TABLE webhook_delivery_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  webhook_id INTEGER NOT NULL,
  event TEXT NOT NULL,
  payload TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,           -- 'success' or 'failed'
  status_code INTEGER,
  error_message TEXT,
  delivered_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

#### `webhooks`
Webhook endpoint definitions.

```sql
CREATE TABLE webhooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  events TEXT NOT NULL,
  secret TEXT,
  api_key_id INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  owner_email TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

### Retry Strategy

#### Retry Delays (Exponential Backoff)

Retries follow this schedule:

1. **1 minute** — immediate transient errors
2. **5 minutes** — short-term service issues
3. **30 minutes** — extended outages
4. **2 hours** — persistent failures
5. **24 hours** — extended degradation

Total max attempts: **5**

Configuration:
```javascript
const RETRY_DELAYS_MS = [
  60 * 1000,            // 1 minute
  5 * 60 * 1000,        // 5 minutes
  30 * 60 * 1000,       // 30 minutes
  2 * 60 * 60 * 1000,   // 2 hours
  24 * 60 * 60 * 1000   // 24 hours
];
const RETRY_MAX_ATTEMPTS = 5;
```

#### Auto-Disable Threshold

Webhook endpoints are automatically disabled after **10 consecutive failures**:

```javascript
const MAX_CONSECUTIVE_FAILURES = 10;
```

When disabled:
- No more deliveries are attempted
- The webhook's `is_active` flag is set to 0
- Operator must manually re-enable via admin API

### Webhook Retry Worker

A background worker processes the retry queue every 30 seconds (configurable):

**File**: `src/workers/webhookRetryWorker.js`

**Configuration**:
```env
WEBHOOK_RETRY_INTERVAL_MS=30000  # Default: 30 seconds
```

**Features**:
- Runs every 30 seconds (or custom interval)
- Uses leader election to ensure only one instance processes retries in a cluster
- Atomically dequeues pending retries by `next_retry_at`
- Records delivery outcomes in history table
- Moves exhausted retries to dead-letter storage
- Logs metrics: processed count, dead-letter count

**Lifecycle**:
- Started automatically during server boot (non-test only)
- Stopped gracefully during shutdown (waits for in-progress delivery)
- Uses timer registry for proper resource cleanup

## Admin API Endpoints

### List Webhooks with Metrics

**Endpoint**: `GET /admin/webhooks`

**Authentication**: Admin API key required

**Query Parameters**:
- `limit`: Max results (default: 50, max: 250)
- `offset`: Pagination offset (default: 0)

**Response**:
```json
{
  "success": true,
  "count": 2,
  "data": [
    {
      "id": 1,
      "url": "https://example.com/...",
      "events": ["donation.created", "donation.verified"],
      "status": "active",
      "lastDeliveryAt": "2026-08-26T12:34:56Z",
      "failureCount24h": 0,
      "successRate7d": 100.0
    }
  ]
}
```

### Get Delivery History for a Webhook

**Endpoint**: `GET /admin/webhooks/:id/deliveries`

**Authentication**: Admin API key required

**Query Parameters**:
- `limit`: Max results (default: 50)
- `offset`: Pagination offset (default: 0)

**Response**:
```json
{
  "success": true,
  "count": 5,
  "data": [
    {
      "deliveryId": 42,
      "event": "donation.created",
      "status": "success",
      "responseCode": 200,
      "attemptCount": 1,
      "deliveredAt": "2026-08-26T12:34:56Z",
      "errorMessage": null
    },
    {
      "deliveryId": 41,
      "event": "donation.created",
      "status": "failed",
      "responseCode": 503,
      "attemptCount": 1,
      "deliveredAt": "2026-08-26T12:00:00Z",
      "errorMessage": "Service Unavailable"
    }
  ]
}
```

### Manually Retry Last Failed Delivery

**Endpoint**: `POST /admin/webhooks/:id/retry`

**Authentication**: Admin API key required

**Response**:
```json
{
  "success": true,
  "data": {
    "retried": true,
    "deliveryId": 41
  }
}
```

**Behavior**:
- Finds the most recent failed delivery for the webhook
- Schedules it for immediate retry (next_retry_at = now)
- Returns 404 if no failed delivery found

### Disable/Enable a Webhook

**Endpoint**: `PATCH /admin/webhooks/:id`

**Authentication**: Admin API key required

**Request Body**:
```json
{
  "status": "active" | "disabled"
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "id": 1,
    "status": "disabled"
  }
}
```

**Behavior**:
- Setting `status: "disabled"` stops all delivery attempts
- Setting `status: "active"` re-enables delivery (resets `consecutive_failures` counter)

### List Dead-Letter Entries

**Endpoint**: `GET /admin/webhooks/dead-letter`

**Authentication**: Admin API key required

**Query Parameters**:
- `limit`: Max results (default: 50)
- `offset`: Pagination offset (default: 0)

**Response**:
```json
{
  "success": true,
  "count": 3,
  "data": [
    {
      "id": 15,
      "webhookId": 2,
      "event": "donation.created",
      "payload": "{\"id\":\"don-123\",\"amount\":10.5}",
      "attempts": 5,
      "lastError": "Connection refused",
      "createdAt": "2026-08-26T12:00:00Z"
    }
  ]
}
```

### Replay a Dead-Letter Entry

**Endpoint**: `POST /admin/webhooks/dead-letter/:id/replay`

**Authentication**: Admin API key required

**Response**:
```json
{
  "success": true,
  "data": {
    "replayed": true,
    "id": 15
  }
}
```

**Behavior**:
- Re-schedules the dead-letter entry as a fresh retry attempt
- Resets attempt counter to 0
- Deletes the dead-letter entry
- First retry scheduled for 1 minute in the future

## Failure Handling

### Transient Failures (Retryable)

Automatically retried with exponential backoff:
- Network timeouts
- 5xx server errors (500, 502, 503, 504, etc.)
- Connection refused
- DNS resolution failures
- Connection reset

### Permanent Failures (Not Retried)

Moved directly to dead-letter storage:
- Invalid webhook URL (404, SSL cert errors)
- 4xx client errors (400, 401, 403)
- Payload validation errors

## Monitoring and Alerting

### Metrics to Monitor

1. **Dead-letter queue size**
   ```sql
   SELECT COUNT(*) FROM webhook_dead_letters;
   ```

2. **Pending retries**
   ```sql
   SELECT COUNT(*) FROM webhook_retries WHERE next_retry_at <= NOW();
   ```

3. **Disabled webhooks**
   ```sql
   SELECT COUNT(*) FROM webhooks WHERE is_active = 0;
   ```

4. **Recent failure rate (24h)**
   ```sql
   SELECT 
     webhooks.id,
     webhooks.url,
     COUNT(CASE WHEN webhook_delivery_history.status = 'failed' THEN 1 END) as failures_24h,
     COUNT(*) as total_24h
   FROM webhooks
   LEFT JOIN webhook_delivery_history ON webhooks.id = webhook_delivery_history.webhook_id
   WHERE webhook_delivery_history.delivered_at > datetime('now', '-1 day')
   GROUP BY webhooks.id;
   ```

### Alerting Rules

- **Alert**: Dead-letter queue size > 100
- **Alert**: Disabled webhooks (is_active = 0) — manual intervention required
- **Alert**: Pending retries older than 24 hours — indicates queue backlog
- **Alert**: Webhook success rate < 50% (24h window) — possible endpoint issues

## Configuration

### Environment Variables

```env
# Retry worker interval (default: 30 seconds)
WEBHOOK_RETRY_INTERVAL_MS=30000

# Maximum retry attempts (default: 5)
# Hardcoded in WebhookService.js, modify if needed
# WEBHOOK_RETRY_MAX_ATTEMPTS=5

# Maximum consecutive failures before auto-disable (default: 10)
# Hardcoded in WebhookService.js, modify if needed
# WEBHOOK_MAX_CONSECUTIVE_FAILURES=10

# TLS certificate verification (only for development)
# WEBHOOK_ALLOW_TLS_SKIP_VERIFY=false
```

## Common Scenarios

### Scenario 1: Endpoint Temporarily Unavailable

1. First delivery attempt fails (503 Service Unavailable)
2. Retry scheduled for 1 minute later
3. Retries continue with exponential backoff
4. Successful delivery on 3rd attempt (after 5 minutes)
5. Delivery history shows: failed → failed → success

### Scenario 2: Endpoint Permanently Down

1. All 5 retry attempts fail (connection refused)
2. Entry moved to dead-letter storage
3. Webhook status remains active (manual disable not triggered)
4. Operator reviews dead-letter queue
5. Operator replays entry after fixing endpoint
6. Fresh retry sequence begins

### Scenario 3: Endpoint Consistently Failing

1. 10 consecutive delivery failures (various events)
2. Webhook automatically disabled (is_active = 0)
3. No more delivery attempts attempted
4. Pending retries remain in queue (but not processed)
5. Operator manually enables webhook via PATCH /admin/webhooks/:id
6. Delivery resumes on next worker cycle

## Troubleshooting

### High Dead-Letter Queue

**Causes**:
- Webhook endpoint is permanently down
- Webhook URL is invalid
- Authentication token expired (403 Forbidden)
- Persistent client errors (400 Bad Request)

**Solution**:
1. Check webhook endpoint status: `curl -I https://webhook.url`
2. Review dead-letter entries for error patterns
3. Fix the endpoint issue
4. Use admin API to replay dead-letter entries
5. Monitor retry progress via delivery history

### Webhook Disabled Unexpectedly

**Cause**: Reached 10 consecutive failures

**Solution**:
1. Review recent delivery history for root cause
2. Fix the webhook endpoint
3. Re-enable via `PATCH /admin/webhooks/:id` with `{"status": "active"}`
4. Monitor delivery history to confirm recovery

### Retries Not Processing

**Cause**: Webhook retry worker not running

**Check**:
1. Server logs for "Webhook retry worker started" message
2. Pending retries in database: `SELECT COUNT(*) FROM webhook_retries WHERE next_retry_at <= NOW();`
3. Worker is not running if count keeps growing

**Solution**:
1. Check server startup logs
2. Restart server with `npm start`
3. Verify environment variable: `WEBHOOK_RETRY_INTERVAL_MS`

## See Also

- [Webhook Verification](./WEBHOOK_VERIFICATION.md) — Validating webhook signatures
- [Admin API Documentation](./API_EXAMPLES.md#admin-endpoints) — Complete API reference
- [Observability Guide](./LOGGING.md) — Monitoring and debugging
