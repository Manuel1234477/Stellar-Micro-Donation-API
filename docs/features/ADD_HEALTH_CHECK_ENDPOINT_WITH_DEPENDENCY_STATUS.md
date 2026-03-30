# Enhanced Health Check Endpoint with Dependency Status

## Overview

The `/health` endpoint has been upgraded from a simple status check to a full dependency-aware health report. Two additional endpoints — `/health/live` and `/health/ready` — support Kubernetes-style liveness and readiness probes.

All checks are bounded to **2 seconds** per dependency to prevent slow dependencies from blocking the response.

---

## Endpoints

### `GET /health`

Returns the overall health of the service and the status of each dependency.

**Response shape**

```json
{
  "status": "healthy" | "degraded" | "unhealthy",
  "dependencies": {
    "database": { "status": "healthy", "responseTime": 4 },
    "stellar":  { "status": "healthy", "responseTime": 12, "network": "testnet", "horizonUrl": "https://horizon-testnet.stellar.org" },
    "idempotency": { "status": "healthy", "responseTime": 3 }
  },
  "timestamp": "2026-03-23T14:00:00.000Z"
}
```

**Status rules**

| Condition | `status` | HTTP |
|---|---|---|
| All dependencies healthy | `healthy` | 200 |
| Database healthy, ≥1 non-critical dependency unhealthy | `degraded` | 200 |
| Database unhealthy | `unhealthy` | 503 |

---

### `GET /health/live`

Liveness probe. Returns `200` as long as the Node.js process is running. Never checks external dependencies.

```json
{ "status": "alive", "timestamp": "..." }
```

---

### `GET /health/ready`

Readiness probe. Returns `200` only when all dependencies are healthy (i.e., `status === "healthy"`). Returns `503` for `degraded` or `unhealthy`.

```json
{
  "ready": true,
  "status": "healthy",
  "dependencies": { ... },
  "timestamp": "..."
}
```

---

## Implementation

### `src/services/HealthCheckService.js`

Pure functions — no side effects, no singleton state.

| Export | Description |
|---|---|
| `checkDatabase()` | Runs `SELECT 1` against SQLite |
| `checkStellar(stellarService)` | Calls `server.root()` on real Horizon; no-op on MockStellarService |
| `checkIdempotency()` | Runs `SELECT COUNT(*)` on `idempotency_keys` table |
| `getFullHealth(stellarService)` | Runs all three checks in parallel, aggregates status |
| `getLiveness()` | Synchronous — returns `{ status: "alive" }` |
| `getReadiness(stellarService)` | Delegates to `getFullHealth`, adds `ready` boolean |
| `DEPENDENCY_TIMEOUT_MS` | `2000` — hard timeout per check |

Each check returns `{ status, responseTime, error? }`. Unhealthy checks include an `error` string.

### `src/routes/app.js`

The old inline health handler was replaced with three route handlers that delegate to `HealthCheckService`.

---

## Security

- No authentication required on health endpoints (standard practice for load balancer probes).
- Dependency error messages are included in the response but do not expose stack traces or internal paths.
- The `checkStellar` function only calls `server.root()` — a read-only metadata endpoint — so no credentials are involved.

---

## Testing

Test file: `tests/add-health-check-endpoint-with-dependency-status.test.js`

- 27 tests, 0 failures
- No live Stellar network required — uses `MockStellarService`
- Covers: healthy, degraded, unhealthy states; timeout simulation; liveness; readiness; unit tests for each service function

Run:
```bash
node node_modules/jest-cli/bin/jest.js tests/add-health-check-endpoint-with-dependency-status.test.js
```
