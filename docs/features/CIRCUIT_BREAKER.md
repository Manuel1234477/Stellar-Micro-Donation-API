# Circuit Breaker — Stellar Horizon API Protection

## Overview

When the Stellar Horizon API is unavailable or slow, the donation API would
otherwise exhaust its connection pool making requests that all fail. The circuit
breaker detects repeated failures and "opens" the circuit, returning fast 503
errors until Horizon recovers.

## States

```
          failures >= threshold
CLOSED ──────────────────────────► OPEN
  ▲                                  │
  │  probe succeeds        cooldown  │
  │◄──────────────── HALF_OPEN ◄─────┘
                          │
                          │ probe fails
                          └──────────► OPEN (reset cooldown)
```

| State | Behaviour |
|-------|-----------|
| **CLOSED** | Normal operation. Failures are counted in a sliding window. |
| **OPEN** | All calls fail immediately with HTTP 503. No Horizon requests are made. |
| **HALF_OPEN** | Exactly one probe request is allowed. Success → CLOSED; failure → OPEN. |

## Configuration

Defaults are set in `StellarService` constructor and can be overridden via
`config`:

| Option | Default | Description |
|--------|---------|-------------|
| `circuitBreakerThreshold` | `5` | Failures within the window that open the circuit |
| `circuitBreakerWindowMs` | `60000` | Sliding window length (ms) |
| `circuitBreakerCooldownMs` | `30000` | Time before a half-open probe is attempted (ms) |

## Files Changed

| File | Change |
|------|--------|
| `src/utils/circuitBreaker.js` | New — `CircuitBreaker` class |
| `src/services/StellarService.js` | Wraps `_executeWithRetry` with the circuit breaker |
| `src/services/HealthCheckService.js` | Exposes `circuitBreaker` state in `checkStellar()` |
| `tests/circuit-breaker.test.js` | New — full state-transition test suite |

## Health Check

`GET /health` now includes circuit breaker state inside
`dependencies.stellar.circuitBreaker`:

```json
{
  "status": "degraded",
  "dependencies": {
    "stellar": {
      "status": "unhealthy",
      "circuitBreaker": {
        "state": "open",
        "failures": 5,
        "openedAt": "2026-03-27T09:45:00.000Z"
      }
    }
  }
}
```

## Security Assumptions

**Threshold tuning** — The default threshold of 5 failures in 60 s is
conservative. A very low threshold (e.g. 1) risks opening the circuit on
transient blips; a very high one delays protection. Tune
`circuitBreakerThreshold` and `circuitBreakerWindowMs` to match your observed
Horizon error rate in production.

**Half-open race condition** — Only one probe is allowed at a time. The
`_probeInFlight` flag is set synchronously before the async probe starts, so
concurrent callers that arrive while the probe is in-flight receive a 503
immediately. This is safe in a single-process Node.js event loop. In a
multi-process deployment (e.g. cluster mode) each worker maintains its own
circuit breaker instance; consider a shared Redis-backed state store if
cross-process coordination is required.

**No secret exposure** — The circuit breaker state returned in the health check
contains only timing and counter data; no credentials or internal stack traces
are leaked.
