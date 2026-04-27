# Orderbook Streaming — Feature Documentation

## Overview

Provides real-time Stellar DEX order book data via two endpoints:

- **Snapshot** — a single HTTP response with the current bids/asks
- **Stream** — a persistent Server-Sent Events (SSE) connection that pushes live updates

## Endpoints

### GET `/orderbook/:baseAsset/:counterAsset/snapshot`

Returns the current order book state for a trading pair.

**Query parameters**

| Param   | Type    | Default | Max | Description                  |
|---------|---------|---------|-----|------------------------------|
| `limit` | integer | `20`    | 200 | Max entries returned per side |

**Response**

```json
{
  "success": true,
  "data": {
    "bids": [{ "price": "0.12", "amount": "500.0000000", "price_r": { "n": 3, "d": 25 } }],
    "asks": [{ "price": "0.13", "amount": "200.0000000", "price_r": { "n": 13, "d": 100 } }],
    "base":    { "asset_type": "native" },
    "counter": { "asset_type": "credit_alphanum4", "asset_code": "USDC", "asset_issuer": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" }
  }
}
```

### GET `/orderbook/:baseAsset/:counterAsset/stream`

Opens an SSE stream. The server pushes a JSON payload on every order book change.

**Response headers**

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

**Event format**

Each event is a raw `data:` line followed by a blank line:

```
data: {"bids":[...],"asks":[...],"base":{...},"counter":{...}}

```

The stream is closed automatically when the client disconnects, releasing the underlying Horizon subscription.

## Asset Path Parameter Format

Path parameters are URL-decoded before parsing.

| Asset          | Path segment example                                      |
|----------------|-----------------------------------------------------------|
| Native XLM     | `XLM` or `native` (case-insensitive)                      |
| Custom asset   | `CODE:ISSUER` — e.g. `USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` |

URL-encode the colon when embedding in a URL path:

```
GET /orderbook/XLM/USDC%3AGA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN/snapshot
```

Invalid formats (e.g. `USDC` without an issuer, or an empty string) return `400 Bad Request`.

## Authentication

Both endpoints require a valid API key (`x-api-key` header) with at least the `donations:read` permission.

## Connection Management

- Each SSE client holds one Horizon stream subscription.
- When the HTTP connection closes (`req.on('close')`), the Horizon stream is explicitly terminated to prevent memory leaks.
- Concurrent streams for **different** asset pairs are fully independent.
- Multiple clients may subscribe to the **same** pair simultaneously; each receives its own copy of every update.

## Mock / Testing

`MockStellarService` implements the same interface without network calls:

```js
const mock = new MockStellarService();

// Subscribe
const close = mock.streamOrderbook('XLM', 'USDC:GABC', (update) => {
  console.log(update);
});

// Simulate a market update in tests
mock.triggerOrderbookUpdate('XLM', 'USDC:GABC', {
  bids: [{ price: '0.5', amount: '100' }],
  asks: [],
});

// Inspect active listener count
mock.getOrderbookListenerCount('XLM', 'USDC:GABC'); // → 1

// Unsubscribe
close();
```

## Error Handling

| Condition              | HTTP status | Error code      |
|------------------------|-------------|-----------------|
| Invalid asset format   | 400         | `VALIDATION_ERROR` |
| Missing / invalid key  | 401         | `UNAUTHORIZED`  |
| Horizon unavailable    | 503         | propagated from StellarService |
