# API Response Envelope Standardization

All API responses follow a consistent envelope format so clients always know what to expect.

## Envelope Format

### Success

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "requestId": "550e8400-e29b-41d4-a716-446655440000",
    "timestamp": "2026-03-24T20:00:00.000Z",
    "duration": 12
  }
}
```

### Failure

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Resource not found",
    "details": { ... }
  },
  "meta": {
    "requestId": "550e8400-e29b-41d4-a716-446655440000",
    "timestamp": "2026-03-24T20:00:00.000Z",
    "duration": 5
  }
}
```

### Fields

| Field | Type | Always present | Description |
|---|---|---|---|
| `success` | boolean | ✅ | `true` for success, `false` for error |
| `data` | any | Success only | Response payload |
| `error.code` | string | Error only | Machine-readable error code |
| `error.message` | string | Error only | Human-readable description |
| `error.details` | any | Optional | Extra validation/context info |
| `meta.requestId` | string | ✅ | Unique ID for tracing (echoes `X-Request-ID` header) |
| `meta.timestamp` | ISO 8601 | ✅ | When the response was generated |
| `meta.duration` | number (ms) | ✅ | Server-side processing time |

## Usage in Route Handlers

The `responseFormatterMiddleware` is registered globally in `app.js` and attaches two helpers to every `res` object.

### `res.success(data, status?)`

```js
// 200 OK
res.success({ id: 1, name: 'Alice' });

// 201 Created
res.success({ id: 42 }, 201);
```

### `res.failure(code, message, status?, details?)`

```js
// 404
res.failure('NOT_FOUND', 'Wallet not found', 404);

// 400 with details
res.failure('VALIDATION_ERROR', 'Invalid amount', 400, { field: 'amount', min: 0.0000001 });
```

## Utility Functions

`src/utils/responseFormatter.js` exports pure functions for use outside Express (e.g. tests):

```js
const { successResponse, errorResponse, buildMeta } = require('./src/utils/responseFormatter');

successResponse({ id: 1 }, 'req-123', Date.now());
// { success: true, data: { id: 1 }, meta: { requestId, timestamp, duration } }

errorResponse('ERR', 'Something failed', 'req-123', Date.now());
// { success: false, error: { code, message }, meta: { requestId, timestamp, duration } }
```

## Middleware Registration

The middleware is registered in `src/routes/app.js` immediately after `requestId` so `req.id` is always available:

```js
app.use(requestId);
app.use(responseFormatterMiddleware());
```

## Testing

```bash
npm test tests/implement-api-response-envelope-standardization.test.js
```
