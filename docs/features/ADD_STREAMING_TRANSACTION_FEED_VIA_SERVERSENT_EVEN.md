# Streaming Transaction Feed via Server-Sent Events

Real-time transaction feed using the SSE (Server-Sent Events) protocol. Clients subscribe to `GET /stream/feed` and receive push notifications for donation lifecycle events without polling.

## SSE Event Format

Every event follows the standard SSE wire format:

```
id: 42
event: transaction.created
data: {"donor":"GABC...","recipient":"GXYZ...","amount":10,"status":"pending"}

```

| Field   | Description |
|---------|-------------|
| `id`    | Monotonically increasing integer; use as `Last-Event-ID` on reconnect |
| `event` | One of `connected`, `transaction.created`, `transaction.confirmed`, `transaction.failed` |
| `data`  | JSON-encoded transaction object |

Heartbeat comments (`': ping'`) are sent every 30 seconds to keep the connection alive through proxies.

## Endpoints

### `GET /stream/feed`

Subscribe to the real-time transaction feed.

**Query parameters (all optional):**

| Parameter       | Type   | Description |
|-----------------|--------|-------------|
| `walletAddress` | string | Filter by donor or recipient address |
| `status`        | string | Filter by transaction status |
| `minAmount`     | number | Minimum amount (inclusive) |
| `maxAmount`     | number | Maximum amount (inclusive) |

**Reconnection:** Send the `Last-Event-ID` header with the last received event ID. The server replays all buffered events with a higher ID (up to the last 500 events).

**Connection limit:** Maximum 5 concurrent streams per API key. Exceeding this returns `429 TOO_MANY_CONNECTIONS`.

**Example:**
```
GET /stream/feed?walletAddress=GABC...&minAmount=5
x-api-key: <your-key>
Last-Event-ID: 17
```

### `GET /stream/stats`

Returns active connection counts.

```json
{
  "success": true,
  "data": {
    "totalConnections": 3,
    "connectionsByKey": { "42": 2, "7": 1 }
  }
}
```

## Error Responses

| Scenario | Status | Code |
|----------|--------|------|
| Connection limit exceeded | 429 | `TOO_MANY_CONNECTIONS` |
| Invalid `minAmount`/`maxAmount` | 400 | `INVALID_FILTER` |

## Architecture

```
donationEvents (EventEmitter)
        │  donation.created / confirmed / failed
        ▼
  SseManager.broadcast(event, tx)
        │  iterates all clients, applies filter
        ▼
  res.write("id: N\nevent: ...\ndata: ...\n\n")
```

**`src/services/SseManager.js`** — stateless connection registry:
- `addClient` / `removeClient` — register/deregister SSE connections
- `broadcast(event, tx)` — fan-out to matching clients, buffer event
- `getMissedEvents(lastEventId)` — replay support (circular buffer, 500 events)
- `matchesFilter(tx, filter)` — pure filter predicate
- `getStats()` — connection counts by key

## Files Changed

| File | Change |
|------|--------|
| `src/services/SseManager.js` | New — SSE connection manager |
| `src/routes/stream.js` | Added `GET /stream/feed` and `GET /stream/stats` |
| `tests/add-streaming-transaction-feed-via-serversent-even.test.js` | New — 33 tests |
