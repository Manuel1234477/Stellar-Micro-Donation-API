# Monitoring Setup Guide

## Overview

This guide explains how to set up comprehensive monitoring for the Stellar Micro Donation API using Prometheus, Grafana, and alerting.

**Issue #1225**: Define SLOs and alerting rules for key endpoints and jobs

## Architecture

```
┌─────────────────────┐
│  Application        │
│  (localhost:3000)   │
│  /metrics endpoint  │
└──────────┬──────────┘
           │
           │ scrapes /metrics (15s interval)
           │
           ▼
┌─────────────────────┐     ┌──────────────┐
│  Prometheus         │────▶│  AlertManager│
│  (9090)             │     │  (9093)      │
│  Rule Evaluation    │     └──────┬───────┘
│  (30s interval)     │            │
└─────────┬───────────┘            │ notifications
          │                        │
          │ queries                ▼
          │             ┌──────────────────┐
          ▼             │ Notification     │
┌─────────────────────┐ │ Channels:        │
│  Grafana            │ │ - Slack          │
│  (3000)             │ │ - PagerDuty      │
│  Dashboards         │ │ - Email          │
└─────────────────────┘ └──────────────────┘
```

## Step 1: Install Prometheus

### Option A: Docker

```bash
docker run -d \
  --name prometheus \
  -p 9090:9090 \
  -v $(pwd)/monitoring/prometheus.yml:/etc/prometheus/prometheus.yml \
  -v $(pwd)/monitoring/prometheus-alerts.yml:/etc/prometheus/prometheus-alerts.yml \
  prom/prometheus:latest
```

### Option B: System Package

```bash
# On macOS
brew install prometheus

# On Linux (Ubuntu/Debian)
sudo apt-get install prometheus
```

## Step 2: Configure Prometheus

Create `monitoring/prometheus.yml`:

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 30s
  external_labels:
    monitor: 'stellar-donation-api'

rule_files:
  - 'prometheus-alerts.yml'

alerting:
  alertmanagers:
    - static_configs:
        - targets:
            - localhost:9093

scrape_configs:
  - job_name: 'stellar-donation-api'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/metrics'
    scrape_interval: 15s
    scrape_timeout: 10s

  # Scrape Prometheus itself
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']
```

## Step 3: Start Application with Metrics

The application exports metrics at `/metrics` endpoint automatically via prom-client.

Verify metrics are exported:

```bash
curl -H "x-api-key: $METRICS_API_KEY" http://localhost:3000/metrics | head -20
```

### Scrape authentication (#1982)

`/metrics` requires the `metrics:read` permission. Do not give Prometheus an admin key.
Create a dedicated scrape-only key with the `metrics` role, which grants `metrics:read` and nothing else:

```bash
npm run keys -- create --role metrics --name prometheus-scraper
```

A `metrics` key can scrape `/metrics` and is refused (403) by every other endpoint.
Admin keys still work because the admin role holds the `*` permission.

For Kubernetes-style deployments you can instead serve metrics on a second port that needs no application auth:

```bash
METRICS_PORT=9100            # 0 (default) disables the separate listener
METRICS_HOST=0.0.0.0         # default; bind address inside the pod
```

The separate listener only answers `GET /metrics` (everything else returns 404). Expose it only on the pod or cluster network, never through a public Service or Ingress. The main port keeps `/metrics` behind `metrics:read` either way.

Prometheus scrape config for the scrape-only key:

```yaml
  - job_name: 'stellar-donation-api'
    metrics_path: '/metrics'
    static_configs:
      - targets: ['localhost:3000']
    http_headers:
      x-api-key:
        files: ['/etc/prometheus/secrets/metrics-api-key']   # Prometheus >= 2.44
```

Or, with the separate port:

```yaml
  - job_name: 'stellar-donation-api'
    static_configs:
      - targets: ['stellar-api-pod:9100']
```

New stream gauges and counters for capacity planning:

- `stream_connections_active{transport="sse"|"ws_balances"|"ws_graphql"}`: open long-lived streams per instance
- `stream_connections_rejected_total{transport=...}`: connections refused by a global cap (`SSE_MAX_CONNECTIONS`, `WS_MAX_CONNECTIONS`)
- `stellar_mode{mode="mock"|"testnet"|"public"}`: active Stellar mode (the active label is 1)

Expected output:
```
# HELP http_request_duration_seconds Duration of HTTP requests in seconds
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{method="GET",route="/api/v1/donations",status_code="200",le="0.005"} 0
...
```

## Step 4: Install AlertManager

### Docker

```bash
docker run -d \
  --name alertmanager \
  -p 9093:9093 \
  -v $(pwd)/monitoring/alertmanager.yml:/etc/alertmanager/alertmanager.yml \
  prom/alertmanager:latest
```

### Configuration Example

Create `monitoring/alertmanager.yml`:

```yaml
global:
  resolve_timeout: 5m

route:
  # Default grouping
  receiver: 'team-slack'
  group_by: ['alertname', 'cluster', 'service']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h

  # Critical alerts escalate to PagerDuty
  routes:
    - match:
        severity: critical
      receiver: 'pagerduty'
      group_wait: 10s
      repeat_interval: 1h

receivers:
  - name: 'team-slack'
    slack_configs:
      - api_url: 'YOUR_SLACK_WEBHOOK_URL'
        channel: '#alerts-stellar-api'
        title: '{{ .GroupLabels.alertname }}'
        text: '{{ range .Alerts }}{{ .Annotations.description }}{{ end }}'

  - name: 'pagerduty'
    pagerduty_configs:
      - service_key: 'YOUR_PAGERDUTY_SERVICE_KEY'
        description: '{{ .GroupLabels.alertname }}: {{ .Alerts.Firing | len }} firing'
