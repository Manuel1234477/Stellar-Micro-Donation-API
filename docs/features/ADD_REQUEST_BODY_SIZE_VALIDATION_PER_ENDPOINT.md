# Per-Endpoint Request Body Size Validation

## Overview

Each API endpoint enforces its own configurable payload size limit. The check
happens against the `Content-Length` header **before** the request body is
parsed, so oversized requests are rejected cheaply without consuming memory.

## Limits

| Endpoint | Limit | Constant |
|---|---|---|
| `POST /donations` | 10 KB | `ENDPOINT_LIMITS.singleDonation` |
| `POST /donations/send` | 10 KB | `ENDPOINT_LIMITS.singleDonation` |
| `POST /donations/verify` | 10 KB | `ENDPOINT_LIMITS.singleDonation` |
| `POST /donations/batch` | 512 KB | `ENDPOINT_LIMITS.batchDonation` |
| `POST /wallets` | 20 KB | `ENDPOINT_LIMITS.wallet` |
| `POST /stream/create` | 10 KB | `ENDPOINT_LIMITS.stream` |
| `POST /transactions/sync` | 50 KB | `ENDPOINT_LIMITS.transaction` |
| All other routes (fallback) | 100 KB | `ENDPOINT_LIMITS.default` |

## Error Response

When a request exceeds the limit the middleware returns **HTTP 413** with:

```json
{
  "success": false,
  "error": {
    "code": "PAYLOAD_TOO_LARGE",
    "message": "Request body too large. Maximum allowed size for this endpoint is 10.00 KB.",
    "details": {
      "received_size": "12.50 KB",
      "max_size": "10.00 KB",
      "max_size_bytes": 10240
    },
    "requestId": "<uuid>",
    "timestamp": "2026-03-24T17:00:00.000Z"
  }
}
```

The `max_size_bytes` field is the raw byte value, useful for programmatic
comparisons.

## Logging

Every rejected request is logged at `WARN` level via `log.warn` with:

- `ip` — client IP address
- `method` — HTTP method
- `path` — request path
- `contentLength` — bytes declared by the client
- `maxBytes` — the limit for this endpoint

## Usage in Routes

```js
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../middleware/payloadSizeLimiter');

// Single donation — tight limit
router.post('/donations', payloadSizeLimiter(ENDPOINT_LIMITS.singleDonation), handler);

// Batch donations — relaxed limit
router.post('/donations/batch', payloadSizeLimiter(ENDPOINT_LIMITS.batchDonation), handler);

// Custom one-off limit
router.post('/upload', payloadSizeLimiter(2 * 1024 * 1024), handler); // 2 MB
```

The middleware must be placed **before** `express.json()` / `express.urlencoded()`
on the route so the body is never parsed for oversized requests.

## Files Changed

| File | Change |
|---|---|
| `src/middleware/payloadSizeLimiter.js` | New configurable factory middleware |
| `src/routes/donation.js` | Per-endpoint limits on all POST routes |
| `src/routes/wallet.js` | Per-endpoint limit on `POST /wallets` |
| `src/routes/stream.js` | Per-endpoint limit on `POST /stream/create` |
| `src/routes/transaction.js` | Per-endpoint limit on `POST /transactions/sync` |
| `src/routes/app.js` | Updated import to new module |
| `tests/add-request-body-size-validation-per-endpoint.test.js` | 28 tests |
