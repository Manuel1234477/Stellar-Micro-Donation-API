'use strict';

/**
 * Tests for Horizon connection pool metrics/observability (issue #1205).
 *
 * Verifies that HorizonPool reports pool utilization, cooldown, and recovery
 * events through the shared Prometheus registry so operators can size
 * HORIZON_POOL_SIZE / HORIZON_POOL_COOLDOWN_MS with real signal instead of
 * tuning blind.
 */

const HorizonPool = require('../src/services/HorizonPool');
const { registry } = require('../src/utils/metrics');

async function getMetricValue(name, labels) {
  const metrics = await registry.getMetricsAsJSON();
  const metric = metrics.find((m) => m.name === name);
  if (!metric) return undefined;
  if (!labels) return metric.values[0]?.value;
  const match = metric.values.find((v) =>
    Object.entries(labels).every(([k, val]) => v.labels[k] === val)
  );
  return match?.value;
}

describe('HorizonPool metrics', () => {
  test('reports pool size and healthy count on construction', async () => {
    new HorizonPool('https://horizon-testnet.stellar.org', { size: 4 });

    expect(await getMetricValue('horizon_pool_size')).toBe(4);
    expect(await getMetricValue('horizon_pool_healthy_count')).toBe(4);
    expect(await getMetricValue('horizon_pool_unhealthy_count')).toBe(0);
  });

  test('markUnhealthy increments cooldown counter and updates gauges', async () => {
    const pool = new HorizonPool('https://horizon-testnet.stellar.org', { size: 2 });
    const before = (await getMetricValue('horizon_pool_cooldown_events_total')) || 0;

    const server = pool.getServer();
    pool.markUnhealthy(server);

    expect(await getMetricValue('horizon_pool_cooldown_events_total')).toBe(before + 1);
    expect(await getMetricValue('horizon_pool_unhealthy_count')).toBe(1);
    expect(await getMetricValue('horizon_pool_healthy_count')).toBe(1);
  });

  test('recovery after cooldown increments recovery counter', async () => {
    const pool = new HorizonPool('https://horizon-testnet.stellar.org', { size: 2, cooldownMs: 1 });
    const server = pool.getServer();
    pool.markUnhealthy(server);

    const before = (await getMetricValue('horizon_pool_recovery_events_total')) || 0;

    // Cooldown is 1ms; wait it out, then trigger _tryRecover via getServer().
    await new Promise((resolve) => setTimeout(resolve, 5));
    pool.getServer();

    expect(await getMetricValue('horizon_pool_recovery_events_total')).toBe(before + 1);
  });

  test('getServer() acquisition time is recorded in the histogram', async () => {
    const pool = new HorizonPool('https://horizon-testnet.stellar.org', { size: 1 });
    pool.getServer();

    const metrics = await registry.getMetricsAsJSON();
    const histogram = metrics.find((m) => m.name === 'horizon_pool_acquire_duration_seconds');
    expect(histogram).toBeDefined();
    const countSample = histogram.values.find((v) => v.metricName.endsWith('_count'));
    expect(countSample.value).toBeGreaterThan(0);
  });

  test('getStatus() shape is unchanged for existing consumers', () => {
    const pool = new HorizonPool('https://horizon-testnet.stellar.org', { size: 3 });
    expect(pool.getStatus()).toEqual({ size: 3, healthy: 3, unhealthy: 0 });
  });
});
