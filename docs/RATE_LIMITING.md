# Rate Limiting

This document describes every rate-limiting layer enforced by the API, the response
headers that convey quota state, and the recommended client behaviour for handling
throttling gracefully.

---

## Contents

1. [Overview](#1-overview)
2. [Rate-Limit Layers](#2-rate-limit-layers)
   - [2.1 Global IP Rate Limit](#21-global-ip-rate-limit)
   - [2.2 Per-API-Key Rate Limit](#22-per-api-key-rate-limit)
   - [2.3 Endpoint-Specific Limits](#23-endpoint-specific-limits)
   - [2.4 Abuse Detection Signals](#24-abuse-detection-signals)
3. [Rate-Limit Headers](#3-rate-limit-headers)
4. [HTTP 429 Response Body](#4-http-429-response-body)
5. [Recommended Client Behaviour](#5-recommended-client-behaviour)
6. [Configuration Reference](#6-configuration-reference)
7. [Redis-Backed Store](#7-redis-backed-store)

---

## 1. Overview

Rate limiting is applied at three independent layers. A request may be rejected by any
one of them:

| Layer | Scope | Algorithm |
|---|---|---|
| Global IP | All endpoints, per IP address | Fixed window (`express-rate-limit` on the shared store) |
| Per-API-key | All endpoints, per authenticated API key | Fixed window (shared store: in-memory or Redis) |
| Endpoint-specific | Individual high-value endpoints | Fixed window (`express-rate-limit` on the shared store) |

In addition, an **abuse detection** system tracks anomalous request patterns and emits
observability signals (no blocking at this layer — see [§2.4](#24-abuse-detection-signals)).

---

## 2. Rate-Limit Layers

### 2.1 Global IP Rate Limit

Applies to **every request**, keyed by the client IP address.

| Property | Value |
|---|---|
| **Limit** | `RATE_LIMIT` env var (default **100 requests**) |
| **Window** | `RATE_LIMIT_WINDOW_MS` env var (default **60 seconds**) |
| **Key** | Client IP address |
| **Algorithm** | Fixed window |
| **Response on breach** | HTTP `429` |

> **Note:** When `DISABLE_RATE_LIMIT=true` (development only), this layer is bypassed
> entirely. This flag causes startup failure in `NODE_ENV=production`.

### 2.2 Per-API-Key Rate Limit

Applies to **authenticated requests** that carry a database-backed API key (not the
legacy `API_KEYS` env var list). The limit is stored per key and defaults to 100
requests per minute if not explicitly configured on the key record.

| Property | Value |
|---|---|
| **Limit** | `rateLimitPerMinute` field on the API key record (default **100 requests**) |
| **Window** | `rateLimitWindowSeconds` field on the API key record (default **60 seconds**) |
| **Key** | API key ID |
| **Algorithm** | Fixed window |
| **Response on breach** | HTTP `429` with `Retry-After` header |
| **Backing store** | In-memory (default) or Redis — see [§7](#7-redis-backed-store) |

This layer is in **addition to** the global IP limit. A key with a high per-key limit is
still subject to the global IP limit.

### 2.3 Endpoint-Specific Limits

These limits target high-risk or expensive endpoints to prevent abuse and protect
downstream systems (Stellar network, database).

| Endpoint | Limit | Window | Key | Limiter name |
|---|---|---|---|---|
| `POST /donations` | 10 req | 60 s | API key ID or IP | `donationRateLimiter` |
| `POST /donations/verify` | 30 req | 60 s | API key ID or IP | `verificationRateLimiter` |
| `POST /donations/batch` | 1 req | 60 s | API key ID or IP | `batchRateLimiter` |
| `POST /wallets/bulk-import` | 5 req | 60 s | API key ID or IP | `bulkImportRateLimiter` |
| `GET /wallets/:id/history?source=live` | 10 req | 60 s | API key ID or IP | `liveHistoryRateLimiter` |
| `POST /auth/token` | `AUTH_TOKEN_RATE_LIMIT` (default 10) req | 60 s | IP | `authTokenRateLimiter` |
| `POST /auth/refresh` | `AUTH_REFRESH_RATE_LIMIT` (default 20) req | 60 s | IP | `authRefreshRateLimiter` |
| `GET /health` | 60 req | 60 s | IP | `healthCheckRateLimiter` |
| `GET /stats` | 30 req | 60 s | API key ID or IP | `statsRateLimiter` |
| `POST /wallets/:id/fund` (Friendbot) | 5 req | 60 s | API key ID or IP | `friendbotRateLimiter` |

**Key selection:** Endpoints that accept authenticated requests prefer the API key ID as
the rate-limit key (fairer for clients behind shared NAT). Unauthenticated requests fall
back to the IP address.

**Idempotency bypass:** `POST /donations` skips incrementing the counter when the
request carries a valid `X-Idempotency-Key` whose response is already cached. This
allows safe retries without consuming quota.

### 2.4 Abuse Detection Signals

A separate abuse-detection middleware (`src/middleware/abuseDetection.js`) tracks:

- **Request bursts:** more than 100 requests from a single IP within 60 seconds
- **Repeated failures:** more than 20 `4xx`/`5xx` responses from a single IP within
  5 minutes

When either threshold is exceeded, the IP is **flagged** (not blocked) and:
- A `WARN` log entry is emitted with `scope: "ABUSE_DETECTION"`
- The response includes `X-Abuse-Signal: flagged`
- Traffic continues normally

See [docs/ABUSE_DETECTION.md](./ABUSE_DETECTION.md) for full details.

---

## 3. Rate-Limit Headers

Every response from a rate-limited endpoint includes the following headers, regardless
of whether the limit was reached:

| Header | Type | Value |
|---|---|---|
| `RateLimit-Limit` | integer | The maximum number of requests allowed in the current window |
| `RateLimit-Remaining` | integer | The number of requests remaining in the current window (minimum 0) |
| `RateLimit-Reset` | Unix timestamp (seconds) | The UTC time at which the current window resets and the counter returns to `RateLimit-Limit` |
| `X-RateLimit-Limit` | integer | Same as `RateLimit-Limit` (legacy alias) |
| `X-RateLimit-Remaining` | integer | Same as `RateLimit-Remaining` (legacy alias) |
| `X-RateLimit-Reset` | Unix timestamp (seconds) | Same as `RateLimit-Reset` (legacy alias) |

When a `429` response is returned, an additional header is present:

| Header | Type | Value |
|---|---|---|
| `Retry-After` | integer (seconds) | How many seconds the client must wait before making another request |

On endpoints where the rate-limit key can be either an API key or an IP address, the
header `X-RateLimit-Identifier` is also set:

| Header | Value |
|---|---|
| `X-RateLimit-Identifier` | `api-key` or `ip` |

### Header source by layer

| Layer | Headers emitted |
|---|---|
| Global IP (express-rate-limit) | `RateLimit-*` + `X-RateLimit-*` (`standardHeaders: true`, `legacyHeaders: true`) |
| Per-API-key (perKeyRateLimit) | `RateLimit-*` + `X-RateLimit-*` + `Retry-After` on 429 |
| Endpoint-specific (express-rate-limit) | `RateLimit-*` + `X-RateLimit-*` + `Retry-After` on 429 |

---

## 4. HTTP 429 Response Body

All rate-limit rejections return a JSON body in the standard error envelope:

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests from this IP. Please try again later.",
    "retryAfter": 42
  }
}
```

`retryAfter` is an integer number of seconds matching the `Retry-After` header.

Some endpoints include additional context:

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many verification requests for this API key. Please try again later.",
    "retryAfter": 15,
    "limitedBy": "api-key"
  }
}
```

---

## 5. Recommended Client Behaviour

### Read `Retry-After` before retrying

Every `429` response includes a `Retry-After` header. **Do not retry before this many
seconds have elapsed.** Retrying earlier wastes quota and can trigger the abuse-detection
burst signal.

```
HTTP/1.1 429 Too Many Requests
Retry-After: 42
RateLimit-Limit: 100
RateLimit-Remaining: 0
RateLimit-Reset: 1719619260
```

### Monitor `RateLimit-Remaining` proactively

Before the limit is reached, `RateLimit-Remaining` counts down from `RateLimit-Limit`
toward zero. If your integration makes bursts of requests, pause when
`RateLimit-Remaining` drops below a comfortable threshold (e.g. 10) and wait for the
window to reset.

### Use exponential backoff with jitter

When a `429` is received, use exponential backoff to space out retries:

```
delay = min(BASE_DELAY * 2^attempt, MAX_DELAY) + random(0, JITTER)
```

A reasonable starting point:

| Parameter | Value |
|---|---|
| `BASE_DELAY` | 1 second |
| `MAX_DELAY` | 60 seconds |
| `JITTER` | 0–1 second (uniform random) |
| Max retries | 5 |

**Never use fixed-interval retries** — simultaneous retries from multiple clients create
thundering-herd effects that worsen congestion.

### Honour `Retry-After` as a floor

The `Retry-After` value is already the minimum safe wait time. Apply your backoff
formula on top of it:

```
effective_delay = Retry-After + backoff(attempt)
```

### Use idempotency keys for mutation retries

Append `X-Idempotency-Key: <uuid>` to `POST /donations` requests. If a request is
retried after a network failure, the server returns the original response without
consuming additional rate-limit quota or creating a duplicate donation.

### Example: correct 429 handling (JavaScript)

```javascript
async function postWithRetry(url, body, maxAttempts = 5) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.API_KEY,
        'X-Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    });

    if (res.status !== 429) return res;

    const retryAfter = parseInt(res.headers.get('Retry-After') || '60', 10);
    const jitter = Math.random() * 1000;
    const backoff = Math.min(1000 * Math.pow(2, attempt), 60000);
    await new Promise(r => setTimeout(r, retryAfter * 1000 + backoff + jitter));
  }
  throw new Error('Exceeded maximum retry attempts');
}
```

---

## 6. Configuration Reference

| Variable | Default | Effect |
|---|---|---|
| `RATE_LIMIT` | `100` | Global requests per window per IP |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Global rate-limit window in milliseconds |
| `RATE_LIMIT_STORE` | `memory` | Backing store: `memory` or `redis` |
| `RATE_LIMIT_FAIL_OPEN` | `true` | On Redis failure: `true` = allow, `false` = deny |
| `REDIS_URL` | — | Redis connection URL (required when `RATE_LIMIT_STORE=redis`) |
| `AUTH_TOKEN_RATE_LIMIT` | `10` | Requests/minute on `POST /auth/token` |
| `AUTH_REFRESH_RATE_LIMIT` | `20` | Requests/minute on `POST /auth/refresh` |
| `DISABLE_RATE_LIMIT` | `false` | Bypass all rate limiting (dev only) |

Full documentation in [docs/CONFIGURATION.md § Rate Limiting](./CONFIGURATION.md#8-rate-limiting).

---

## 7. Rate Limit Store (single abstraction, #1777)

Every limiter counts through **one** store abstraction in
`src/services/rateLimitStores/`:

| Limiter | How it uses the store |
|---|---|
| `perKeyRateLimit` / `checkRateLimit` (`src/middleware/perKeyRateLimit.js`) | `getRateLimitStore().incrementAndCheck()` |
| Named limiters in `src/middleware/rateLimiter.js`, `routes/tiers.js`, `routes/receipt.js` | `express-rate-limit` with `ExpressRateLimitStore` adapter (one adapter + key prefix per limiter) |
| Abuse detection detectors (`src/services/AbuseDetectionService.js`) | `getRateLimitStore().increment()` |
| Monthly quotas (`src/middleware/quotaTracker.js`) | Persisted in the `api_keys` table (already shared across instances) |

There is no other rate-limit store; the former `src/middleware/RateLimitStore.js` was removed.

### Backends

By default counters live in an in-process fixed-window map (`MemoryRateLimitStore`).
That is fine for a single instance; with N instances a client can make up to N times
each limit.

For **multi-instance deployments** set:

```env
RATE_LIMIT_STORE=redis
REDIS_URL=redis://your-redis-host:6379
```

The Redis store runs one Lua script per hit (INCR, PEXPIRE on first hit, PTTL), so
counts are atomic and consistent across every instance sharing the Redis server. It
works with `ioredis` or `redis` (v4); install one of them when enabling Redis.

### Store failure behaviour

| Situation | Behaviour | Logged as |
|---|---|---|
| `RATE_LIMIT_STORE=redis` but no `REDIS_URL` or no client package | Uses in-memory store | `warn RATE_LIMIT` |
| Redis does not answer `PING` at startup | Switches to in-memory store | `warn RATE_LIMIT` |
| Store error on a request, `RATE_LIMIT_FAIL_OPEN` unset/`true` | **Fail-open**: request allowed | `error RATE_LIMIT_STORE` with `policy: "fail-open"` |
| Store error on a request, `RATE_LIMIT_FAIL_OPEN=false` | **Fail-closed**: request rejected with 429 | `error RATE_LIMIT_STORE` with `policy: "fail-closed"` |
| Store error in abuse detection | Counter skipped (detection is observe-only) | `error ABUSE_DETECTION` |
| Legacy env API key path (`checkRateLimit`) with Redis configured | Allowed (synchronous path cannot wait on Redis); DB-backed keys are still limited | — |

Store errors are never swallowed silently.

---

*Related issues: [#1179](https://github.com/Manuel1234477/Stellar-Micro-Donation-API/issues/1179),
[#1177](https://github.com/Manuel1234477/Stellar-Micro-Donation-API/issues/1177)*  
*Related docs: [ABUSE_DETECTION.md](./ABUSE_DETECTION.md), [CONFIGURATION.md](./CONFIGURATION.md)*
