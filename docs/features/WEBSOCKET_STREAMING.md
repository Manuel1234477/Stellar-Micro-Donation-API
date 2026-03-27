# Real-Time Balance Streaming via WebSocket

Clients can subscribe to wallet addresses and receive push notifications when a balance change is detected.

## Endpoint

```
ws://host/ws/balances?apiKey=<your-api-key>
```

Or pass the key as a header on the upgrade request: `x-api-key: <key>`.

Unauthenticated connections are rejected immediately (HTTP 401 / close code 4001).

## Enable

```env
ENABLE_SERVER_PUSH=true   # not required for WebSocket — WS is always available
```

## Protocol

### 1. Connect & authenticate

```js
const ws = new WebSocket('ws://localhost:3000/ws/balances?apiKey=' + process.env.API_KEY);

ws.addEventListener('message', ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.event === 'connected') console.log('Ready');
});
```

### 2. Subscribe to wallets

```js
ws.send(JSON.stringify({
  action: 'subscribe',
  wallets: ['GA...', 'GB...'],
}));
```

Max 50 wallets per connection. Exceeding the limit returns an error event and truncates the list.

### 3. Receive balance updates

```json
{ "event": "balance_update", "wallet": "GA...", "new_balance": "100.00", "asset": "XLM" }
```

### 4. Unsubscribe

```js
ws.send(JSON.stringify({ action: 'unsubscribe', wallets: ['GA...'] }));
```

## Heartbeat

The server sends a WebSocket `ping` every 30 seconds (configurable via `WS_HEARTBEAT_MS`). Clients that do not respond with a `pong` are terminated.

## Resource Limits

| Limit | Default | Env var |
|---|---|---|
| Max wallets per connection | 50 | `WS_MAX_WALLETS` |
| Heartbeat interval | 30 000 ms | `WS_HEARTBEAT_MS` |

## Security

- Auth is validated on the HTTP upgrade handshake — no unauthenticated frames are ever processed.
- Subscriptions are scoped to the authenticated key's permissions.
- All subscription state is cleaned up on disconnect to prevent memory leaks.
