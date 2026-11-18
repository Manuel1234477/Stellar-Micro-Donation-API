# Operations Runbooks

> **Purpose:** Step-by-step remediation guides linked directly from Prometheus alert annotations.  
> Keep this document open during an active incident — it is written to be skimmed under pressure.  
> For a broader incident-response framework (severity levels, post-incident checklist, general workflow) see [INCIDENT_RUNBOOK.md](INCIDENT_RUNBOOK.md).

---

## Table of Contents

- [API Availability](#api-availability)
- [API Error Rate](#api-error-rate)
- [API Latency](#api-latency)
- [Scheduler Lag](#scheduler-lag)
- [Scheduler Lag — Critical](#scheduler-lag-critical)
- [Recurring Donation Failure](#recurring-donation-failure)
- [Horizon Connectivity](#horizon-connectivity)
- [Transaction Sync Lag](#transaction-sync-lag)
- [Application Down](#application-down)
- [High Memory](#high-memory)
- [Event Loop Lag](#event-loop-lag)

---

## api-availability

**Alert:** `APIAvailabilityBelowSLO`  
**Severity:** critical  
**Threshold:** HTTP success rate (2xx + 3xx) < 99% over 5 minutes

### What it means

A significant fraction of incoming HTTP requests are failing. Users are receiving errors for operations that should succeed.

### Diagnosis

```bash
# 1. Check API logs for error patterns
grep -E "ERROR|WARN" /var/log/api.log | tail -50

# 2. Review recent deployments
git log --oneline -10

# 3. Check overall health
curl -sf http://localhost:3000/health | jq .

# 4. Per-route error breakdown (Prometheus query)
# sum by (route, status_code) (rate(http_request_duration_seconds_count{status_code=~"[45].."}[5m]))
```

### Remediation

| Symptom | Action |
|---------|--------|
| Crash loop / process exited | `pm2 restart api` or restart the container |
| Database errors (`SQLITE_BUSY`, `no such table`) | See [db-pool](#db-pool) / run `npm run migrate` |
| Stellar network errors on donation endpoints | See [horizon-connectivity](#horizon-connectivity) |
| New deployment rolled out recently | Roll back: `git revert HEAD && npm run deploy` |
| Rate-limit false positives | Increase `RATE_LIMIT` in `.env` and restart |

### Recovery confirmation

```bash
# Success rate should return above 99%
curl -sf http://localhost:3000/health | jq .status
# Should return: "ok"
```

---

## api-error-rate

**Alert:** `APIErrorRateAboveSLO`  
**Severity:** critical  
**Threshold:** HTTP 5xx error rate > 1% over 5 minutes

### What it means

The application is returning server errors to clients at a rate above the SLO threshold. This is usually caused by unhandled exceptions, dependency failures, or resource exhaustion.

### Diagnosis

```bash
# 1. Check for stack traces in logs
grep -A 5 "UnhandledPromiseRejection\|Error:" /var/log/api.log | tail -100

# 2. Check if a specific route is responsible (Prometheus query)
# topk(5, sum by (route) (rate(http_request_duration_seconds_count{status_code=~"5.."}[5m])))

# 3. Check database health
curl -sf http://localhost:3000/health | jq .dependencies.database

# 4. Check Horizon connectivity
curl -sf http://localhost:3000/health | jq .dependencies.horizon
```

### Remediation

1. Identify the failing route from Prometheus or logs.
2. Check if the error is caused by a downstream dependency (database, Horizon).
3. If caused by a bad deployment, roll back immediately.
4. If an unhandled exception, add error handling and redeploy a fix.

### Recovery confirmation

```bash
# 5xx rate should drop to ~0
grep -c "HTTP 5" /var/log/api.log  # count should be decreasing
```

---

## api-latency

**Alerts:** `APIP95LatencyAboveSLO`, `APIP99LatencyAboveSLO`  
**Severity:** warning  
**Thresholds:** P95 > 300ms or P99 > 2s over 5 minutes

### What it means

Request latency is elevated. Clients experience slow responses. Can degrade into failures if requests time out.

### Diagnosis

```bash
# 1. Identify slowest routes (Prometheus query)
# topk(5,
#   histogram_quantile(0.95,
#     sum(rate(http_request_duration_seconds_bucket[5m])) by (le, route)
#   )
# )

# 2. Check memory and event loop
curl -sf http://localhost:3000/health | jq '{memory: .memory, uptime: .uptime}'

# 3. Check for slow database queries
grep "SLOW_QUERY" /var/log/api.log | tail -20

# 4. Check Horizon pool health
# horizon_pool_healthy_count / horizon_pool_size
```

### Remediation

| Likely cause | Action |
|-------------|--------|
| Slow database queries | Add indexes, check query plans (`EXPLAIN QUERY PLAN`) |
| Horizon API slow | See [horizon-connectivity](#horizon-connectivity) |
| Event loop blocked | See [event-loop-lag](#event-loop-lag) |
| Memory pressure | See [high-memory](#high-memory) |
| Traffic spike | Scale horizontally or increase `DB_POOL_SIZE` |

### Recovery confirmation

```bash
# P95 latency should return below 200ms in Prometheus
# histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))
```

---

## scheduler-lag

**Alert:** `SchedulerSkipRateWarning`  
**Severity:** warning  
**Threshold:** Recurring donation skip rate > 0.1/s sustained for 5 minutes

### What it means

The recurring donation scheduler is skipping scheduled executions. Donations are not being processed on time. The `reason` label on the `recurring_donations_skipped_total` metric indicates why:

| Reason | Meaning |
|--------|---------|
| `in_progress` | Duplicate-execution guard: a previous tick is still running |
| `network_degraded` | Stellar network health check failed; scheduler is backing off |
| `scheduler_paused` | Scheduler was explicitly paused (feature flag or admin action) |

### Diagnosis

```bash
# 1. Check scheduler logs
grep "RecurringDonationScheduler\|SCHEDULER" /var/log/api.log | tail -50

# 2. Check Stellar network health
curl -sf http://localhost:3000/health | jq .dependencies.horizon

# 3. Check skip reason breakdown (Prometheus query)
# sum by (reason) (rate(recurring_donations_skipped_total[5m]))

# 4. Check active schedule count
# stellar_recurring_donations_active_count
```

### Remediation

| Skip reason | Action |
|------------|--------|
| `network_degraded` | Wait for Horizon recovery; see [horizon-connectivity](#horizon-connectivity) |
| `in_progress` (persistent) | Previous tick is hung; restart the process |
| `scheduler_paused` | Check feature flags / admin settings; re-enable if safe |

### Recovery confirmation

```bash
# Skip rate should return to 0
# rate(recurring_donations_skipped_total[5m]) == 0
grep "SCHEDULER_TICK" /var/log/api.log | tail -5
# Look for: executionsAttempted > 0 and skipped == 0
```

---

## scheduler-lag-critical

**Alert:** `SchedulerSkipRateCritical`  
**Severity:** critical  
**Threshold:** Recurring donation skip rate > 0.5/s sustained for 2 minutes

### What it means

The recurring donation scheduler is severely impaired. A large number of donor schedules are not being processed. This is likely impacting users.

### Immediate actions (SEV-1 response)

1. **Page the on-call engineer immediately.**

2. **Check if the process is alive:**
   ```bash
   ps aux | grep -i node
   curl -sf http://localhost:3000/health || echo "HEALTH CHECK FAILED"
   ```

3. **Check for database connectivity:**
   ```bash
   curl -sf http://localhost:3000/health | jq .dependencies.database
   ```

4. **Tail recent logs:**
   ```bash
   tail -100 /var/log/api.log | grep -E "ERROR|WARN|SCHEDULER"
   ```

5. **If the scheduler is hung, restart the process:**
   ```bash
   pm2 restart api   # or docker restart <container>
   ```

6. **After restart, verify the scheduler resumes:**
   ```bash
   grep "SCHEDULER_TICK" /var/log/api.log | tail -5
   ```

### Recovery confirmation

- Skip rate drops back to 0 in Prometheus.
- Scheduler logs show `SCHEDULER_TICK` with `executionsAttempted > 0`.
- `GET /health` returns `"status": "ok"`.

---

## recurring-donation-failure

**Alerts:** `RecurringDonationSuccessRateLow`, `RecurringDonationSuspensionRateHigh`  
**Severity:** critical / warning  
**Thresholds:**
- Success rate < 98% over 1 hour
- Suspension rate > 0.01/s over 10 minutes

### What it means

Recurring donation executions are failing at a high rate (success rate alert), or schedules are being permanently suspended after exhausting all retries (suspension alert).

A suspended schedule means a donor's recurring donation has permanently stopped. Manual intervention or donor communication may be needed.

### Diagnosis

```bash
# 1. Check execution outcome breakdown (Prometheus query)
# sum by (status) (rate(stellar_recurring_donations_executed_total[1h]))

# 2. Check error logs
grep -E "RECURRING_DONATION.*(ERROR|FAILED|suspended)" /var/log/api.log | tail -50

# 3. Check Stellar network
curl -sf "$HORIZON_URL/fee_stats" | jq .

# 4. List suspended schedules
GET /stream/schedules?status=suspended

# 5. Check account balance
GET /wallets/<service-wallet-public-key>
```

### Remediation

| Root cause | Action |
|-----------|--------|
| Stellar network outage | Wait for network recovery; suspended schedules will NOT auto-resume |
| Insufficient account balance | Top up the service account balance |
| Invalid Horizon endpoint | Update `HORIZON_URL` in `.env` and restart |
| Permanent network failure | Manually reactivate affected schedules after network recovery |

**To manually reactivate a suspended schedule:**
```bash
PATCH /stream/schedules/:id
{ "status": "active" }
```

### Recovery confirmation

```bash
# Success rate should return above 99% (Prometheus)
# sum(rate(stellar_recurring_donations_executed_total{status="success"}[1h])) /
# sum(rate(stellar_recurring_donations_executed_total[1h]))

# Suspension rate should return to 0
# rate(stellar_recurring_donations_suspended_total[1h]) == 0
```

---

## horizon-connectivity

**Alerts:** `HorizonPoolDegraded`, `HorizonPoolExhausted`, `HorizonPoolCooldownRateHigh`  
**Severity:** warning / critical  
**Thresholds:**
- Degraded: > 50% of pool members unhealthy for 5 minutes
- Exhausted: 0 healthy pool members for 2 minutes
- Cooldown rate: > 0.1 cooldown events/s for 5 minutes

### What it means

The Horizon connection pool has members in cooldown, meaning those members recently returned errors. If all members are in cooldown (`HorizonPoolExhausted`), donation submissions to Stellar will fail until at least one member recovers.

### Diagnosis

```bash
# 1. Check the Stellar status page
# https://status.stellar.org

# 2. Test connectivity to Horizon directly
curl -sf "$HORIZON_URL/fee_stats" | jq .last_ledger

# 3. Check pool state (Prometheus queries)
# horizon_pool_healthy_count
# horizon_pool_unhealthy_count
# horizon_pool_size

# 4. Check cooldown event rate
# rate(horizon_pool_cooldown_events_total[5m])

# 5. Check application health endpoint
curl -sf http://localhost:3000/health | jq .dependencies.horizon
```

### Remediation

| Scenario | Action |
|---------|--------|
| Stellar network outage | Check https://status.stellar.org; pool members will auto-recover when Horizon is reachable |
| Network connectivity issue | Verify DNS and firewall rules to the Horizon hostname |
| Rate limiting from Stellar | Reduce request rate; check `HORIZON_URL` configuration |
| Misconfigured `HORIZON_URL` | Fix `HORIZON_URL` in `.env` and restart |
| All pool members exhausted | Enable mock mode temporarily: `MOCK_STELLAR=true` and restart |

**Enable mock mode during a Horizon outage:**
```bash
# In .env
MOCK_STELLAR=true
# Restart the server — no real transactions will be submitted
# Remember to disable mock mode after Horizon recovers
```

**Override Horizon endpoint:**
```bash
# In .env
HORIZON_URL=https://horizon.stellar.org          # mainnet fallback
HORIZON_URL=https://horizon-testnet.stellar.org  # testnet fallback
```

### Recovery confirmation

```bash
# All pool members should be healthy
# horizon_pool_healthy_count == horizon_pool_size

# Cooldown rate should drop to 0
# rate(horizon_pool_cooldown_events_total[5m]) == 0

# Health endpoint should show Horizon as healthy
curl -sf http://localhost:3000/health | jq .dependencies.horizon
```

---

## transaction-sync-lag

**Alert:** `HorizonPoolAcquireLatencyHigh`  
**Severity:** warning  
**Threshold:** Horizon pool acquire P99 > 100ms over 5 minutes

### What it means

Acquiring a Horizon server from the pool is taking longer than expected. This delays all operations that require Horizon (transaction submission, sync, balance checks). Transaction sync will fall behind as a result.

> Note: `stellar_transaction_sync_lag_seconds` reports the age of the least recently synced wallet and is the primary sync-health signal (see docs/SLOs.md). Pool acquire latency is a secondary signal that often explains a rising lag.

### Diagnosis

```bash
# 1. Check Horizon pool health
# horizon_pool_healthy_count / horizon_pool_size

# 2. Check acquire latency histogram (Prometheus query)
# histogram_quantile(0.99,
#   sum(rate(horizon_pool_acquire_duration_seconds_bucket[5m])) by (le)
# )

# 3. Check for Horizon connectivity issues
curl -sf "$HORIZON_URL/fee_stats"

# 4. Check transaction sync logs
grep "TransactionSync\|TRANSACTION_SYNC" /var/log/api.log | tail -30
```

### Remediation

1. If pool members are in cooldown, see [horizon-connectivity](#horizon-connectivity).
2. If Horizon itself is slow (high response times), consider switching to an alternative Horizon endpoint.
3. Manually trigger a transaction sync after Horizon recovers:

```bash
POST /transactions/sync
{
  "publicKey": "<affected wallet public key>"
}
```

### Recovery confirmation

```bash
# P99 acquire latency should drop back below 10ms
# histogram_quantile(0.99, sum(rate(horizon_pool_acquire_duration_seconds_bucket[5m])) by (le))
```

---

## application-down

**Alert:** `HealthcheckFailing`  
**Severity:** critical  
**Threshold:** `up{job="stellar-donation-api"} == 0` for 2 minutes

### What it means

Prometheus cannot scrape the `/health/ready` endpoint. The application process has likely crashed, the port is blocked, or the service is completely unresponsive.

### Immediate actions

```bash
# 1. Check if the process is running
ps aux | grep node

# 2. Check if the port is listening
netstat -tulpn | grep 3000
# or
ss -tlnp | grep 3000

# 3. Check process manager status
pm2 status      # if using pm2
docker ps -a    # if using Docker

# 4. Check startup logs for errors
pm2 logs api --lines 50
# or
journalctl -u stellar-api -n 50
# or
docker logs <container-id> --tail 50
```

### Remediation

| Symptom | Action |
|---------|--------|
| Process not running | Restart: `pm2 restart api` or `docker start <container>` |
| Process running but port blocked | Check firewall rules; confirm `PORT` in `.env` matches |
| Crash loop on startup | Check logs for `ENCRYPTION_KEY`, `API_KEYS`, or `DB_PATH` errors |
| OOM killed | Increase container memory limit; see [high-memory](#high-memory) |
| Port conflict | Change `PORT` in `.env` or kill conflicting process: `kill -9 $(lsof -ti:3000)` |

**Common startup failure: missing required environment variables:**
```bash
# Check environment
npm run validate-env
# or
ENCRYPTION_KEY=... API_KEYS=... node src/utils/startupChecks.js
```

### Recovery confirmation

```bash
curl -sf http://localhost:3000/health | jq .status
# Should return: "ok"
# Prometheus target should show state=up within the next scrape interval
```

---

## high-memory

**Alert:** `HighMemoryUsage`  
**Severity:** warning  
**Threshold:** Resident memory > 85% of heap limit + 100 MB for 5 minutes

### What it means

The Node.js process is using a large fraction of its available memory. If unchecked this can lead to OOM kills, increased garbage collection pauses, and elevated latency.

### Diagnosis

```bash
# 1. Check current memory via health endpoint
curl -sf http://localhost:3000/health | jq .memory

# 2. Check Prometheus metrics
# process_resident_memory_bytes
# nodejs_heap_size_used_bytes
# nodejs_heap_size_total_bytes

# 3. Check for recent deployments that may have introduced a leak
git log --oneline -10

# 4. Look for large caches or queues in logs
grep -i "cache\|queue\|pool" /var/log/api.log | tail -20
```

### Remediation

| Likely cause | Action |
|-------------|--------|
| Memory leak in new code | Roll back the recent deployment |
| Unbounded cache growth | Review cache TTL settings in `.env` |
| Large in-flight request queue | Reduce concurrency or add back-pressure |
| Insufficient container memory | Increase container memory limit |

**Immediate relief (if OOM is imminent):**
```bash
# Graceful restart (in-flight requests will complete)
pm2 restart api
# or
kill -SIGUSR2 <pid>  # triggers graceful reload if configured
```

### Recovery confirmation

```bash
# Memory should drop after restart
# process_resident_memory_bytes should decrease
curl -sf http://localhost:3000/health | jq .memory
```

---

## event-loop-lag

**Alert:** `HighEventLoopLag`  
**Severity:** warning  
**Threshold:** `nodejs_eventloop_lag_seconds > 1` for 2 minutes

### What it means

The Node.js event loop is blocked or highly contended. Long-running synchronous operations are preventing timely processing of I/O events. This directly impacts request latency and can cause timeouts.

### Diagnosis

```bash
# 1. Check event loop lag metric
# nodejs_eventloop_lag_seconds

# 2. Check CPU usage
# process_cpu_seconds_total (rate)
top -p <node-pid>

# 3. Look for synchronous heavy operations in logs
grep -E "SLOW_SYNC|blocking|synchronous" /var/log/api.log | tail -20

# 4. Check recent P95/P99 latency
# histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))
```

### Common causes

| Cause | Symptoms | Fix |
|-------|----------|-----|
| Large JSON serialisation | CPU spike on bulk export endpoints | Stream large payloads; paginate |
| Synchronous crypto operations | CPU spike on donation/encryption endpoints | Use async crypto APIs |
| Slow regex in middleware | Elevated lag on every request | Profile and optimise regex patterns |
| Database query on main thread | Lag correlates with query volume | Ensure queries are awaited properly |
| Runaway background job | Persistent lag regardless of traffic | Check scheduler and cleanup jobs |

### Remediation

1. Identify the blocking operation using CPU profiling:
   ```bash
   # Send SIGUSR1 to enable built-in Node.js inspector
   kill -SIGUSR1 <node-pid>
   # Attach Chrome DevTools or use clinic.js
   ```

2. If caused by a recent deployment, roll back.

3. For immediate relief, restart the process:
   ```bash
   pm2 restart api
   ```

### Recovery confirmation

```bash
# Event loop lag should return below 100ms
# nodejs_eventloop_lag_seconds < 0.1

# Request latency should also normalise
# histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le)) < 0.2
```

---

*Related documents:*
- [Incident Runbook](INCIDENT_RUNBOOK.md) — Full incident response framework with severity levels and post-incident checklist
- [Architecture Overview](ARCHITECTURE.md)
- [Monitoring Setup](MONITORING_SETUP.md)
- [SLOs Definition](SLOs.md)
