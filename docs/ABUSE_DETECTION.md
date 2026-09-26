# Abuse Detection

Abuse detection is implemented as a single service with pluggable detectors and a
single middleware entry point. This document describes the consolidated model.

## Architecture

- **`src/services/AbuseDetectionService.js`** — the one abuse-detection service.
  It owns the detector registry and runs every registered detector against an
  incoming request. Detectors are pluggable: each one implements a common
  interface and can be enabled, disabled, or tuned independently.
- **`src/middleware/abuseDetection.js`** — the one middleware entry point. It
  adapts an Express request into the shape the service expects, calls the
  service, and translates the service result into an HTTP response (or passes
  the request through).

There is no longer a separate `src/utils/abuseDetector.js` implementation, nor
separate `suspiciousPatternDetection.js` / `suspiciousPatternDetector.js`
modules. Their logic lives in the detectors below.

## Detectors

The service ships with four pluggable detectors:

| Detector   | Responsibility                                                        |
| ---------- | --------------------------------------------------------------------- |
| `rate`     | Request-rate limits per identity (IP, user, API key).                 |
| `pattern`  | Suspicious request patterns (paths, payload shapes, header anomalies).|
| `velocity` | Short-window bursts and acceleration of requests.                     |
| `anomaly`  | Statistical deviation from a baseline (via `AnomalyDetectionService`).|

Each detector returns a normalized result:

```js
{
  detector: 'rate',
  triggered: true,
  score: 0.8,
  reason: 'rate limit exceeded',
  metadata: { /* detector-specific */ }
}
```

The service aggregates detector results into a single decision. Thresholds are
configured in one place (the service configuration) so tuning a limit applies
to every detector that uses it.

## Shared state

Detector state (counters, windows, velocity buckets, pattern history) is stored
in the shared rate-limit store:

- When Redis is configured, the store is Redis-backed, so state is shared across
  all application instances. Abuse detection cannot be evaded by hitting a
  different pod.
- When Redis is not configured, the store falls back to an in-process store.
  This is suitable for local development and single-instance deployments only.

No detector keeps its own private in-memory `Map` for cross-request state.

## Middleware usage

```js
const abuseDetection = require('../middleware/abuseDetection');

app.use(abuseDetection());
```

The middleware is the only entry point. It delegates to
`AbuseDetectionService`, which runs the registered detectors and returns the
aggregated decision.

## Configuration

All thresholds and detector toggles are read from the service configuration
(environment variables / config module). Because there is one service and one
store, a threshold changed in configuration takes effect everywhere.

## Adding a detector

1. Implement the detector interface (`name`, `detect(context)`).
2. Register it with `AbuseDetectionService`.
3. Read any state through the shared store, never a module-local `Map`.

## References

- `src/services/AbuseDetectionService.js`
- `src/middleware/abuseDetection.js`
- `src/services/AnomalyDetectionService.js`
