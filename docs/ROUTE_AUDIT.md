# Route Audit — `/network` Router

**File:** `src/routes/network.js`  
**Mounted at:** `/api/v1/network` (versioned) and `/network` (legacy redirect → 308)  
**Last audited:** 2026-04-27

---

## Registered Routes

| Method | Path | Handler | Auth | Cache | Description |
|--------|------|---------|------|-------|-------------|
| GET | `/network/status` | `router.get('/status')` | None (public) | `public, max-age=30` | Current Stellar network health snapshot (status, baseFee, latency) |
| GET | `/network/status/history` | `router.get('/status/history')` | None (public) | None | Status snapshots from the last 24 hours |
| GET | `/network/fees` | `router.get('/fees')` | None (public) | `public, max-age=30` | Current fee statistics (baseFeeStroops, feeLevel, feeSurgeMultiplier) |
| GET | `/network/ledger` | `router.get('/ledger')` | None (public) | `public, max-age=30` | Latest ledger info (ledgerCloseTimeSeconds, latencyMs, connected) |
| GET | `/network/metrics` | `router.get('/metrics')` | None (public) | `no-store` | Prometheus-style numeric metrics for monitoring dashboards |
| ANY | `/network/*` (catch-all) | `router.use(...)` | — | — | Returns 404 with `hint` field listing valid sub-paths |

---

## Data Source

All routes read from `NetworkStatusService` (injected via `setService()`).  
The service polls Horizon every 30 seconds and caches the latest snapshot in memory.  
If the service has not been injected, all routes return **503**.

---

## 404 Hint Behaviour

Any request to an unregistered `/network/*` path returns:

```json
{
  "success": false,
  "error": {
    "code": "ROUTE_NOT_FOUND",
    "message": "No network route matches GET /network/unknown",
    "hint": "Valid sub-paths: /status, /status/history, /fees, /ledger, /metrics"
  }
}
```

---

## Audit Notes

- All routes are **publicly accessible** — no API key required.
- `/network/metrics` sets `Cache-Control: no-store` to ensure monitoring tools always receive fresh data.
- The legacy unversioned path `/network/*` is redirected (HTTP 308) to `/api/v1/network/*` by the deprecation middleware in `app.js`.
