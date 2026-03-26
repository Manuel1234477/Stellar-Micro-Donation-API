# GraphQL API Layer

A GraphQL endpoint is available alongside the existing REST API at `POST /graphql`.
It exposes the same data and operations as REST, backed by the same service layer.

## Endpoint

| Protocol | Path | Purpose |
|----------|------|---------|
| HTTP POST | `/graphql` | Queries and mutations |
| WebSocket | `/graphql` | Subscriptions (real-time events) |

## Authentication

Every request requires the same API key used by the REST API.

**HTTP requests** — include the key in the `x-api-key` header:

```http
POST /graphql
x-api-key: your-api-key
Content-Type: application/json

{"query": "{ donations { id amount } }"}
```

**WebSocket connections** — pass the key in `connectionParams`:

```js
import { createClient } from 'graphql-ws';

const client = createClient({
  url: 'ws://localhost:3000/graphql',
  connectionParams: { apiKey: 'your-api-key' },
});
```

## Security

- **Introspection** is disabled in production (`NODE_ENV=production`).
- **Query depth** is limited to 5 levels to prevent abuse.
- **Authentication** is enforced on every HTTP request and WebSocket connection.

## Queries

### `donations`
Returns all donation records.

```graphql
{
  donations {
    id
    senderId
    receiverId
    amount
    memo
    status
    stellar_tx_id
    timestamp
  }
}
```

### `donation(id: Int!)`
Returns a single donation by ID.

```graphql
query GetDonation($id: Int!) {
  donation(id: $id) {
    id
    amount
    status
  }
}
```

### `recentDonations(limit: Int)`
Returns the most recent donations. Defaults to 10.

```graphql
{
  recentDonations(limit: 5) {
    id
    amount
    timestamp
  }
}
```

### `wallets`
Returns all wallet records.

```graphql
{
  wallets {
    id
    address
    label
    ownerName
  }
}
```

### `wallet(id: Int!)`
Returns a single wallet by ID.

```graphql
query GetWallet($id: Int!) {
  wallet(id: $id) {
    id
    address
    label
  }
}
```

### `dailyStats(startDate: String!, endDate: String!)`
Returns daily aggregated donation statistics.

```graphql
query DailyStats($start: String!, $end: String!) {
  dailyStats(startDate: $start, endDate: $end) {
    date
    totalVolume
    transactionCount
  }
}
```

### `summaryStats(startDate: String, endDate: String)`
Returns summary analytics. Date range is optional.

```graphql
{
  summaryStats {
    totalDonations
    totalVolume
    uniqueDonors
    uniqueRecipients
    averageDonation
  }
}
```

## Mutations

### `createDonation(input: CreateDonationInput!)`

```graphql
mutation CreateDonation($input: CreateDonationInput!) {
  createDonation(input: $input) {
    success
    donation {
      id
      amount
      status
    }
  }
}
```

**Input fields:**

| Field | Type | Required |
|-------|------|----------|
| `senderId` | `Int` | ✅ |
| `receiverId` | `Int` | ✅ |
| `amount` | `Float` | ✅ |
| `memo` | `String` | — |
| `currency` | `String` | — |

### `updateDonationStatus(id: Int!, status: String!)`

```graphql
mutation UpdateStatus($id: Int!, $status: String!) {
  updateDonationStatus(id: $id, status: $status) {
    success
    donation {
      id
      status
    }
  }
}
```

### `createWallet(address: String!, label: String, ownerName: String)`

```graphql
mutation CreateWallet($address: String!) {
  createWallet(address: $address, label: "My Wallet") {
    success
    wallet {
      id
      address
      funded
    }
  }
}
```

## Subscriptions

Subscribe to real-time transaction events over WebSocket.

```graphql
subscription {
  transactionCreated {
    id
    senderId
    receiverId
    amount
    status
    timestamp
  }
}
```

Events are published whenever a donation transaction is created. The in-process
PubSub (`src/graphql/pubsub.js`) can be replaced with a Redis-backed implementation
for multi-instance deployments without changing the resolver interface.

## Architecture

```
src/graphql/
├── schema.js   — Type definitions, queries, mutations, subscriptions
├── pubsub.js   — In-process event bus for subscriptions
└── index.js    — Express router + WebSocket server wiring
```

The GraphQL layer delegates all business logic to the existing service layer:
- `DonationService` — donation queries and mutations
- `WalletService` — wallet queries and mutations
- `StatsService` — analytics queries

## Running Tests

```bash
npm test tests/graphql.test.js
```
