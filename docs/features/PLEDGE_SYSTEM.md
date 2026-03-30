# Donation Pledge System

Donors can commit funds (pledge) to a campaign. Pledges automatically convert to donations when the campaign goal is reached, or expire if the deadline passes.

## Pledge Lifecycle

```
         POST /campaigns/:id/pledges
                     │
                     ▼
              ┌─────────────┐
              │   pending   │
              └──────┬──────┘
          ┌──────────┴──────────┐
          ▼                     ▼
   goal reached           expires_at < now
          │                     │
          ▼                     ▼
    ┌──────────┐         ┌──────────────┐
    │fulfilled │         │   expired    │
    └──────────┘         └──────────────┘
```

## API

### Create a pledge

```
POST /campaigns/:id/pledges
Authorization: x-api-key: <key>

{
  "donor_wallet_id": "GA...",
  "amount": 10.5,
  "expires_at": "2026-12-31T23:59:59Z"
}
```

Returns `201` with the created pledge. Returns `400` if the campaign is not active, `404` if not found.

### List pledges for a campaign

```
GET /campaigns/:id/pledges
Authorization: x-api-key: <key>
```

## Fulfillment Logic

After every pledge is created, `PledgeFulfillmentService.checkAndFulfill(campaignId)` runs atomically:

```sql
UPDATE pledges SET status = 'fulfilled'
WHERE campaign_id = ? AND status = 'pending'
-- only executes when current_amount >= goal_amount
```

A `pledge.fulfilled` webhook event is fired for each fulfilled pledge.

## Auto-Expiry Worker

`src/workers/expiryWorker.js` runs every 60 seconds (configurable via `PLEDGE_EXPIRY_INTERVAL_MS`):

```sql
UPDATE pledges SET status = 'expired'
WHERE status = 'pending' AND expires_at < now()
```

A `pledge.expired` webhook event is fired for each expired pledge.

## Webhook Events

| Event | Trigger |
|---|---|
| `pledge.fulfilled` | Campaign goal reached |
| `pledge.expired` | `expires_at` passed without goal being met |

## Database Schema

```sql
CREATE TABLE pledges (
  id              TEXT PRIMARY KEY,       -- UUID
  campaign_id     INTEGER NOT NULL,
  donor_wallet_id TEXT NOT NULL,          -- Stellar public key
  amount          REAL NOT NULL,
  status          TEXT DEFAULT 'pending'  -- pending | fulfilled | expired
                    CHECK(status IN ('pending','fulfilled','expired')),
  expires_at      DATETIME NOT NULL,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
);
```
