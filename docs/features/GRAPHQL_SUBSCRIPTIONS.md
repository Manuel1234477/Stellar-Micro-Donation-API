# GraphQL Subscriptions

Real-time donation lifecycle events delivered over WebSocket using the [graphql-ws](https://github.com/enisdenjo/graphql-ws) protocol.

## Connection

Connect to the WebSocket endpoint at `/graphql` using the `graphql-transport-ws` sub-protocol. Pass your API key in `connectionParams`:

```js
import { createClient } from 'graphql-ws';

const client = createClient({
  url: 'ws://localhost:3000/graphql',
  connectionParams: { apiKey: 'your-api-key' },
});
```

Unauthenticated connections are rejected immediately with a non-normal close code.

---

## Subscriptions

### `donationCreated`

Fires when any new donation record is created.

```graphql
subscription {
  donationCreated(walletAddress: "GXYZ...", minAmount: 5.0) {
    id
    donor
    recipient
    amount
    status
    stellarTxId
    campaign_id
    timestamp
  }
}
```

### `donationCompleted`

Fires when a donation reaches `confirmed` status (on-chain settlement).

```graphql
subscription {
  donationCompleted(campaignId: 42) {
    id
    donor
    recipient
    amount
    stellarTxId
    timestamp
  }
}
```

### `recurringDonationExecuted`

Fires each time the scheduler successfully executes a recurring donation.

```graphql
subscription {
  recurringDonationExecuted(walletAddress: "GDONOR...") {
    scheduleId
    donor
    recipient
    amount
    txHash
    executionCount
    timestamp
  }
}
```

---

## Subscription Filters

All donation subscriptions accept optional filter arguments:

| Argument | Type | Description |
|----------|------|-------------|
| `walletAddress` | `String` | Only events where donor **or** recipient matches |
| `campaignId` | `Int` | Only events for a specific campaign |
| `minAmount` | `Float` | Only events where `amount >= minAmount` |

`recurringDonationExecuted` supports `walletAddress` and `minAmount` (no `campaignId`).

Filters are applied server-side — non-matching events are never sent to the client.

---

## Event Sources

| Subscription | Published by |
|---|---|
| `donationCreated` | `DonationService.createDonationRecord()` |
| `donationCompleted` | `DonationService.createDonationRecord()` (when status is `confirmed`) |
| `recurringDonationExecuted` | `RecurringDonationScheduler.executeSchedule()` |

---

## Authentication

- HTTP GraphQL requests: `X-API-Key` header (handled by `requireApiKey` middleware)
- WebSocket connections: `connectionParams.apiKey` field in `connection_init` message

Both legacy environment-based keys (`API_KEYS`) and database-backed keys are supported.
