# Donation Subscription Tiers

## Overview

Subscription tiers let organizations offer structured recurring donation levels (e.g. Bronze $5/month, Silver $25/month, Gold $100/month). Each tier has a fixed amount, interval, and optional benefits description. When a donor subscribes to a tier, a `recurring_donation` schedule is automatically created and picked up by the existing `RecurringDonationScheduler`.

## Database Schema

### `subscription_tiers`

| Column      | Type     | Description                              |
|-------------|----------|------------------------------------------|
| `id`        | INTEGER  | Primary key                              |
| `name`      | TEXT     | Unique tier name (e.g. "Gold")           |
| `amount`    | REAL     | XLM amount per interval                  |
| `interval`  | TEXT     | `daily` \| `weekly` \| `monthly`         |
| `benefits`  | TEXT     | Free-form benefits description (optional)|
| `createdAt` | DATETIME | Creation timestamp                       |

### `donor_subscriptions`

| Column               | Type     | Description                                    |
|----------------------|----------|------------------------------------------------|
| `id`                 | INTEGER  | Primary key                                    |
| `donorId`            | INTEGER  | FK → `users.id`                                |
| `tierId`             | INTEGER  | FK → `subscription_tiers.id`                   |
| `recurringDonationId`| INTEGER  | FK → `recurring_donations.id`                  |
| `status`             | TEXT     | `active` \| `cancelled`                        |
| `createdAt`          | DATETIME | Subscription creation timestamp                |
| `cancelledAt`        | DATETIME | Cancellation timestamp (null if active)        |

## API

### `POST /tiers` — Create a tier

Requires `ADMIN_ALL` permission.

```json
{ "name": "Gold", "amount": 100, "interval": "monthly", "benefits": "Priority support" }
```

Response `201`:
```json
{ "success": true, "data": { "id": 3, "name": "Gold", "amount": 100, "interval": "monthly", "benefits": "Priority support", "createdAt": "..." } }
```

### `GET /tiers` — List all tiers

Requires `donations:read`. Returns tiers ordered by amount ascending.

### `POST /tiers/:id/subscribe` — Subscribe a donor

Requires `stream:create`. Creates a `recurring_donation` schedule using the tier's amount and interval.

```json
{ "donorPublicKey": "G...", "recipientPublicKey": "G...", "startDate": "2026-04-01" }
```

Response `201`:
```json
{
  "success": true,
  "data": {
    "id": 1,
    "tierId": 3,
    "tierName": "Gold",
    "tierAmount": 100,
    "tierInterval": "monthly",
    "recurringDonationId": 42,
    "status": "active",
    "createdAt": "..."
  }
}
```

### `DELETE /tiers/subscriptions/:subId` — Cancel a subscription

Requires `stream:delete`. Sets subscription status to `cancelled` and cancels the linked recurring donation schedule.

### `GET /tiers/analytics` — Tier analytics

Requires `stats:admin`. Returns subscriber counts and active revenue per tier.

```json
{
  "success": true,
  "data": [
    { "tierId": 1, "name": "Bronze", "amount": 5, "interval": "monthly", "activeSubscribers": 42, "cancelledSubscribers": 3, "totalSubscribers": 45, "activeRevenue": 210 },
    { "tierId": 2, "name": "Gold",   "amount": 100, "interval": "monthly", "activeSubscribers": 8, "cancelledSubscribers": 1, "totalSubscribers": 9, "activeRevenue": 800 }
  ]
}
```

## Scheduler Integration

Subscribing a donor calls `RecurringDonationScheduler.calculateNextExecutionDate()` to determine the first execution date, then inserts a row into `recurring_donations` with the tier's `amount` and `interval`. The scheduler picks it up on its next poll cycle (every 60 seconds) and executes it like any other recurring donation.

## Security Assumptions

- **Tier amount immutability**: Once a subscription is created, the recurring donation schedule stores the amount at subscription time. Changing a tier's amount does not retroactively affect existing subscriptions.
- **Subscription cancellation**: Cancelling a subscription also cancels the linked `recurring_donation` schedule, preventing future executions.
- **Duplicate prevention**: A donor cannot have two active subscriptions to the same tier simultaneously.
- **Admin-only tier creation**: Only admin API keys can define tiers. Subscription enrollment uses the standard `stream:create` permission.

## Running the Migration

```bash
node src/scripts/migrations/addSubscriptionTiers.js
```
