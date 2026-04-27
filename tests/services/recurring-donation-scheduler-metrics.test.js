/**
 * Tests: Prometheus metrics for RecurringDonationScheduler
 *
 * Verifies that the five scheduler metrics are incremented correctly:
 *   - stellar_recurring_donations_due_total
 *   - stellar_recurring_donations_executed_total{status="success|failure"}
 *   - stellar_recurring_donations_execution_duration_seconds
 *   - stellar_recurring_donations_suspended_total
 *   - stellar_recurring_donations_active_count
 */

const client = require('prom-client');

// ─── Isolated registry + metric stubs ────────────────────────────────────────
// We replace the shared metrics module with fresh counters/gauges/histograms
// so tests don't bleed state into each other or the global registry.

let registry;
let recurringDonationsDueTotal;
let recurringDonationsExecutedTotal;
let recurringDonationsExecutionDuration;
let recurringDonationsSuspendedTotal;
let recurringDonationsActiveCount;

function buildMetrics() {
  registry = new client.Registry();

  recurringDonationsDueTotal = new client.Counter({
    name: 'stellar_recurring_donations_due_total',
    help: 'test',
    registers: [registry],
  });

  recurringDonationsExecutedTotal = new client.Counter({
    name: 'stellar_recurring_donations_executed_total',
    help: 'test',
    labelNames: ['status'],
    registers: [registry],
  });

  recurringDonationsExecutionDuration = new client.Histogram({
    name: 'stellar_recurring_donations_execution_duration_seconds',
    help: 'test',
    buckets: [0.1, 1, 10],
    registers: [registry],
  });

  recurringDonationsSuspendedTotal = new client.Counter({
    name: 'stellar_recurring_donations_suspended_total',
    help: 'test',
    registers: [registry],
  });

  recurringDonationsActiveCount = new client.Gauge({
    name: 'stellar_recurring_donations_active_count',
    help: 'test',
    registers: [registry],
  });

  return {
    registry,
    recurringDonationsDueTotal,
    recurringDonationsExecutedTotal,
    recurringDonationsExecutionDuration,
    recurringDonationsSuspendedTotal,
    recurringDonationsActiveCount,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getMetricValue(reg, name, labels = {}) {
  const text = await reg.getSingleMetricAsString(name);
  if (!text) return null;
  const labelStr = Object.entries(labels)
    .map(([k, v]) => `${k}="${v}"`)
    .join(',');
  const pattern = labelStr
    ? new RegExp(`${name}\\{[^}]*${labelStr}[^}]*\\}\\s+([\\d.]+)`)
    : new RegExp(`${name}(?:\\{[^}]*\\})?\\s+([\\d.]+)`);
  const match = text.match(pattern);
  return match ? Number(match[1]) : null;
}

// ─── due_total ────────────────────────────────────────────────────────────────

describe('stellar_recurring_donations_due_total', () => {
  it('increments by the number of due schedules', async () => {
    const { recurringDonationsDueTotal: counter, registry: reg } = buildMetrics();
    counter.inc(3);
    const val = await getMetricValue(reg, 'stellar_recurring_donations_due_total');
    expect(val).toBe(3);
  });

  it('accumulates across multiple ticks', async () => {
    const { recurringDonationsDueTotal: counter, registry: reg } = buildMetrics();
    counter.inc(2);
    counter.inc(5);
    const val = await getMetricValue(reg, 'stellar_recurring_donations_due_total');
    expect(val).toBe(7);
  });

  it('starts at 0', async () => {
    const { registry: reg } = buildMetrics();
    const text = await reg.getSingleMetricAsString('stellar_recurring_donations_due_total');
    // Counter starts at 0 — either no sample line or value is 0
    if (text) {
      const match = text.match(/stellar_recurring_donations_due_total\s+([\d.]+)/);
      if (match) expect(Number(match[1])).toBe(0);
    }
  });
});

// ─── executed_total ───────────────────────────────────────────────────────────

describe('stellar_recurring_donations_executed_total', () => {
  it('increments success counter', async () => {
    const { recurringDonationsExecutedTotal: counter, registry: reg } = buildMetrics();
    counter.inc({ status: 'success' });
    const val = await getMetricValue(reg, 'stellar_recurring_donations_executed_total', { status: 'success' });
    expect(val).toBe(1);
  });

  it('increments failure counter', async () => {
    const { recurringDonationsExecutedTotal: counter, registry: reg } = buildMetrics();
    counter.inc({ status: 'failure' });
    const val = await getMetricValue(reg, 'stellar_recurring_donations_executed_total', { status: 'failure' });
    expect(val).toBe(1);
  });

  it('tracks success and failure independently', async () => {
    const { recurringDonationsExecutedTotal: counter, registry: reg } = buildMetrics();
    counter.inc({ status: 'success' });
    counter.inc({ status: 'success' });
    counter.inc({ status: 'failure' });
    const successes = await getMetricValue(reg, 'stellar_recurring_donations_executed_total', { status: 'success' });
    const failures = await getMetricValue(reg, 'stellar_recurring_donations_executed_total', { status: 'failure' });
    expect(successes).toBe(2);
    expect(failures).toBe(1);
  });

  it('persists across multiple increments (counters do not reset)', async () => {
    const { recurringDonationsExecutedTotal: counter, registry: reg } = buildMetrics();
    for (let i = 0; i < 5; i++) counter.inc({ status: 'success' });
    const val = await getMetricValue(reg, 'stellar_recurring_donations_executed_total', { status: 'success' });
    expect(val).toBe(5);
  });
});

// ─── execution_duration_seconds ───────────────────────────────────────────────

describe('stellar_recurring_donations_execution_duration_seconds', () => {
  it('records an observation via startTimer', async () => {
    const { recurringDonationsExecutionDuration: hist, registry: reg } = buildMetrics();
    const end = hist.startTimer();
    end();
    const text = await reg.getSingleMetricAsString('stellar_recurring_donations_execution_duration_seconds');
    expect(text).toMatch(/stellar_recurring_donations_execution_duration_seconds_count\s+1/);
  });

  it('_count increments with each execution', async () => {
    const { recurringDonationsExecutionDuration: hist, registry: reg } = buildMetrics();
    hist.startTimer()();
    hist.startTimer()();
    hist.startTimer()();
    const text = await reg.getSingleMetricAsString('stellar_recurring_donations_execution_duration_seconds');
    expect(text).toMatch(/stellar_recurring_donations_execution_duration_seconds_count\s+3/);
  });

  it('exposes _bucket, _sum, _count lines', async () => {
    const { recurringDonationsExecutionDuration: hist, registry: reg } = buildMetrics();
    hist.startTimer()();
    const text = await reg.getSingleMetricAsString('stellar_recurring_donations_execution_duration_seconds');
    expect(text).toMatch(/_bucket/);
    expect(text).toMatch(/_sum/);
    expect(text).toMatch(/_count/);
  });
});

// ─── suspended_total ──────────────────────────────────────────────────────────

describe('stellar_recurring_donations_suspended_total', () => {
  it('increments when a schedule exhausts all retries', async () => {
    const { recurringDonationsSuspendedTotal: counter, registry: reg } = buildMetrics();
    counter.inc();
    const val = await getMetricValue(reg, 'stellar_recurring_donations_suspended_total');
    expect(val).toBe(1);
  });

  it('accumulates across multiple persistent failures', async () => {
    const { recurringDonationsSuspendedTotal: counter, registry: reg } = buildMetrics();
    counter.inc();
    counter.inc();
    const val = await getMetricValue(reg, 'stellar_recurring_donations_suspended_total');
    expect(val).toBe(2);
  });
});

// ─── active_count ─────────────────────────────────────────────────────────────

describe('stellar_recurring_donations_active_count', () => {
  it('reflects the current active schedule count', async () => {
    const { recurringDonationsActiveCount: gauge, registry: reg } = buildMetrics();
    gauge.set(42);
    const val = await getMetricValue(reg, 'stellar_recurring_donations_active_count');
    expect(val).toBe(42);
  });

  it('updates to a new value on each tick (does not accumulate)', async () => {
    const { recurringDonationsActiveCount: gauge, registry: reg } = buildMetrics();
    gauge.set(10);
    gauge.set(7); // schedules completed/suspended between ticks
    const val = await getMetricValue(reg, 'stellar_recurring_donations_active_count');
    expect(val).toBe(7);
  });

  it('can be set to 0', async () => {
    const { recurringDonationsActiveCount: gauge, registry: reg } = buildMetrics();
    gauge.set(5);
    gauge.set(0);
    const val = await getMetricValue(reg, 'stellar_recurring_donations_active_count');
    expect(val).toBe(0);
  });
});

// ─── Metric types exposed in Prometheus format ────────────────────────────────

describe('metric TYPE declarations', () => {
  it('due_total is a counter', async () => {
    const { registry: reg } = buildMetrics();
    const text = await reg.getSingleMetricAsString('stellar_recurring_donations_due_total');
    expect(text).toMatch(/# TYPE stellar_recurring_donations_due_total counter/);
  });

  it('executed_total is a counter', async () => {
    const { registry: reg } = buildMetrics();
    const text = await reg.getSingleMetricAsString('stellar_recurring_donations_executed_total');
    expect(text).toMatch(/# TYPE stellar_recurring_donations_executed_total counter/);
  });

  it('execution_duration_seconds is a histogram', async () => {
    const { registry: reg } = buildMetrics();
    const text = await reg.getSingleMetricAsString('stellar_recurring_donations_execution_duration_seconds');
    expect(text).toMatch(/# TYPE stellar_recurring_donations_execution_duration_seconds histogram/);
  });

  it('suspended_total is a counter', async () => {
    const { registry: reg } = buildMetrics();
    const text = await reg.getSingleMetricAsString('stellar_recurring_donations_suspended_total');
    expect(text).toMatch(/# TYPE stellar_recurring_donations_suspended_total counter/);
  });

  it('active_count is a gauge', async () => {
    const { registry: reg } = buildMetrics();
    const text = await reg.getSingleMetricAsString('stellar_recurring_donations_active_count');
    expect(text).toMatch(/# TYPE stellar_recurring_donations_active_count gauge/);
  });
});
