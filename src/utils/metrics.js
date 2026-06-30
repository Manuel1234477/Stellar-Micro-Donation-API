/**
 * Metrics Utility - Prometheus Instrumentation
 *
 * RESPONSIBILITY: Define and export all Prometheus metrics for the application
 * OWNER: Platform Team
 * DEPENDENCIES: prom-client
 *
 * Metrics exposed:
 * - http_request_duration_seconds: histogram of request latency (method, route, status_code)
 * - stellar_donations_total: counter of Stellar donation operations (status: sent|failed|pending)
 * - nodejs_* / process_* default metrics (via prom-client collectDefaultMetrics)
 *
 * Security: no PII or sensitive values are used as label values.
 */

const client = require('prom-client');

// Use a dedicated registry so tests can reset state cleanly
const registry = new client.Registry();

// Collect default Node.js / process metrics (memory, CPU, event loop lag, etc.)
if (process.env.NODE_ENV !== 'test' && process.env.NODE_ENV !== 'testing') {
  client.collectDefaultMetrics({ register: registry });
}

/**
 * Histogram tracking HTTP request duration.
 * Labels: method (GET/POST/…), route (normalised path), status_code (200/404/…)
 * @type {client.Histogram}
 */
const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

/**
 * Counter tracking Stellar donation operations by outcome.
 * Labels: status (sent|failed|pending)
 * @type {client.Counter}
 */
const stellarDonationsTotal = new client.Counter({
  name: 'stellar_donations_total',
  help: 'Total number of Stellar donation operations',
  labelNames: ['status'],
  registers: [registry],
});

// ─── Recurring Donation Scheduler Metrics ────────────────────────────────────

/**
 * Counter: total schedules found due on each scheduler tick.
 * @type {client.Counter}
 */
const recurringDonationsDueTotal = new client.Counter({
  name: 'stellar_recurring_donations_due_total',
  help: 'Total number of recurring donation schedules found due for execution',
  registers: [registry],
});

/**
 * Counter: total schedules executed, labelled by outcome.
 * Labels: status (success|failure)
 * @type {client.Counter}
 */
const recurringDonationsExecutedTotal = new client.Counter({
  name: 'stellar_recurring_donations_executed_total',
  help: 'Total number of recurring donation schedules executed',
  labelNames: ['status'],
  registers: [registry],
});

/**
 * Histogram: wall-clock duration of a single schedule execution (seconds).
 * @type {client.Histogram}
 */
const recurringDonationsExecutionDuration = new client.Histogram({
  name: 'stellar_recurring_donations_execution_duration_seconds',
  help: 'Duration of individual recurring donation schedule executions in seconds',
  buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [registry],
});

/**
 * Counter: total schedules suspended (all retries exhausted → persistent failure).
 * @type {client.Counter}
 */
const recurringDonationsSuspendedTotal = new client.Counter({
  name: 'stellar_recurring_donations_suspended_total',
  help: 'Total number of recurring donation schedules suspended after persistent failure',
  registers: [registry],
});

/**
 * Gauge: current number of active (non-suspended, non-completed) schedules.
 * Updated on each scheduler tick.
 * @type {client.Gauge}
 */
const recurringDonationsActiveCount = new client.Gauge({
  name: 'stellar_recurring_donations_active_count',
  help: 'Current number of active recurring donation schedules',
  registers: [registry],
});

/**
 * Counter: total schedules skipped on a scheduler tick, labelled by reason.
 *
 * Labels:
 *   reason — why the schedule was skipped:
 *     "in_progress"      — schedule already being executed (duplicate-execution guard)
 *     "network_degraded" — skipped due to detected Stellar network degradation
 *     "scheduler_paused" — skipped because the scheduler is in a paused state
 *
 * A growing rate on this counter is an early-warning sign that the scheduler
 * cannot process all due donations within its tick interval.
 *
 * @type {client.Counter}
 */
const recurringDonationsSkippedTotal = new client.Counter({
  name: 'recurring_donations_skipped_total',
  help: 'Total number of recurring donation schedules skipped on a scheduler tick',
  labelNames: ['reason'],
  registers: [registry],
});

// ─── Horizon Connection Pool Metrics ─────────────────────────────────────────

/**
 * Gauge: configured size of the Horizon connection pool.
 * @type {client.Gauge}
 */
const horizonPoolSize = new client.Gauge({
  name: 'horizon_pool_size',
  help: 'Configured size of the Horizon connection pool',
  registers: [registry],
});

