# API Key Expiration Notifications

API key owners receive warnings at configurable intervals before expiration, delivered via webhook and optionally via email. Notifications are idempotent — no duplicate alerts for the same key and lead-time window.

## Configuration

| Env Var | Default | Description |
|---|---|---|
| `API_KEY_EXPIRY_WARN_DAYS` | `30,7,1` | Comma-separated lead times in days |
| `API_KEY_EXPIRY_EMAIL` | — | Set to `true` to enable email delivery |
| `SMTP_HOST` | `localhost` | SMTP server host |
| `SMTP_PORT` | `587` | SMTP server port |
| `SMTP_SECURE` | `false` | Use TLS (`true`/`false`) |
| `SMTP_USER` | — | SMTP username |
| `SMTP_PASS` | — | SMTP password |
| `SMTP_FROM` | `noreply@stellar-donations.local` | Sender address |

Example — notify at 30, 7, and 1 day before expiry:
```
API_KEY_EXPIRY_WARN_DAYS=30,7,1
```

## Notification Channels

### Webhook

Set `webhookUrl` in the API key's `metadata` field at creation time:

```json
{
  "name": "My Key",
  "role": "user",
  "expiresInDays": 30,
  "metadata": { "webhookUrl": "https://example.com/hooks/api-key" }
}
```

Payload delivered via `POST` to the webhook URL:

```json
{
  "event": "api_key.expiring",
  "keyId": 42,
  "keyPrefix": "abc12345",
  "keyName": "My Key",
  "expiresAt": "2026-04-28T00:00:00.000Z",
  "daysUntilExpiry": 7,
  "timestamp": "2026-04-21T00:00:00.000Z"
}
```

For already-expired keys the event is `api_key.expired` and `daysUntilExpiry` is `0`.

### Email

Set `notificationEmail` when creating the key:

```json
{
  "name": "My Key",
  "notificationEmail": "owner@example.com"
}
```

## Deduplication

Each key tracks the most recent threshold at which a notification was sent (`last_expiry_notification_sent_at`). A notification is only sent once per threshold level per key. All sent notices are also persisted in the `api_key_expiration_notices` table.

## Endpoint

### GET /api-keys/:id/expiration-notices

List all expiration notifications sent for a given API key. Admin only.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "keyId": 42,
    "notices": [
      { "id": 2, "thresholdDays": 1, "sentAt": 1745280000000 },
      { "id": 1, "thresholdDays": 7, "sentAt": 1744675200000 }
    ]
  }
}
```

## Scheduler Integration

`ApiKeyExpirationNotifier.run()` is called on every tick of `RecurringDonationScheduler` (every 60 seconds). It processes each configured threshold from most urgent to least, then checks for recently expired keys.

## Service API

### `ApiKeyExpirationNotifier.run()`

Runs all expiry checks. Returns `{ notified: number, errors: number }`.

### `ApiKeyExpirationNotifier._sendWebhook(url, key, thresholdDays)`

POSTs the expiry event to the configured webhook URL.

### `ApiKeyExpirationNotifier._sendEmail(toEmail, key, thresholdDays)`

Sends an expiry warning email via SMTP (nodemailer).
