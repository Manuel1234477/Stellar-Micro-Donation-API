/**
 * Tests: API Key Usage Analytics
 * Covers ApiKeyUsageService (record, summary, time-series, anomaly detection),
 * the apiKeyUsageTracker middleware, and the REST endpoints.
 */

const request = require('supertest');
const ApiKeyUsageService = require('../../src/services/ApiKeyUsageService');

// ─── App setup ───────────────────────────────────────────────────────────────
jest.mock('../src/config/stellar', () => ({
  getStellarService: () => ({ getContractEvents: async () => [] }),
  useMockStellar: true,
  network: 'testnet',
  port: undefined,
}));

const app = require('../../src/routes/app');
const { setUsageService } = require('../../src/routes/apiKeyUsage');

// ─── Helpers ─────────────────────────────────────────────────────────────────
/** Build a fresh service and inject it into the route */
function freshService() {
  const svc = new ApiKeyUsageService();
  setUsageService(svc);
  return svc;
}

/** Seed N records spread across distinct hours */
function seedHourly(svc, apiKey, n) {
  const base = Date.UTC(2024, 0, 1, 0, 0, 0); // 2024-01-01T00:00Z
  for (let i = 0; i < n; i++) {
    svc.record(apiKey, {
      latencyMs: 100 + i * 10,
      statusCode: i % 5 === 0 ? 500 : 200,
      path: '/health',
      method: 'GET',
      timestamp: base + i * 3_600_000, // one per hour
    });
  }
}

// =============================================================================
// ApiKeyUsageService — record validation
// =============================================================================
describe('ApiKeyUsageService.record — validation', () => {
  let svc;
  beforeEach(() => { svc = new ApiKeyUsageService(); });

  test('throws for missing apiKey', () => {
    expect(() => svc.record('', { latencyMs: 10, statusCode: 200 })).toThrow('apiKey is required');
    expect(() => svc.record(null, { latencyMs: 10, statusCode: 200 })).toThrow('apiKey is required');
  });

  test('throws for negative latencyMs', () => {
    expect(() => svc.record('key1', { latencyMs: -1, statusCode: 200 })).toThrow('latencyMs must be a non-negative number');
  });

  test('throws for non-number latencyMs', () => {
    expect(() => svc.record('key1', { latencyMs: 'fast', statusCode: 200 })).toThrow('latencyMs must be a non-negative number');
  });

  test('throws for missing statusCode', () => {
    expect(() => svc.record('key1', { latencyMs: 10 })).toThrow('statusCode must be a number');
  });

  test('accepts zero latency', () => {
    expect(() => svc.record('key1', { latencyMs: 0, statusCode: 200 })).not.toThrow();
  });
});

// =============================================================================
// ApiKeyUsageService — getSummary
// =============================================================================
describe('ApiKeyUsageService.getSummary', () => {
  let svc;
  beforeEach(() => { svc = new ApiKeyUsageService(); });

  test('returns zero stats for key with no records', () => {
    const s = svc.getSummary('newkey');
    expect(s).toEqual({ apiKey: 'newkey', totalRequests: 0, errorCount: 0, errorRate: 0, avgLatencyMs: 0 });
  });

  test('counts total requests correctly', () => {
    svc.record('k1', { latencyMs: 50, statusCode: 200 });
    svc.record('k1', { latencyMs: 100, statusCode: 200 });
    expect(svc.getSummary('k1').totalRequests).toBe(2);
  });

  test('counts errors (status >= 400)', () => {
    svc.record('k1', { latencyMs: 50, statusCode: 200 });
    svc.record('k1', { latencyMs: 50, statusCode: 400 });
    svc.record('k1', { latencyMs: 50, statusCode: 500 });
    const s = svc.getSummary('k1');
    expect(s.errorCount).toBe(2);
    expect(s.errorRate).toBeCloseTo(66.67, 1);
  });

  test('computes average latency', () => {
    svc.record('k1', { latencyMs: 100, statusCode: 200 });
    svc.record('k1', { latencyMs: 200, statusCode: 200 });
    expect(svc.getSummary('k1').avgLatencyMs).toBe(150);
  });

  test('does not mix keys', () => {
    svc.record('k1', { latencyMs: 50, statusCode: 200 });
    svc.record('k2', { latencyMs: 50, statusCode: 500 });
    expect(svc.getSummary('k1').errorCount).toBe(0);
    expect(svc.getSummary('k2').errorCount).toBe(1);
  });

  test('throws for missing apiKey', () => {
    expect(() => svc.getSummary('')).toThrow('apiKey is required');
  });
});

