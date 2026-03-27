# Webhook Delivery Idempotency

## Overview

Webhook delivery idempotency ensures that clients can detect and handle duplicate webhook deliveries. Each webhook event has a unique `event_id` that remains consistent across retries.

## Features

- **Unique Event IDs**: Every webhook delivery has a UUID event_id
- **Retry Consistency**: event_id remains the same across retries
- **Delivery History**: Query past webhook events per webhook
- **Manual Redelivery**: Redeliver failed events on demand
- **Event ID Header**: X-Webhook-Event-ID header in all deliveries

## Implementation Status

This feature is in progress. The following components need to be implemented:

1. Add `event_id` (UUID) to all webhook payloads
2. Create `webhook_events` table for delivery history
3. Add `GET /webhooks/:id/events` endpoint
4. Add `POST /webhooks/events/:eventId/redeliver` endpoint
5. Include `X-Webhook-Event-ID` header in deliveries
6. Ensure event_id immutability across retries

## Database Schema

```sql
CREATE TABLE webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  webhook_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL, -- 'pending', 'delivered', 'failed'
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at INTEGER,
  delivered_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (webhook_id) REFERENCES webhooks(id)
);
```

## API Usage

```javascript
// Webhook payload includes event_id
{
  "event_id": "550e8400-e29b-41d4-a716-446655440000",
  "event": "transaction.confirmed",
  "data": { ... },
  "timestamp": "2024-01-15T14:30:00.000Z"
}

// Query delivery history
GET /webhooks/123/events

// Redeliver failed event
POST /webhooks/events/550e8400-e29b-41d4-a716-446655440000/redeliver
```

## Client Deduplication

Clients should track received event_ids to prevent duplicate processing:

```javascript
const processedEvents = new Set();

app.post('/webhook', (req, res) => {
  const { event_id } = req.body;
  
  if (processedEvents.has(event_id)) {
    return res.status(200).send('Already processed');
  }
  
  // Process event
  processedEvents.add(event_id);
  res.status(200).send('OK');
});
```

## Security Considerations

- event_id immutability enforcement
- Redelivery authorization checks
- Delivery history access control
