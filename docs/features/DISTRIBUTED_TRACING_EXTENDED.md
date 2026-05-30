# Distributed Tracing (Extended)

## Overview

Full distributed tracing across async operations using OpenTelemetry, with an in-memory trace store for debugging.

## What's Traced

| Component | Span Name |
|---|---|
| HTTP requests | `GET /path`, `POST /path`, … |
| Scheduler jobs | `scheduler.processSchedules` |
| Webhook delivery | outbound `traceparent` header injected |
| Database queries | `db.<operation> <table>` |
| Stellar calls | `stellar.<operation>` |

## In-Memory Trace Store

The last **1,000 traces** are kept in memory. Each trace holds all spans recorded during its lifetime.

```js
const { recordSpan, getTrace, getTraceCount } = require('./src/utils/tracing');

// Record a custom span
recordSpan(traceId, { name: 'my.operation', status: 'ok' });

// Retrieve a trace
const trace = getTrace(traceId);
// { traceId, startedAt, spans: [{ name, spanId, status, recordedAt }, ...] }
```

## Context Propagation

### Scheduler

`RecurringDonationScheduler.processSchedules()` extracts the active W3C `traceparent` and runs the job body inside `withSpanInContext`, linking all child spans to the same trace.

### Webhook Delivery

`WebhookService.sendFailureNotification()` calls `injectTraceHeaders()` before making the outbound HTTP request, propagating the `traceparent` header to the receiving service.

## API Endpoint

### `GET /admin/traces/:traceId`

Retrieve a stored trace by its W3C trace ID. Requires admin API key.

**Response (found)**
```json
{
  "success": true,
  "data": {
    "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
    "startedAt": "2026-03-29T22:00:00.000Z",
    "spans": [
      { "name": "scheduler.processSchedules", "status": "ok", "recordedAt": "..." }
    ]
  }
}
```

**Response (not found)**
```json
{ "success": false, "error": { "message": "Trace not found", "code": "TRACE_NOT_FOUND" } }
```

### `GET /admin/traces`

Returns the count of currently stored traces.