// =============================================================================
// ApiKeyUsageService — getTimeSeries
// =============================================================================
describe('ApiKeyUsageService.getTimeSeries', () => {
  let svc;
  beforeEach(() => { svc = new ApiKeyUsageService(); });

  test('returns empty array when no records', () => {
    expect(svc.getTimeSeries('k1', 'hour')).toEqual([]);
  });

  test('throws for invalid granularity', () => {
    expect(() => svc.getTimeSeries('k1', 'minute')).toThrow('Invalid granularity');
  });

  test('throws for missing apiKey', () => {
    expect(() => svc.getTimeSeries('', 'hour')).toThrow('apiKey is required');
  });

  test('hourly bucketing groups records correctly', () => {
    const base = Date.UTC(2024, 0, 1, 10, 0, 0);
    svc.record('k1', { latencyMs: 100, statusCode: 200, timestamp: base });
    svc.record('k1', { latencyMs: 200, statusCode: 200, timestamp: base + 1800_000 }); // same hour
    svc.record('k1', { latencyMs: 50,  statusCode: 500, timestamp: base + 3_600_000 }); // next hour

    const series = svc.getTimeSeries('k1', 'hour');
    expect(series).toHaveLength(2);
    expect(series[0].requests).toBe(2);
    expect(series[1].requests).toBe(1);
    expect(series[1].errors).toBe(1);
  });

  test('daily bucketing groups records correctly', () => {
    const day1 = Date.UTC(2024, 0, 1, 8, 0, 0);
    const day2 = Date.UTC(2024, 0, 2, 8, 0, 0);
    svc.record('k1', { latencyMs: 100, statusCode: 200, timestamp: day1 });
    svc.record('k1', { latencyMs: 100, statusCode: 200, timestamp: day1 + 3_600_000 });
    svc.record('k1', { latencyMs: 100, statusCode: 200, timestamp: day2 });

    const series = svc.getTimeSeries('k1', 'day');
    expect(series).toHaveLength(2);
    expect(series[0].requests).toBe(2);
    expect(series[1].requests).toBe(1);
  });

  test('weekly bucketing groups records correctly', () => {
    // 2024-01-01 is a Monday
    const week1 = Date.UTC(2024, 0, 1);
    const week2 = Date.UTC(2024, 0, 8); // next Monday
    svc.record('k1', { latencyMs: 100, statusCode: 200, timestamp: week1 });
    svc.record('k1', { latencyMs: 100, statusCode: 200, timestamp: week1 + 86_400_000 });
    svc.record('k1', { latencyMs: 100, statusCode: 200, timestamp: week2 });

    const series = svc.getTimeSeries('k1', 'week');
    expect(series).toHaveLength(2);
    expect(series[0].requests).toBe(2);
    expect(series[1].requests).toBe(1);
  });

  test('from/to filter works', () => {
    const base = Date.UTC(2024, 0, 1);
    svc.record('k1', { latencyMs: 10, statusCode: 200, timestamp: base });
    svc.record('k1', { latencyMs: 10, statusCode: 200, timestamp: base + 86_400_000 });
    svc.record('k1', { latencyMs: 10, statusCode: 200, timestamp: base + 2 * 86_400_000 });

    const series = svc.getTimeSeries('k1', 'day', { from: base, to: base + 86_400_000 });
    expect(series).toHaveLength(2);
  });

  test('bucket avgLatencyMs is computed correctly', () => {
    const base = Date.UTC(2024, 0, 1, 0, 0, 0);
    svc.record('k1', { latencyMs: 100, statusCode: 200, timestamp: base });
    svc.record('k1', { latencyMs: 300, statusCode: 200, timestamp: base + 1000 });
    const series = svc.getTimeSeries('k1', 'hour');
    expect(series[0].avgLatencyMs).toBe(200);
  });
});

