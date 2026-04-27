# Distributed Tracing with OpenTelemetry

End-to-end distributed tracing for the Stellar Micro-Donation API using the
[OpenTelemetry](https://opentelemetry.io/) standard. Traces flow from inbound
HTTP requests through database queries and Stellar network calls, and are
exported to any OTLP-compatible backend (Jaeger, Zipkin, Grafana Tempo, AWS
X-Ray OTLP, etc.).

---

## Architecture

```
HTTP Request
    │
    ▼
httpTracingMiddleware()          ← root SERVER span, traceparent injected into response
    │
    ├── traceDbQuery()           ← child CLIENT span (db.system=sqlite)
    │
    └── traceStellarCall()       ← child CLIENT span (peer.service=stellar-horizon)
```

All spans within a single request share the same `traceId`. The W3C
`traceparent` header is read from inbound requests (enabling cross-service
parent linking) and written to outbound responses.

---

## Module: `src/utils/tracing.js`

### Lifecycle

```js
const { initTracing, shutdownTracing } = require('./utils/tracing');

// Call once at application startup (before any requests are served)
initTracing({
  serviceName: 'stellar-donation-api',   // default: OTEL_SERVICE_NAME env var
  endpoint: 'http://collector:4318',     // default: OTEL_EXPORTER_OTLP_ENDPOINT
  exporterHeaders: 'Authorization=Bearer token', // or object
  enabled: true,                         // default: OTEL_ENABLED !== 'false'
});

// Call during graceful shutdown
process.on('SIGTERM', async () => {
  await shutdownTracing();
  process.exit(0);
});
```

`initTracing` is idempotent — safe to call multiple times.

### HTTP Middleware

```js
const { httpTracingMiddleware } = require('./utils/tracing');

app.use(httpTracingMiddleware());
```

Creates a root `SERVER` span for every request with attributes:

| Attribute | Value |
|---|---|
| `http.method` | `GET`, `POST`, … |
| `http.url` | Full URL including query string |
| `http.route` | Path without query string |
| `http.host` | Hostname |
| `http.scheme` | `http` / `https` |
| `net.peer.ip` | Client IP |
| `http.request_id` | Value of `X-Request-ID` / `req.id` |
| `http.status_code` | Set on response finish |

The `traceparent` header is injected into the response. If the inbound request
carries a `traceparent` header, the new span is created as a child of that
remote span (enabling cross-service trace stitching).

### Generic Span Helper

```js
const { withSpan } = require('./utils/tracing');

const result = await withSpan(
  'my.operation',
  { 'custom.attribute': 'value' },
  async (span) => {
    span.setAttribute('result.count', 42);
    return doWork();
  }
);
```

- Sets `OK` status on success, `ERROR` + records exception on throw.
- Span is always ended, even if the callback throws.
- Nested calls automatically create parent-child relationships.

### Database Tracing

```js
const { traceDbQuery } = require('./utils/tracing');

const rows = await traceDbQuery('SELECT', 'donations', () =>
  db.all('SELECT * FROM donations WHERE user_id = ?', [userId])
);
```

Span attributes: `db.system=sqlite`, `db.operation`, `db.sql.table`,
`db.rows_affected`.

### Stellar Network Tracing

```js
const { traceStellarCall } = require('./utils/tracing');

const result = await traceStellarCall(
  'sendDonation',
  { 'stellar.network': 'testnet', 'stellar.horizon_url': horizonUrl },
  () => stellarService.sendDonation(params)
);
```

Span attributes: `stellar.operation`, `peer.service=stellar-horizon`, plus any
extra attributes passed.

### Context Propagation

```js
const { injectTraceHeaders, extractTraceContext, getCurrentTraceparent } =
  require('./utils/tracing');

// Inject W3C traceparent into outbound HTTP headers
const headers = injectTraceHeaders({ 'Content-Type': 'application/json' });

// Extract trace context from inbound headers
const ctx = extractTraceContext(req.headers);

// Get the current traceparent string (useful for logging)
const tp = getCurrentTraceparent(); // "00-<traceId>-<spanId>-01" or null
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `OTEL_ENABLED` | `true` | Set to `false` to disable all tracing |
| `OTEL_SERVICE_NAME` | `stellar-donation-api` | Service name in traces |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | OTLP collector base URL |
| `OTEL_EXPORTER_OTLP_HEADERS` | _(none)_ | Auth headers: `key=value,key2=value2` |

---

## Graceful Degradation

The module requires only `@opentelemetry/api` at runtime. The full SDK
packages (`@opentelemetry/sdk-node`, `@opentelemetry/exporter-trace-otlp-http`,
etc.) are loaded lazily. If they are not installed, tracing initialises in
no-op mode — all `withSpan` / `traceStellarCall` / `traceDbQuery` calls still
execute their callbacks normally, they just don't emit spans.

---

## Security Considerations

- No PII is added to span attributes by default.
- The `traceparent` header is a standard W3C header; it contains only opaque
  hex IDs (no user data).
- OTLP exporter headers (e.g. `Authorization`) are read from environment
  variables, never hardcoded.
- Tracing can be disabled entirely via `OTEL_ENABLED=false` for environments
  where telemetry export is not permitted.

---

## Testing

Tests live in
`tests/implement-distributed-tracing-with-opentelemetry.test.js`.

The test suite uses a hand-rolled in-memory `RecordingTracer` and a minimal
`AsyncLocalStorage`-based context manager — no live collector or full SDK
packages required.

```bash
npx jest tests/implement-distributed-tracing-with-opentelemetry.test.js
```

Coverage areas:
- `initTracing` / `shutdownTracing` lifecycle and idempotency
- `withSpan`: success, error, nested parent-child relationships
- `startSpan`: manual span management
- `httpTracingMiddleware`: attributes, status codes, traceparent propagation
- `traceDbQuery`: db attributes, rows_affected, error handling
- `traceStellarCall`: stellar attributes, MockStellarService integration
- `injectTraceHeaders` / `extractTraceContext`: round-trip propagation
- `getCurrentTraceparent` / `getActiveSpanContext`
- Edge cases: concurrent spans, deeply nested spans, missing SDK
