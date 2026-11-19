# Distributed Tracing

This document describes the distributed tracing system built into the Stellar Micro-Donation API
using the [OpenTelemetry](https://opentelemetry.io/) (OTel) standard.

---

## Overview

Tracing gives end-to-end visibility into requests as they flow through the API layer, the database,
and outbound calls to the Stellar Horizon API. Each logical unit of work becomes a **span**; related
spans share a common **trace ID** and form a tree that tools like Jaeger, Zipkin, or Honeycomb can
visualise as a flame graph.

The tracing system is implemented in `src/utils/tracing.js` and is designed around three principles:

1. **Silent no-op by default** — tracing activates only when `OTEL_EXPORTER_OTLP_ENDPOINT` is
   explicitly set. The application starts and runs normally without any OTel infrastructure.
2. **Graceful degradation** — if the OTel SDK packages are not installed, every function becomes a
   transparent pass-through. No crashes, no noise.
3. **W3C Trace Context propagation** — all outbound requests (Horizon API, webhooks) carry standard
   `traceparent` / `tracestate` headers so downstream services can continue the same trace.

---

## Architecture

```
 ┌─────────────────────────────────────────────────────────────────────┐
 │  Inbound HTTP Request                                               │
 │  Headers: traceparent: 00-<traceId>-<spanId>-01  (optional)        │
 └──────────────────────┬──────────────────────────────────────────────┘
                        │ httpTracingMiddleware extracts parent context
                        ▼
 ┌─────────────────────────────────────────────────────────────────────┐
 │  Express Route Handler                                              │
 │  withSpan / withSpanInContext                                       │
 │                                                                     │
 │   ├── traceDbQuery  ──► SQLite                                      │
 │   │                                                                 │
 │   └── traceStellarCall / traceHorizonRequest                        │
 │            │                                                        │
 │            │  injectHorizonTraceHeaders adds traceparent            │
 │            ▼                                                        │
 │       Horizon API (https://horizon-testnet.stellar.org)             │
 └──────────────────────┬──────────────────────────────────────────────┘
                        │
                        ▼
 ┌─────────────────────────────────────────────────────────────────────┐
 │  OTLP Exporter  ──►  Collector (Jaeger / Honeycomb / etc.)         │
 │  (only active when OTEL_EXPORTER_OTLP_ENDPOINT is set)             │
 └─────────────────────────────────────────────────────────────────────┘
```

---

## Environment Variables

| Variable | Required to enable tracing | Default | Description |
|---|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | **Yes** | — | Base URL of the OTLP HTTP collector (e.g. `http://jaeger:4318`). When absent, all tracing is a silent no-op. |
| `OTEL_SERVICE_NAME` | No | `stellar-donation-api` | Service name attached to every span. |
| `OTEL_ENABLED` | No | `true` | Set to `false` to disable tracing even when an endpoint is configured. |
| `OTEL_EXPORTER_OTLP_HEADERS` | No | — | Comma-separated `key=value` pairs sent as HTTP headers to the collector (for auth tokens). Example: `Authorization=Bearer my-token`. |

---

## Silent Fallback Behaviour

When `OTEL_EXPORTER_OTLP_ENDPOINT` is **not** set:

- `initTracing()` returns `false` immediately and sets `_enabled = false`.
- `_loadSdk()` returns `null` without attempting any package imports or network connections.
- Every span helper (`withSpan`, `traceDbQuery`, `traceHorizonRequest`, etc.) still calls through to
  the OpenTelemetry API, but since no tracer provider is registered, the SDK returns a no-op tracer
  that discards all spans silently.
- `getCurrentTraceparent()` returns `null` when there is no active span.
- `injectHorizonTraceHeaders()` returns the headers object unchanged (no `traceparent` header added).

This means application code requires **no conditional checks** around tracing calls — they are safe
to leave in production code regardless of whether a collector is configured.

---

## Usage Examples

### Basic span

```js
const { withSpan } = require('./src/utils/tracing');

const result = await withSpan('my.operation', { 'custom.attr': 'value' }, async (span) => {
  // span is the active OTel Span object
  span.setAttribute('result.count', 42);
  return doWork();
});
```

### Database query

```js
const { traceDbQuery } = require('./src/utils/tracing');

const rows = await traceDbQuery('SELECT', 'donations', async () => {
  return db.all('SELECT * FROM donations WHERE status = ?', ['completed']);
});
```

Attributes automatically set: `db.system`, `db.operation`, `db.sql.table`, `db.rows_affected`.

### Stellar call (generic)

```js
const { traceStellarCall } = require('./src/utils/tracing');

const account = await traceStellarCall(
  'loadAccount',
  { 'stellar.network': 'testnet', 'stellar.account': publicKey },
  async () => server.loadAccount(publicKey)
);
```

### Horizon request with W3C header injection

```js
const { traceHorizonRequest } = require('./src/utils/tracing');

const response = await traceHorizonRequest(
  'fetchPayments',
  'https://horizon-testnet.stellar.org/accounts/GA.../payments',
  { 'stellar.account': 'GA...' },
  async ({ injectHeaders }) => {
    const headers = injectHeaders({ Accept: 'application/json' });
    return fetch(url, { headers });
  }
);
```

The `injectHeaders` helper returns a **new** object that merges your existing headers with the
W3C `traceparent` (and optionally `tracestate`) header derived from the currently active span.

### Horizon HTTP client (convenience wrapper)

```js
const { createHorizonHttpClient } = require('./src/utils/tracing');

const horizon = createHorizonHttpClient('https://horizon-testnet.stellar.org', {
  defaultHeaders: { Accept: 'application/json' },
});

// Every call automatically carries traceparent
const res = await horizon.fetch('/accounts/GA.../payments?limit=20');
```

### Manual traceparent header injection

```js
const { injectHorizonTraceHeaders } = require('./src/utils/tracing');

// Inject into outgoing headers object (returns a new copy — does not mutate)
const headers = injectHorizonTraceHeaders({ 'Content-Type': 'application/json' });
// headers may now contain: { 'Content-Type': '...', traceparent: '00-...', tracestate: '...' }
```

---

## W3C Trace Context Propagation for Horizon Calls

The [W3C Trace Context specification](https://www.w3.org/TR/trace-context/) defines two HTTP headers:

| Header | Format | Example |
|---|---|---|
| `traceparent` | `00-{traceId}-{spanId}-{flags}` | `00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01` |
| `tracestate` | `vendor=value,...` | `stellar=rojo,congo=t61rcWkgMzE` |

When the API makes an outbound HTTP request to Horizon, the active span's context is serialised
into these headers. If Horizon (or a compatible proxy) reads and forwards these headers, the
resulting network request will appear as a child of the API span in your tracing backend.

**traceparent field breakdown:**

```
 00   - version (always 00)
  │
  └─► 4bf92f3577b34da6a3ce929d0e0e4736  - 128-bit trace ID (32 hex chars)
                                          │
                                          └─► 00f067aa0ba902b7  - 64-bit parent span ID (16 hex chars)
                                                                  │
                                                                  └─► 01  - flags (01 = sampled)
```

---

## Initialisation

Call `initTracing()` once at application startup, before the first request is served:

```js
const { initTracing, shutdownTracing } = require('./src/utils/tracing');

// In server.js / app.js
const tracingEnabled = initTracing({
  // endpoint: 'http://jaeger:4318',   // optional — overrides OTEL_EXPORTER_OTLP_ENDPOINT
  // serviceName: 'my-service',        // optional — overrides OTEL_SERVICE_NAME
});

console.log(`Tracing ${tracingEnabled ? 'enabled' : 'disabled (no OTLP endpoint configured)'}`);

// Graceful shutdown
process.on('SIGTERM', async () => {
  await shutdownTracing();
  process.exit(0);
});
```

---

## Testing

### Unit tests

The test suite for Horizon-specific tracing is in:

```
tests/tracing/otel-w3c-traceparent-horizon.test.js
```

It covers:

1. `initTracing` silently disabled when `OTEL_EXPORTER_OTLP_ENDPOINT` is not set
2. `injectHorizonTraceHeaders` injects `traceparent` into a headers object
3. `traceHorizonRequest` creates a span with the correct attributes
4. W3C `traceparent` format validation (`00-traceId-spanId-flags`)
5. Silent fallback when there is no active span (`getCurrentTraceparent` returns `null`)
6. `traceStellarCall` with attribute forwarding
7. Header injection does not throw when tracing is disabled

Run just the Horizon tracing tests:

```bash
npm test tests/tracing/otel-w3c-traceparent-horizon.test.js
```

Run all tracing tests:

```bash
npm test tests/tracing/
```

### Integration testing with a local Jaeger collector

```bash
# Start Jaeger all-in-one (Docker required)
docker run -d --name jaeger \
  -e COLLECTOR_OTLP_ENABLED=true \
  -p 4318:4318 \
  -p 16686:16686 \
  jaegertracing/all-in-one:latest

# Start the API with tracing enabled
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
OTEL_SERVICE_NAME=stellar-donation-api \
npm start

# Open the Jaeger UI
open http://localhost:16686
```

---

## Adding Custom Spans

Any code in the service layer can create a custom span using `withSpan`:

```js
const { withSpan } = require('../utils/tracing');

async function myServiceMethod(input) {
  return withSpan('service.myMethod', { 'input.type': typeof input }, async (span) => {
    const result = await doHeavyWork(input);
    span.setAttribute('result.size', result.length);
    return result;
  });
}
```

Attributes should follow [OTel semantic conventions](https://opentelemetry.io/docs/specs/semconv/)
where applicable (e.g. `http.method`, `db.system`, `peer.service`).
