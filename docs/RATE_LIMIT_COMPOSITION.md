# Rate-Limit Middleware Composition

This document describes the three rate-limiting layers in the API, their
responsibilities, and the order in which they execute on each request.

---

## Layer 1 — Per-Key Sliding-Window (`perKeyRateLimit.js`)

**File:** `src/middleware/perKeyRateLimit.js`  
**Runs:** First, on authenticated routes that supply an API key.

| Concern | Detail |
|---|---|
| Key | Authenticated API key ID |
| Limit | Per-key `rateLimitPerMinute` field (default: 100 req/min) |
| Window | Per-key `rateLimitWindowSeconds` field (default: 60 s) |
| Headers emitted | `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, plus `X-RateLimit-*` variants |
| On exceed | HTTP 429 with `{ code: "RATE_LIMIT_EXCEEDED", retryAfter }` |
| Bypass for legacy keys | Skips limiting when `apiKey.isLegacy === true` |

`buildRateLimitHeaders` — the helper that formats the header values — is
defined in this file and re-exported by `rateLimitHeaders.js`.

```
src/middleware/perKeyRateLimit.js
  └─ buildRateLimitHeaders()   ← canonical implementation
  └─ checkRateLimit()          ← sync helper used by rbac.js (legacy key path)
  └─ perKeyRateLimit           ← async Express middleware (default export)
```

---

## Layer 2 — Named Purpose Limiters (`rateLimiter.js`)

**File:** `src/middleware/rateLimiter.js`  
**Runs:** Applied per-route as a named middleware (e.g. `donationRateLimiter`).

These limiters use `express-rate-limit` with a global IP/key guard for
specific API surfaces:

| Export | Scope | Window | Max |
|---|---|---|---|
| `donationRateLimiter` | `POST /donations` | 60 s | 10 |
| `verificationRateLimiter` | `POST /donations/verify` | 60 s | 30 |
| `batchRateLimiter` | `POST /donations/batch` | 60 s | 1 |
| `bulkImportRateLimiter` | `POST /wallets/bulk-import` | 60 s | 5 |
| `authTokenRateLimiter` | `POST /auth/token` | 60 s | env `AUTH_TOKEN_RATE_LIMIT` (default 10) |
| `authRefreshRateLimiter` | `POST /auth/refresh` | 60 s | env `AUTH_REFRESH_RATE_LIMIT` (default 20) |
| `healthCheckRateLimiter` | `GET /health` | 60 s | 60 |
| `liveHistoryRateLimiter` | `GET /wallets/:id/history?source=live` | 60 s | 10 |
| `friendbotRateLimiter` | Friendbot funding endpoint | 60 s | 5 |
| `statsRateLimiter` | Stats endpoints | 60 s | 30 |
| `createRateLimiter(opts)` | Test/custom factory | configurable | configurable |

All handlers emit an audit log entry via `AuditLogService` and return a
standardised `{ code: "RATE_LIMIT_EXCEEDED", retryAfter }` body.

---

## Layer 3 — Header Re-export Shim (`rateLimitHeaders.js`)

**File:** `src/middleware/rateLimitHeaders.js`  
**Purpose:** Backward-compatibility shim only — contains **no independent logic**.

Re-exports `buildRateLimitHeaders` from Layer 1 so that any future
consumer may import from either module without duplicating the
implementation:

```js
const { buildRateLimitHeaders } = require('./rateLimitHeaders');
// is exactly equivalent to:
const { buildRateLimitHeaders } = require('./perKeyRateLimit');
```

---

## Typical Request Flow

```
Request
  │
  ├─ Layer 2 limiter (e.g. donationRateLimiter)
  │    Keys by API key ID or IP; uses express-rate-limit in-memory store
  │    Rejects with 429 if global quota exceeded
  │
  ├─ Layer 1 perKeyRateLimit
  │    Keys by authenticated API key ID only; uses pluggable RateLimitStore
  │    Emits RateLimit-* headers on every passing response
  │    Rejects with 429 if per-key quota exceeded
  │
  └─ Route handler
```

---

## Adding a New Limiter

1. Add a named `rateLimit({...})` instance to `rateLimiter.js`.
2. Apply it as middleware on the relevant route.
3. If the new limiter emits headers, import `buildRateLimitHeaders` from
   `perKeyRateLimit.js` (the canonical source) — do **not** create a new
   implementation.
4. Update this document.
