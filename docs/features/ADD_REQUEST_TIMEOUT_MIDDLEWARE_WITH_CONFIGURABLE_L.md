# Request Timeout Middleware

Aborts requests that exceed a configurable time limit and returns `503 Service Unavailable` with a `Retry-After` header. Different endpoints carry different limits based on their expected processing time.

## How It Works

When a request arrives the middleware sets a `setTimeout`. If the response finishes before the timer fires the timer is cleared and the request proceeds normally. If the timer fires first the middleware:

1. Logs a `WARN` event with `method`, `path`, `timeoutMs`, and client `ip`.
2. Sends `HTTP 503` with `Retry-After: 5` and a structured JSON error body.

A `headersSent` guard prevents a double-write if the handler already started responding.

## Per-Endpoint Timeout Presets

| Constant | Value | Used on |
|---|---|---|
| `TIMEOUTS.health` | 5 s | `/health`, `/health/live`, `/health/ready` |
| `TIMEOUTS.balance` | 10 s | `GET /wallets/:id/balance` |
| `TIMEOUTS.default` | 15 s | General fallback |
| `TIMEOUTS.donation` | 30 s | `POST /donations`, `/donations/send`, `/donations/verify`, `/donations/batch` |
| `TIMEOUTS.stream` | 60 s | `POST /stream/create` |

## Usage

```js
const { requestTimeout, TIMEOUTS } = require('../middleware/requestTimeout');

// Apply directly on a route
router.post('/donations', requestTimeout(TIMEOUTS.donation), handler);

// Or use a custom value
router.get('/slow-report', requestTimeout(45_000), handler);
```

## 503 Response Shape

```json
{
  "success": false,
  "error": {
    "code": "REQUEST_TIMEOUT",
    "message": "Request exceeded the 30000 ms time limit for this endpoint.",
    "details": { "timeoutMs": 30000 },
    "requestId": "<uuid>",
    "timestamp": "2026-03-24T18:00:00.000Z"
  }
}
```

## Environment / Configuration

No environment variables are required. Limits are defined as named constants in `src/middleware/requestTimeout.js` and applied at the route level. To change a limit, update the relevant constant and redeploy.

## Security Notes

- The middleware does **not** forcibly terminate in-flight I/O (Node.js does not expose that API). It sends the 503 to the client and clears the timer; any pending Stellar SDK promise will resolve or reject normally but its result is discarded because `headersSent` will be `true`.
- `Retry-After: 5` is a conservative hint. Clients should implement exponential back-off rather than retrying immediately.
