# API Key Usage Analytics

This feature provides visibility into how API keys are used across the platform.
It tracks per-endpoint calls, status codes, response latencies, and maintains a 30-day rolling window.

## Endpoints

- `GET /api-keys/:id/analytics`
  - Returns per-endpoint metrics for the requested API key.
  - Includes call counts, error counts, error rates, status code breakdowns, average latency, and daily buckets.
  - Owners can only access analytics for their own API key.
  - Admins can access any API key.

- `GET /api-keys/:id/analytics/summary`
  - Returns total call count, error count, error rate, and latency percentiles (`p50`, `p95`, `p99`).
  - Uses the last 30 days of retained data by default.

- `GET /admin/analytics/top-endpoints`
  - Returns the top 10 most-called endpoints across all API keys.
  - Requires admin role.

## Data retention

- Usage records are stored in-memory and automatically purged after 30 days.
- All analytics computations are performed against the retained 30-day window.

## Implementation details

- `ApiKeyUsageService` records raw usage events with `timestamp`, `latencyMs`, `statusCode`, `path`, and `method`.
- Per-endpoint analytics aggregates by `path` + `method` and computes:
  - total calls
  - error counts and percentages
  - status code breakdown
  - average latency
  - daily bucket breakdown for the requested range
- Summary analytics computes latency percentiles from retained [`latencyMs`] values.
- Top endpoints are aggregated across all keys and sorted by call volume.

## Access control

- Owners may query their own API key analytics only.
- Admin users may query any API key analytics.
- Admin-only endpoints enforce `requireAdmin()` authorization.