/**
 * Gauge: number of currently-healthy pool members.
 * @type {client.Gauge}
 */
const horizonPoolHealthyCount = new client.Gauge({
  name: 'horizon_pool_healthy_count',
  help: 'Number of currently healthy Horizon pool members',
  registers: [registry],
});

/**
 * Gauge: number of currently-unhealthy (cooling down) pool members.
 * @type {client.Gauge}
 */
const horizonPoolUnhealthyCount = new client.Gauge({
  name: 'horizon_pool_unhealthy_count',
  help: 'Number of currently unhealthy (cooling down) Horizon pool members',
  registers: [registry],
});

/**
 * Counter: total number of times a Horizon pool member was marked unhealthy
 * and entered cooldown.
 * @type {client.Counter}
 */
const horizonPoolCooldownEventsTotal = new client.Counter({
  name: 'horizon_pool_cooldown_events_total',
  help: 'Total number of times a Horizon pool member entered cooldown after a failure',
  registers: [registry],
});

/**
 * Counter: total number of times a Horizon pool member was re-admitted
 * to rotation after its cooldown elapsed.
 * @type {client.Counter}
 */
const horizonPoolRecoveryEventsTotal = new client.Counter({
  name: 'horizon_pool_recovery_events_total',
  help: 'Total number of times a Horizon pool member was re-admitted after cooldown',
  registers: [registry],
});

/**
 * Histogram: time spent acquiring a pool member from getServer().
 * Near-instant today (round-robin, no queueing), but tracked so a future
 * blocking/queued pool implementation has an existing saturation signal.
 * @type {client.Histogram}
 */
const horizonPoolAcquireDuration = new client.Histogram({
  name: 'horizon_pool_acquire_duration_seconds',
  help: 'Time spent acquiring a Horizon server instance from the pool',
  buckets: [0.0001, 0.0005, 0.001, 0.005, 0.01, 0.05, 0.1, 0.5],
  registers: [registry],
});

/**
 * Update the Horizon pool gauges from a pool status snapshot.
 * @param {{ size: number, healthy: number, unhealthy: number }} status
 */
function recordHorizonPoolStatus(status) {
  horizonPoolSize.set(status.size);
  horizonPoolHealthyCount.set(status.healthy);
  horizonPoolUnhealthyCount.set(status.unhealthy);
}

/** Increment the Horizon pool cooldown-event counter. */
function recordHorizonPoolCooldownEvent() {
  horizonPoolCooldownEventsTotal.inc();
}

/** Increment the Horizon pool recovery-event counter. */
function recordHorizonPoolRecoveryEvent() {
  horizonPoolRecoveryEventsTotal.inc();
}

/**
 * Express middleware that records request duration for every response.
 * Normalises dynamic path segments (e.g. /donations/123 → /donations/:id)
 * to keep cardinality bounded.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function metricsMiddleware(req, res, next) {
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    const route = normaliseRoute(req.route?.path || req.path);
    end({ method: req.method, route, status_code: res.statusCode });
  });
  next();
}

/**
 * Normalises a URL path by replacing numeric segments with ':id'.
 * Prevents high-cardinality label explosion from per-resource paths.
 * @param {string} path
 * @returns {string}
 */
function normaliseRoute(path) {
  return path.replace(/\/\d+/g, '/:id');
}

/**
 * Increments the Stellar donations counter for the given status.
 * @param {'sent'|'failed'|'pending'} status
 */
function recordDonation(status) {
  stellarDonationsTotal.inc({ status });
}

module.exports = {
  registry,
  httpRequestDuration,
  stellarDonationsTotal,
  metricsMiddleware,
  normaliseRoute,
  recordDonation,
  // Recurring scheduler metrics
  recurringDonationsDueTotal,
  recurringDonationsExecutedTotal,
  recurringDonationsExecutionDuration,
  recurringDonationsSuspendedTotal,
  recurringDonationsActiveCount,
  recurringDonationsSkippedTotal,
  // Horizon connection pool metrics
  horizonPoolSize,
  horizonPoolHealthyCount,
  horizonPoolUnhealthyCount,
  horizonPoolCooldownEventsTotal,
  horizonPoolRecoveryEventsTotal,
  horizonPoolAcquireDuration,
  recordHorizonPoolStatus,
  recordHorizonPoolCooldownEvent,
  recordHorizonPoolRecoveryEvent,
};
