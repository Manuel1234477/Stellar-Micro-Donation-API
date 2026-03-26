# Prometheus Metrics Endpoint

## Overview

`GET /metrics` exposes operational metrics in [Prometheus exposition format](https://prometheus.io/docs/instrumenting/exposition_formats/). Compatible with Prometheus, Grafana, Datadog, and any OpenMetrics-compatible scraper.

## Endpoint

```
GET /metrics
X-API-Key: <admin-key>
```

Requires an API key with `admin` role. Returns `403` for non-admin keys and `401` for missing keys.

## Metrics Exposed

### `http_request_duration_seconds` (histogram)
Request latency for all HTTP endpoints.

Labels:
- `method` — HTTP verb (`GET`, `POST`, `PATCH`, …)
- `route` — normalised path (numeric segments replaced with `:id`, e.g. `/donations/:id`)
- `status_code` — HTTP response status (`200`, `404`, `500`, …)

Buckets: `0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5` seconds

### `stellar_donations_total` (counter)
Cumulative count of Stellar donation operations.

Labels:
- `status` — `sent` | `failed` | `pending`

### Default Node.js metrics
`prom-client`'s `collectDefaultMetrics` adds process and Node.js runtime metrics: memory usage, CPU time, event loop lag, active handles, GC stats, etc.

## Sample Output

```
# HELP http_request_duration_seconds Duration of HTTP requests in seconds
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{le="0.005",method="POST",route="/donations",status_code="201"} 3
...
http_request_duration_seconds_sum{method="POST",route="/donations",status_code="201"} 0.042
http_request_duration_seconds_count{method="POST",route="/donations",status_code="201"} 3

# HELP stellar_donations_total Total number of Stellar donation operations
# TYPE stellar_donations_total counter
stellar_donations_total{status="sent"} 12
stellar_donations_total{status="failed"} 1
stellar_donations_total{status="pending"} 0
```

## Recording Stellar Operations

Use `recordDonation(status)` from `src/utils/metrics.js` in service code:

```js
const { recordDonation } = require('../utils/metrics');

// After a successful Stellar payment:
recordDonation('sent');

// On failure:
recordDonation('failed');
```

## Security

- Endpoint requires `admin` role — non-admin keys receive `403`
- Route labels use normalised paths — no user IDs, wallet addresses, or other PII appear in label values
- Metric names and label values contain no sensitive data

## Prometheus Scrape Config

```yaml
scrape_configs:
  - job_name: stellar-api
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: /metrics
    scheme: http
    params: {}
    # Pass admin API key via Authorization header or custom header
    # (configure in Prometheus bearer_token or basic_auth as appropriate)
```

## Implementation

- `src/utils/metrics.js` — registry, metric definitions, `metricsMiddleware`, `recordDonation`
- `src/routes/app.js` — mounts `metricsMiddleware` globally and registers `GET /metrics`
