# API Key Expiration Notifications

## Overview

API keys with expiration dates now send proactive notifications before they expire, preventing silent authentication failures. Clients also receive an `X-API-Key-Expires-In` response header so they can react programmatically.

## Features

- Webhook notification 7 days before expiry
- Webhook notification 1 day before expiry
- Webhook notification when a key has just expired
- Email notification at each threshold (if `notification_email` is configured)
- `X-API-Key-Expires-In` response header on every authenticated request when the key expires within 30 days
- Deduplication: each threshold level is sent at most once per key

## New Database Columns

Two columns are added to `api_keys` via `initializeApiKeysTable()` (idempotent ALTER TABLE):

| Column | Type | Purpose |
|---|---|---|
| `notification_email` | TEXT | Optional email address for expiry notifications |
| `last_expiry_notification_sent_at` | INTEGER | Stores the last threshold (days) that was notified, preventing duplicate sends |

## Response Header

When an authenticated request is made with a key that expires within 30 days, the response includes:

```
X-API-Key-Expires-In: <days>
```

`<days>` is the ceiling of the remaining time in days (minimum 1).

## Notification Channels

### Webhook

Configure a webhook URL in the key's `metadata.webhookUrl` field. The service POSTs a JSON payload:

```json
{
  "event": "api_key.expiring_in_7_days",
  "keyId": 42,
  "keyPrefix": "abc12345",
  "keyName": "My Integration Key",
  "expiresAt": "2026-04-02T00:00:00.000Z",
  "daysUntilExpiry": 7,
  "timestamp": "2026-03-26T10:00:00.000Z"
}
```

Event names:
- `api_key.expiring_in_7_days`
- `api_key.expiring_in_1_days`
- `api_key.expired`

### Email

Set `notification_email` on the key (via `createApiKey` or `updateApiKey`). Requires SMTP environment variables:

| Variable | Default | Description |
|---|---|---|
| `SMTP_HOST` | `localhost` | SMTP server hostname |
| `SMTP_PORT` | `587` | SMTP server port |
| `SMTP_SECURE` | `false` | Use TLS (`true`/`false`) |
| `SMTP_USER` | — | SMTP username |
| `SMTP_PASS` | — | SMTP password |
| `SMTP_FROM` | `noreply@stellar-donations.local` | Sender address |

## Architecture

### New Files

- `src/services/ApiKeyExpirationNotifier.js` — Core notification service
- `src/scripts/migrations/addApiKeyNotificationColumns.js` — Standalone migration script
- `tests/implement-api-key-expiration-notifications.test.js` — Test suite

### Modified Files

- `src/models/apiKeys.js`
  - `initializeApiKeysTable()` — adds new columns automatically
  - `createApiKey()` — accepts `notificationEmail` parameter
  - `validateApiKey()` — returns `expiresAt` and `notificationEmail`
  - `updateApiKey()` — allows updating `notification_email`
  - `rotateApiKey()` — propagates `notification_email` to the new key
  - `getKeysExpiringWithin(withinDays)` — new: queries keys needing notification
  - `markExpiryNotificationSent(id, thresholdDays)` — new: records sent threshold

- `src/middleware/apiKey.js`
  - Adds `X-API-Key-Expires-In` header when key expires within 30 days

- `src/services/RecurringDonationScheduler.js`
  - Calls `ApiKeyExpirationNotifier.run()` on every scheduler tick

## Scheduler Integration

The `RecurringDonationScheduler` runs every 60 seconds. On each tick it now calls `ApiKeyExpirationNotifier.run()` after the existing key revocation job. Errors are caught and logged without affecting the donation processing loop.

## Security Considerations

- Webhook payloads contain only non-sensitive metadata (key ID, prefix, name, expiry date). The raw key is never included.
- Email addresses are validated with a basic regex before sending.
- Notification deduplication prevents notification storms if the scheduler restarts.
- The `last_expiry_notification_sent_at` column stores the threshold integer (7 or 1), not a timestamp, so the logic is timezone-independent.

## Running the Migration Manually

```bash
node src/scripts/migrations/addApiKeyNotificationColumns.js
```

The migration is also applied automatically on server startup via `initializeApiKeysTable()`.

## Running Tests

```bash
npm test tests/implement-api-key-expiration-notifications.test.js
```