// =============================================================================
// ApiKeyUsageService — detectAnomalies
// =============================================================================
describe('ApiKeyUsageService.detectAnomalies', () => {
  let svc;
  beforeEach(() => { svc = new ApiKeyUsageService(); });

  test('returns empty anomalies when fewer than 2 buckets', () => {
    svc.record('k1', { latencyMs: 10, statusCode: 200 });
    const result = svc.detectAnomalies('k1', 'day');
    expect(result.anomalies).toHaveLength(0);
  });

  test('detects spike bucket as anomaly', () => {
    const base = Date.UTC(2024, 0, 1);
    // 6 normal days (1 req each) + 1 spike day (50 reqs)
    for (let d = 0; d < 6; d++) {
      svc.record('k1', { latencyMs: 10, statusCode: 200, timestamp: base + d * 86_400_000 });
    }
    for (let i = 0; i < 50; i++) {
      svc.record('k1', { latencyMs: 10, statusCode: 200, timestamp: base + 6 * 86_400_000 + i * 1000 });
    }
    const result = svc.detectAnomalies('k1', 'day');
    expect(result.anomalies.length).toBeGreaterThanOrEqual(1);
    expect(result.anomalies[0].requests).toBe(50);
  });

  test('no anomalies when all buckets are uniform', () => {
    const base = Date.UTC(2024, 0, 1);
    for (let d = 0; d < 7; d++) {
      svc.record('k1', { latencyMs: 10, statusCode: 200, timestamp: base + d * 86_400_000 });
    }
    const result = svc.detectAnomalies('k1', 'day');
    expect(result.anomalies).toHaveLength(0);
  });

  test('threshold is returned in result', () => {
    seedHourly(svc, 'k1', 5);
    const result = svc.detectAnomalies('k1', 'hour');
    expect(typeof result.threshold).toBe('number');
  });
});

// =============================================================================
// apiKeyUsageTracker middleware
// =============================================================================
describe('apiKeyUsageTracker middleware', () => {
  test('records usage when X-API-Key header is present', async () => {
    // The middleware uses the singleton instance directly
    const { instance: singleton } = require('../../src/services/ApiKeyUsageService');
    singleton._clear();

    await request(app).get('/health').set('X-API-Key', 'mw-test-key');
    await new Promise(r => setTimeout(r, 30));

    const summary = singleton.getSummary('mw-test-key');
    expect(summary.totalRequests).toBeGreaterThanOrEqual(1);
  });

  test('skips tracking when no API key is present', async () => {
    const { instance: singleton } = require('../../src/services/ApiKeyUsageService');
    const before = singleton.listMonitors ? 0 : singleton._records.size;
    await request(app).get('/health'); // no key header
    await new Promise(r => setTimeout(r, 20));
    // Size should not have grown with an empty-string key
    expect(singleton._records.has('')).toBe(false);
    expect(singleton._records.has(undefined)).toBe(false);
  });
});

