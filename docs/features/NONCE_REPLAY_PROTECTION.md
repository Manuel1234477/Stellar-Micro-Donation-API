# Nonce-Based Request Replay Protection

## Overview

Even with HMAC-SHA256 request signing and a 5-minute validity window, a captured
signed request could be replayed by an attacker within that window. Nonce-based
replay protection closes this gap: every signed request must carry a unique
`X-Nonce` header, and the server rejects any request whose nonce has been seen
before.

## How It Works

```
Client                                  Server
  │                                       │
  │  Generate random nonce (≥ 16 bytes)   │
  │  Sign request (HMAC-SHA256)           │
  │──── POST /donations ────────────────► │
  │     X-Timestamp: <unix-ts>            │  1. Verify signature (requestSigner)
  │     X-Signature: <hmac>               │  2. Check X-Nonce present
  │     X-Nonce:     <random-hex>         │  3. nonceStore.check(nonce)
  │                                       │     ├─ seen=false → record & continue
  │◄─── 200 OK ────────────────────────── │     └─ seen=true  → 409 Conflict
  │                                       │
  │  Replay same request                  │
  │──── POST /donations ────────────────► │
  │     (same headers)                    │  nonceStore.check(nonce) → seen=true
  │◄─── 409 Conflict ─────────────────── │
```

## Files

| File | Purpose |
|------|---------|
| `src/utils/nonceStore.js` | Bounded in-memory nonce store with expiry and metrics |
| `src/middleware/apiKey.js` | Enforces `X-Nonce` for signed requests (updated) |
| `tests/nonce-replay.test.js` | Full test suite |

## Client Usage

Generate a cryptographically random nonce per request and include it alongside
the existing signing headers:

```js
const crypto = require('crypto');

const nonce = crypto.randomBytes(16).toString('hex'); // 32-char hex
const timestamp = String(Math.floor(Date.now() / 1000));

// Sign as before, then add X-Nonce
headers['X-Timestamp'] = timestamp;
headers['X-Signature'] = sign({ secret, method, path, timestamp, body });
headers['X-Nonce']     = nonce;
```

## Error Responses

| Condition | Status | Code |
|-----------|--------|------|
| `X-Nonce` header absent | `401` | `MISSING_NONCE` |
| Nonce already seen (replay) | `409` | `NONCE_REPLAYED` |

### 409 Example

```json
{
  "success": false,
  "error": {
    "code": "NONCE_REPLAYED",
    "message": "This request has already been processed. Use a unique nonce per request.",
    "requestId": "req-abc123",
    "timestamp": "2026-03-25T13:00:00.000Z"
  }
}
```

## Configuration

| Environment Variable | Default | Description |
|----------------------|---------|-------------|
| `NONCE_STORE_MAX_SIZE` | `10000` | Maximum nonces held in memory at once |

The expiry window is tied to `SIGNATURE_MAX_AGE_MS` (5 minutes) so nonces are
automatically eligible for cleanup after the signing window closes.

## Security Assumptions

- **Nonce entropy**: Clients must use at least 16 random bytes (128 bits). Shorter
  or predictable nonces reduce security. The server does not enforce a minimum
  length but the requirement is documented here.
- **Clock skew**: The request signer already rejects timestamps more than 30 s in
  the future or older than 5 minutes. Nonce expiry is aligned to the same window,
  so a nonce cannot be replayed after it expires.
- **Memory-only store**: Nonces are not persisted. A server restart clears the
  store. In a multi-instance deployment, use a shared store (e.g. Redis) instead
  of the default in-memory implementation.
- **Bounded size**: When the store reaches `NONCE_STORE_MAX_SIZE`, the oldest
  entry is evicted (FIFO). This prevents memory exhaustion at the cost of
  theoretically allowing a replay of a very old evicted nonce. The signing window
  makes such a replay invalid anyway.

## Metrics

`nonceStore.getMetrics()` returns:

```js
{
  size:      number,  // current entries in store
  maxSize:   number,  // configured cap
  hits:      number,  // replay attempts blocked
  misses:    number,  // new nonces accepted
  hitRate:   number,  // hits / (hits + misses)
  evictions: number   // entries dropped due to size cap
}
```

Expose these via your health/metrics endpoint to monitor replay activity.
