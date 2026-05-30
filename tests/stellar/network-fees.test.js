'use strict';

const { getFeeStats, getCongestionLevel, buildRecommendations } = require('../../src/services/NetworkFeeService');
const Cache = require('../../src/utils/cache');

// Mock the http/https fetch so no real network calls are made
jest.mock('../src/services/NetworkFeeService', () => {
  const actual = jest.requireActual('../src/services/NetworkFeeService');
  return {
    ...actual,
    // We'll override fetchJson via the module internals by mocking https
  };
});

// ---- helpers ----
const MOCK_FEE_STATS = {
  last_ledger: '12345',
  last_ledger_base_fee: '100',
  ledger_capacity_usage: '0.97',
  fee_charged: {
    max: '10000', min: '100', mode: '100',
    p10: '100', p20: '100', p30: '100', p40: '100',
    p50: '200', p60: '200', p70: '500', p80: '500',
    p90: '1000', p95: '1000', p99: '10000',
  },
  max_fee: {
    max: '10000', min: '100', mode: '100',
    p10: '100', p50: '200', p90: '1000',
  },
};

// Patch the internal fetchJson by mocking the https module
const https = require('https');
jest.mock('https');

function mockHorizonResponse(data) {
  const mockReq = { on: jest.fn().mockReturnThis(), destroy: jest.fn() };
  https.get.mockImplementation((_url, _opts, cb) => {
    const res = {
      on: jest.fn((event, handler) => {
        if (event === 'data') handler(JSON.stringify(data));
        if (event === 'end') handler();
        return res;
      }),
    };
    cb(res);
    return mockReq;
  });
}

beforeEach(() => {
  Cache.clear();
  jest.clearAllMocks();
});

// ---- getCongestionLevel ----
describe('getCongestionLevel', () => {
  test('returns low when usage < 0.5', () => {
    expect(getCongestionLevel('0.3')).toBe('low');
    expect(getCongestionLevel(0)).toBe('low');
  });

  test('returns medium when 0.5 <= usage < 0.8', () => {
    expect(getCongestionLevel('0.5')).toBe('medium');
    expect(getCongestionLevel('0.79')).toBe('medium');
  });

  test('returns high when usage >= 0.8', () => {
    expect(getCongestionLevel('0.8')).toBe('high');
    expect(getCongestionLevel('0.97')).toBe('high');
    expect(getCongestionLevel('1.0')).toBe('high');
  });

  test('defaults to low for invalid input', () => {
    expect(getCongestionLevel(undefined)).toBe('low');
    expect(getCongestionLevel('abc')).toBe('low');
  });
});

// ---- buildRecommendations ----
describe('buildRecommendations', () => {
  test('maps p90 -> fast, p50 -> standard, p10 -> slow', () => {
    const rec = buildRecommendations(MOCK_FEE_STATS.fee_charged);
    expect(rec.fast).toBe('1000');
    expect(rec.standard).toBe('200');
    expect(rec.slow).toBe('100');
  });

  test('falls back to defaults when percentiles missing', () => {
    const rec = buildRecommendations({});
    expect(rec.fast).toBe('1000');
    expect(rec.standard).toBe('100');
    expect(rec.slow).toBe('100');
  });
});

// ---- getFeeStats ----
describe('getFeeStats', () => {
  const HORIZON = 'https://horizon-testnet.stellar.org';

  test('returns correct response shape', async () => {
    mockHorizonResponse(MOCK_FEE_STATS);
    const result = await getFeeStats(HORIZON);

    expect(result).toMatchObject({
      current: {
        lastLedger: '12345',
        lastLedgerBaseFee: '100',
        ledgerCapacityUsage: '0.97',
        feeCharged: expect.objectContaining({ p90: '1000', p50: '200', p10: '100' }),
        maxFee: expect.any(Object),
      },
      recommendations: { fast: '1000', standard: '200', slow: '100' },
      congestion: 'high',
      cachedAt: expect.any(String),
      cached: false,
    });
  });

  test('caches result — second call returns cached: true without hitting Horizon', async () => {
    mockHorizonResponse(MOCK_FEE_STATS);

    const first = await getFeeStats(HORIZON);
    expect(first.cached).toBe(false);
    expect(https.get).toHaveBeenCalledTimes(1);

    const second = await getFeeStats(HORIZON);
    expect(second.cached).toBe(true);
    // https.get should NOT have been called again
    expect(https.get).toHaveBeenCalledTimes(1);
  });

  test('cache expires after TTL and re-fetches', async () => {
    jest.useFakeTimers();
    mockHorizonResponse(MOCK_FEE_STATS);

    await getFeeStats(HORIZON);
    expect(https.get).toHaveBeenCalledTimes(1);

    // Advance past 30-second TTL
    jest.advanceTimersByTime(31_000);

    mockHorizonResponse(MOCK_FEE_STATS);
    const result = await getFeeStats(HORIZON);
    expect(result.cached).toBe(false);
    expect(https.get).toHaveBeenCalledTimes(2);

    jest.useRealTimers();
  });

  test('congestion is low for low capacity usage', async () => {
    mockHorizonResponse({ ...MOCK_FEE_STATS, ledger_capacity_usage: '0.2' });
    const result = await getFeeStats(HORIZON);
    expect(result.congestion).toBe('low');
  });

  test('congestion is medium for moderate capacity usage', async () => {
    Cache.clear();
    mockHorizonResponse({ ...MOCK_FEE_STATS, ledger_capacity_usage: '0.65' });
    const result = await getFeeStats(HORIZON);
    expect(result.congestion).toBe('medium');
  });
});