// =============================================================================
// REST — GET /api-keys/:id/usage
// =============================================================================
describe('GET /api-keys/:id/usage', () => {
  let svc;
  beforeEach(() => { svc = freshService(); });

  test('200 with zero stats for unknown key', async () => {
    const res = await request(app).get('/api-keys/unknown-key/usage');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.totalRequests).toBe(0);
  });

  test('200 with correct stats after recording', async () => {
    svc.record('mykey', { latencyMs: 100, statusCode: 200 });
    svc.record('mykey', { latencyMs: 200, statusCode: 500 });
    const res = await request(app).get('/api-keys/mykey/usage');
    expect(res.status).toBe(200);
    expect(res.body.data.totalRequests).toBe(2);
    expect(res.body.data.errorCount).toBe(1);
    expect(res.body.data.avgLatencyMs).toBe(150);
  });
});

// =============================================================================
// REST — GET /api-keys/:id/usage/timeseries
// =============================================================================
describe('GET /api-keys/:id/usage/timeseries', () => {
  let svc;
  beforeEach(() => { svc = freshService(); });

  test('400 when granularity is missing', async () => {
    const res = await request(app).get('/api-keys/k1/usage/timeseries');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('400 for invalid granularity', async () => {
    const res = await request(app).get('/api-keys/k1/usage/timeseries?granularity=second');
    expect(res.status).toBe(400);
  });

  test('200 with empty series for key with no records', async () => {
    const res = await request(app).get('/api-keys/k1/usage/timeseries?granularity=day');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.count).toBe(0);
  });

  test('200 with hourly series', async () => {
    seedHourly(svc, 'k1', 3);
    const res = await request(app).get('/api-keys/k1/usage/timeseries?granularity=hour');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(3);
    expect(res.body.data[0]).toHaveProperty('bucket');
    expect(res.body.data[0]).toHaveProperty('requests');
    expect(res.body.data[0]).toHaveProperty('errors');
    expect(res.body.data[0]).toHaveProperty('avgLatencyMs');
  });

  test('200 with daily series', async () => {
    seedHourly(svc, 'k1', 48); // 48 hours = 2 days
    const res = await request(app).get('/api-keys/k1/usage/timeseries?granularity=day');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
  });

  test('400 for invalid from date', async () => {
    const res = await request(app).get('/api-keys/k1/usage/timeseries?granularity=day&from=notadate');
    expect(res.status).toBe(400);
  });
});

// =============================================================================
// REST — GET /api-keys/:id/usage/anomalies
// =============================================================================
describe('GET /api-keys/:id/usage/anomalies', () => {
  let svc;
  beforeEach(() => { svc = freshService(); });

  test('400 when granularity is missing', async () => {
    const res = await request(app).get('/api-keys/k1/usage/anomalies');
    expect(res.status).toBe(400);
  });

  test('200 with empty anomalies for sparse data', async () => {
    svc.record('k1', { latencyMs: 10, statusCode: 200 });
    const res = await request(app).get('/api-keys/k1/usage/anomalies?granularity=day');
    expect(res.status).toBe(200);
    expect(res.body.data.anomalies).toHaveLength(0);
  });

  test('200 detects spike anomaly', async () => {
    const base = Date.UTC(2024, 0, 1);
    for (let d = 0; d < 6; d++) {
      svc.record('k1', { latencyMs: 10, statusCode: 200, timestamp: base + d * 86_400_000 });
    }
    for (let i = 0; i < 50; i++) {
      svc.record('k1', { latencyMs: 10, statusCode: 200, timestamp: base + 6 * 86_400_000 + i * 1000 });
    }
    const res = await request(app).get('/api-keys/k1/usage/anomalies?granularity=day');
    expect(res.status).toBe(200);
    expect(res.body.data.anomalies.length).toBeGreaterThanOrEqual(1);
  });

  test('respects custom multiplier param', async () => {
    seedHourly(svc, 'k1', 5);
    const res = await request(app).get('/api-keys/k1/usage/anomalies?granularity=hour&multiplier=0');
    expect(res.status).toBe(200);
    // multiplier=0 means threshold=mean, so all above-mean buckets are anomalies
    expect(res.body.data).toHaveProperty('threshold');
  });
});
