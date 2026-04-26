# Bugfix Requirements Document

## Introduction

The `GET /health` endpoint runs all dependency checks (database, Stellar, idempotency) in parallel,
each with a 2-second timeout (`DEPENDENCY_TIMEOUT_MS = 2000` in `HealthCheckService.js`). When the
Stellar network is slow or unreachable, the check waits the full 2 seconds before timing out, causing
the health endpoint itself to take 2+ seconds to respond. Load balancers typically have health check
timeouts of 1–2 seconds, so this can trigger false health failures and unnecessary instance restarts.

The fix reduces the dependency check timeout to 500ms and enforces per-endpoint response time budgets:
`GET /health` ≤ 500ms, `GET /health/live` ≤ 50ms, `GET /health/ready` ≤ 1000ms.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN any dependency check (Stellar, database, idempotency) takes longer than 2000ms THEN the system waits the full 2000ms before the check times out

1.2 WHEN the Stellar network is slow or unreachable THEN the system takes 2000ms+ to respond to `GET /health`, exceeding typical load balancer health check timeouts of 1–2 seconds

1.3 WHEN `GET /health` is called under slow dependency conditions THEN the system responds in 2000ms or more, risking false health failures from load balancers

### Expected Behavior (Correct)

2.1 WHEN any dependency check takes longer than 500ms THEN the system SHALL time out that check at 500ms and mark it as unhealthy

2.2 WHEN the Stellar network is slow or unreachable THEN the system SHALL respond to `GET /health` within 500ms total

2.3 WHEN `GET /health` is called under any dependency condition THEN the system SHALL respond within 500ms

2.4 WHEN `GET /health/live` is called THEN the system SHALL respond within 50ms (no external dependency checks)

2.5 WHEN `GET /health/ready` is called THEN the system SHALL respond within 1000ms

### Unchanged Behavior (Regression Prevention)

3.1 WHEN all dependencies are healthy and respond quickly THEN the system SHALL CONTINUE TO return `status: "healthy"` with HTTP 200

3.2 WHEN the database is unhealthy THEN the system SHALL CONTINUE TO return `status: "unhealthy"` with HTTP 503

3.3 WHEN the Stellar dependency is unhealthy THEN the system SHALL CONTINUE TO return `status: "unhealthy"` with HTTP 503

3.4 WHEN the idempotency dependency is unhealthy THEN the system SHALL CONTINUE TO return `status: "degraded"` with HTTP 503

3.5 WHEN `GET /health/live` is called THEN the system SHALL CONTINUE TO return `status: "alive"` with HTTP 200 regardless of dependency state

3.6 WHEN `GET /health/ready` is called with all dependencies healthy THEN the system SHALL CONTINUE TO return `ready: true` with HTTP 200

3.7 WHEN `GET /health/ready` is called with unhealthy dependencies THEN the system SHALL CONTINUE TO return `ready: false` with HTTP 503
