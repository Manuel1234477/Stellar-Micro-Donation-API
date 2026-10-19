# Service Level Objectives (SLOs)

## Overview

This document defines the Service Level Objectives (SLOs) for the Stellar Micro Donation API. SLOs establish measurable targets for system reliability and performance across critical surfaces.

**Issue #1225**: Define SLOs and alerting rules for key endpoints and jobs

## Critical Surfaces

### 1. API Availability (HTTP Endpoints)

**Definition**: Percentage of successful HTTP responses (status 2xx/3xx) excluding health checks.

**SLO Target**: 99.5% (4 hours 38 minutes downtime per month)

**Measurement**:
- Metric: `http_requests_total` (labeled by route, status_code)
- Formula: `(requests_2xx + requests_3xx) / total_requests`
- Interval: 5-minute buckets, evaluated every 30 seconds

**Critical Endpoints**:
- `POST /api/v1/donations` - donation submission
- `GET /api/v1/donations/:id` - donation retrieval
- `GET /api/v1/leaderboard` - leaderboard aggregation
- `POST /recurring-donations` - recurring schedule creation
- `GET /health/ready` - readiness probe

**Alert Threshold**: < 99% over 5-minute window

### 2. API Latency (P95/P99)

**Definition**: The 95th and 99th percentile response times for API requests.

**SLO Targets**:
- P95: ≤ 200ms (95% of requests complete within 200ms)
- P99: ≤ 1s (99% of requests complete within 1 second)

**Measurement**:
- Metric: `http_request_duration_seconds` (histogram with buckets)
- Buckets: 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5
- Calculated using quantile approximation

**Alert Thresholds**:
- P95 latency > 300ms for 5 minutes
- P99 latency > 2s for 5 minutes

**Endpoint-Specific Targets**:
- `GET /api/v1/donations` (list-donations): P95 ≤ 50ms, verified by the nightly load test (`tests/load/PerformanceBaselines.js`, `NIGHTLY_TARGET_BASELINES`). See `docs/LOAD_TESTING.md` for how to reproduce with `npm run test:load`.
- The list-donations target must be met for 7 consecutive nightly runs to be considered satisfied (Issue #1796). A regression is flagged when p95 exceeds the 50ms baseline by any margin; the 2026-09-05 regression to ~73ms (+46%) is the reference case.
- The default list query must use an index in its `EXPLAIN QUERY PLAN` output; before/after measurements are recorded in `PERFORMANCE_AUDIT.md`.

### 3. API Error Rate

**Definition**: Percentage of HTTP responses with error status codes (5xx).

**SLO Target**: < 0.5% error rate

**Measurement**:
- Metric: `http_requests_total` (labeled by status_code)
- Formula: `requests_5xx / total_requests`
- Interval: 5-minute buckets

**Alert Threshold**: > 1% error rate over 5 minutes

### 4. Recurring Donation Scheduler Lag

**Definition**: How far behind the scheduler is from the current time (how stale pending schedules are).

**SLO Target**: 
- Normal: ≤ 1 minute lag (scheduler processes schedules within 1 minute of due time)
- Warning: ≤ 5 minutes lag (degraded but acceptable)
- Critical: > 5 minutes lag (scheduler is backed up)

**Measurement**:
- Metric: `stellar_scheduler_lag_seconds` (gauge)
- Calculation: `current_timestamp - oldest_due_schedule_timestamp`
- Updated on each scheduler tick

**Components Tracked**:
- Recurring donation scheduler
- Transaction sync scheduler

**Alert Thresholds**:
- Warning: scheduler_lag > 60 seconds for 5 minutes
- Critical: scheduler_lag > 300 seconds for 2 minutes

### 5. Background Job Success Rate

**Definition**: Percentage of background jobs that complete successfully.

**SLO Targets**:
- Recurring donations: 99% completion rate
- Transaction sync: 99% completion rate
- Audit log cleanup: 100% (critical for compliance)

**Measurement**:
- Metric: `stellar_recurring_donations_executed_total` (labeled by status)
- Metric: `stellar_transaction_sync_total` (labeled by status)
- Formula: `success_count / (success_count + failure_count)`
- Interval: 1-hour buckets

**Alert Thresholds**:
- Recurring donations: < 98% success over 1 hour
- Transaction sync: < 98% success over 1 hour
- Audit cleanup: failure detected immediately

### 6. Database Pool Exhaustion

**Definition**: Percentage of database connection pool usage.

**SLO Target**: < 80% utilization under normal load

**Measurement**:
- Metric: `sqlite_pool_connections_in_use` (gauge)
- Metric: `sqlite_pool_size` (gauge)
- Formula: `connections_in_use / pool_size * 100`

**Alert Thresholds**:
- Warning: > 70% utilization for 2 minutes
- Critical: > 90% utilization (connections may be exhausted)

### 7. Horizon API Pool Health

**Definition**: Availability and responsiveness of Horizon API connection pool.

**SLO Target**: 99% success rate for Horizon API calls

**Measurement**:
- Metric: `horizon_requests_total` (labeled by status)
- Formula: `(2xx + 3xx) / total_requests`
- Interval: 5-minute buckets

**Alert Threshold**: < 95% success over 5 minutes

## Alert Rules

See `monitoring/prometheus-alerts.yml` for Prometheus alert rule definitions.

Each alert includes:
- Clear description of the condition
- Remediation steps (link to runbook)
- Severity level (warning/critical)
- Duration threshold before firing
- Recommended actions

## Incident Response

When an SLO is breached:

1. **Immediate**: Alert fires and notifies on-call engineer
2. **Within 5 minutes**: Incident commander acknowledges
3. **Within 15 minutes**: Root cause analysis begins
4. **Documentation**: Incident is logged with:
   - When SLO was breached
   - Which metric(s) were affected
   - Duration of breach
   - Root cause
   - Remediation taken
   - Prevention measures for future

## Monitoring Infrastructure

### Prometheus Configuration

Prometheus scrapes metrics from `/metrics` endpoint every 15 seconds:

```
scrape_configs:
  - job_name: 'stellar-donation-api'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/metrics'
    scrape_interval: 15s
    scrape_timeout: 10s
```

### Metrics Endpoint

All metrics are exported via `/metrics` in Prometheus text format.

Access via:
```bash
curl http://localhost:3000/metrics
```

### Alerting

Prometheus alert manager forwards alerts to:
- Slack (for team notification)
- PagerDuty (for on-call escalation)
- Email (for audit trail)

## Reviewing SLOs

SLOs should be reviewed quarterly:
- Are targets realistic and achievable?
- Have operational patterns changed?
- Are there new critical surfaces to track?
- Can SLOs be tightened (show improvement)?

## Implementation Checklist

- [x] Define SLOs for each critical surface
- [x] Implement Prometheus metrics collection
- [x] Create alert rules in Prometheus format
- [x] Test alerts in staging environment
- [x] Document runbook procedures for each alert
- [x] Train team on SLO expectations
- [x] Set up notification channels (Slack, PagerDuty, email)
- [x] Establish review cadence (quarterly)
- [ ] Integrate with incident management system
- [ ] Create SLO dashboards for visibility

## References

- [Prometheus Alerting](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/)
- [Google SRE Book - SLOs](https://sre.google/books/)
- [MetricFire - SLO Best Practices](https://www.metricfire.com/)

## Contact

- **Owner**: Platform Team
- **Escalation**: On-call engineer (PagerDuty)
- **Questions**: #platform-eng Slack channel
