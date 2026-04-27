# Transaction Stream SSE

Real-time confirmed transaction events delivered over Server-Sent Events.

---

## Endpoint

```
GET /transactions/stream
```

**Headers**

| Header | Description |
|---|---|
| `x-api-key` | API key used for per-key connection limiting (defaults to `anonymous`) |

**Query Parameters**

| Param | Description |
|---|---|
| `walletAddress` | Only receive transactions where donor or recipient matches |
| `campaignId` | Only receive transactions for a specific campaign |

---

## Event Format

```
data: {"type":"transaction.confirmed","data":{...transaction...}}

```

### Connection event (on connect)

```
data: {"type":"connected"}

```

### Heartbeat (every 30 seconds)

```
: ping

```

---

## Connection Limits

Maximum **5 concurrent SSE connections per API key**. Exceeding this returns:

```json
HTTP 429
{ "error": "CONNECTION_LIMIT_EXCEEDED" }
```

---

## Example

```js
const es = new EventSource('/transactions/stream?walletAddress=GABC123', {
  headers: { 'x-api-key': 'my-api-key' }
});

es.onmessage = (e) => {
  const { type, data } = JSON.parse(e.data);
  if (type === 'transaction.confirmed') console.log('New tx:', data);
};
```

---

## Broadcasting Transactions

Use `SseManager.broadcastTransaction(tx)` after a transaction is confirmed:

```js
const sseManager = require('./src/services/SseManager');

// After confirming a transaction:
sseManager.broadcastTransaction({
  id: '123',
  donor: 'GABC',
  recipient: 'GXYZ',
  amount: 10,
  campaignId: 'camp-1',
  status: 'confirmed',
});
```

---

## Architecture

```
SseManager (singleton, EventEmitter-like)
 ├─ addClient(apiKey, res, filters)  → enforces 5-conn limit, registers close handler
 ├─ broadcastTransaction(tx)         → filters + writes SSE event to matching clients
 ├─ _sendHeartbeat()                 → writes ": ping\n\n" to all clients
 └─ start() / stop()                 → controls 30s heartbeat interval

GET /transactions/stream
 └─ calls sseManager.addClient(), sets SSE headers, sends connected event
```

---

## Tests

```bash
node tests/run-sse-smoke.js   # 16 logic tests, no jest required
npm test -- tests/transaction-stream-sse.test.js  # jest suite (requires Node 18+)
```

Test cases cover: addClient, connection limit (5/key), close cleanup, broadcast to all, walletAddress filter (donor/recipient), campaignId filter, combined filters, heartbeat, start/stop, 429 response, anonymous key fallback.