```

## Step 5: Install Grafana

### Docker

```bash
docker run -d \
  --name grafana \
  -p 3000:3000 \
  -e GF_SECURITY_ADMIN_PASSWORD=admin \
  grafana/grafana:latest
```

### Access

- URL: http://localhost:3000
- Default username/password: admin/admin

### Create Data Source

1. Go to Configuration → Data Sources
2. Add Prometheus data source
3. URL: http://prometheus:9090
4. Save & Test

### Import Dashboard

1. Go to Dashboards → Import
2. Upload `monitoring/grafana-dashboard.json`

Or create manually with panels showing:
- Request rate (RPS)
- Error rate
- P95/P99 latency
- Scheduler lag
- Database pool usage
- Memory usage

## Step 6: Metrics to Monitor

### HTTP Requests

```promql
# Request rate (requests per second)
sum(rate(http_requests_total[5m])) by (instance)

# Error rate
sum(rate(http_requests_total{status=~"5.."}[5m])) /
sum(rate(http_requests_total[5m]))

# P95 latency
histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))

# P99 latency
histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))

# By route
sum(rate(http_request_duration_seconds_bucket[5m])) by (route)
```

### Recurring Donations

```promql
# Execution success rate
sum(rate(stellar_recurring_donations_executed_total{status="success"}[1h])) /
(
  sum(rate(stellar_recurring_donations_executed_total{status="success"}[1h])) +
  sum(rate(stellar_recurring_donations_executed_total{status="failure"}[1h]))
)

# Scheduler lag
stellar_scheduler_lag_seconds

# Active schedules
stellar_recurring_donations_active_count
```

### Database

```promql
# Connection pool usage
sqlite_pool_connections_in_use / sqlite_pool_size * 100

# Query duration
histogram_quantile(0.95, rate(sqlite_query_duration_seconds_bucket[5m]))
```

### Node.js Runtime

```promql
# Heap usage
process_resident_memory_bytes / nodejs_heap_size_limit_bytes * 100

# Event loop lag
nodejs_eventloop_lag_seconds

# GC pause time
nodejs_gc_duration_seconds
```

## Step 7: Alert Testing

### Fire a test alert

```bash
# Make 1000 requests to trigger error rate alert
for i in {1..1000}; do
  curl -s http://localhost:3000/api/v1/donations/invalid 2>/dev/null &
done
```

Wait 5-10 minutes for alert to fire (based on `for:` duration in alert rule).

### Check alert status

Navigate to http://localhost:9090/alerts

Should show firing alerts with:
- Alert name
- Current value
- Labels
- Annotations (description)

### View in AlertManager

Navigate to http://localhost:9093

Shows:
- Firing alerts
- Grouped alerts
- Receiver configuration

## Step 8: Dashboards

Key dashboards to create:

### 1. SLO Overview
- API Availability (%)
- Error Rate (%)
- P95 Latency (ms)
- P99 Latency (ms)

### 2. Request Performance
- Request Rate (RPS)
- Success Rate (%)
- Error Rate (%)
- Latency Percentiles (p50, p95, p99)
- Top 10 Slowest Routes

### 3. Background Jobs
- Recurring Donation Success Rate (%)
- Scheduler Lag (seconds)
- Active Schedules (count)
- Execution Failures (count)

### 4. Resource Usage
- Memory Usage (%)
- Database Connection Pool (%)
- CPU Usage (%)
- Event Loop Lag (ms)

### 5. External Dependencies
- Horizon API Success Rate (%)
- Horizon API Latency (ms)
- Network Error Rate (%)

## Troubleshooting

### Metrics not appearing

1. Check application is running: `curl http://localhost:3000/health`
2. Verify metrics endpoint: `curl http://localhost:3000/metrics`
3. Check Prometheus scrape config: http://localhost:9090/config
4. Check targets: http://localhost:9090/targets

### Alerts not firing

1. Check Prometheus rules: http://localhost:9090/rules
2. Verify metric is being collected
3. Check alert's `for:` duration
4. Review AlertManager receiver config

### Data gaps in Prometheus

1. Check Prometheus uptime: http://localhost:9090/status
2. Review Prometheus logs
3. Verify disk space: `df -h /prometheus-data`

## Production Deployment

For production, use:

- Prometheus with persistent volume
- AlertManager with high availability
- Grafana with proper authentication
- Secure webhook URLs for notifications
- Regular backups of Prometheus data
- Alert rule versioning in git

## SLOs Quick Reference

| Surface | Target | Alert Threshold |
|---------|--------|-----------------|
| Availability | 99.5% | < 99% |
| Error Rate | < 0.5% | > 1% |
| P95 Latency | ≤ 200ms | > 300ms |
| P99 Latency | ≤ 1s | > 2s |
| Scheduler Lag | ≤ 1min | > 60s |
| Job Success | 99% | < 98% |
| DB Pool | < 80% | > 70% |

## Next Steps

1. [ ] Deploy Prometheus and AlertManager
2. [ ] Configure Grafana dashboards
3. [ ] Set up notification channels (Slack, PagerDuty)
4. [ ] Test alert rules in staging
5. [ ] Create runbooks for each alert
6. [ ] Train team on SLO expectations
7. [ ] Enable persistent Prometheus storage

## References

- [Prometheus Documentation](https://prometheus.io/docs/)
- [AlertManager Configuration](https://prometheus.io/docs/alerting/latest/configuration/)
- [Grafana Getting Started](https://grafana.com/docs/grafana/latest/getting-started/)
- [SLOs Documentation](./SLOs.md)
