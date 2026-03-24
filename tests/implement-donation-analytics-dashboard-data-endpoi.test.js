'use strict';

/**
 * Tests for donation analytics dashboard endpoint (issue #313).
 *
 * Covers:
 *  - StatsService.parsePeriod: valid/invalid period strings, granularity auto-selection
 *  - StatsService.bucketByGranularity: hourly/daily/weekly/monthly
 *  - StatsService.movingAverage: window calculation
 *  - StatsService.getDashboardData: summary, trend, topDonors, topRecipients, caching
 *  - Cache invalidation on donation.created event
 *  - GET /stats/dashboard: success, period param, granularity override, topN, invalid params
 */

const express = require('express');
const request = require('supertest');
const StatsService = require('../src/services/StatsService');
const Cache = require('../src/utils/cache');
const Transaction = require('../src/routes/models/transaction');
const donationEvents = require('../src/events/donationEvents');

// ─── helpers ────────────────────────────────────────────────────────────────

function makeTx(donor, recipient, amount, daysAgo = 0) {
  const ts = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  return { id: `tx-${Math.random()}`, donor, recipient, amount, status: 'completed', timestamp: ts, memo: '' };
}

function seedTransactions(txs) {
  Transaction._clearAllData();
  for (const tx of txs) Transaction.create(tx);
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.apiKey = { id: 'k1', role: 'user' };
    req.user   = { id: 'apikey-k1', role: 'user', name: 'Test' };
    next();
  });
  app.use('/stats', require('../src/routes/stats'));
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ success: false, error: { code: err.errorCode || 'ERROR', message: err.message } });
  });
  return app;
}

beforeEach(() => {
  Transaction._clearAllData();
  Cache.clear();
});

// ─── parsePeriod ─────────────────────────────────────────────────────────────

describe('StatsService.parsePeriod', () => {
  it('parses days (30d)', () => {
    const { start, end, granularity } = StatsService.parsePeriod('30d');
    expect(end - start).toBeCloseTo(30 * 86_400_000, -3);
    expect(granularity).toBe('weekly');
  });

  it('parses hours (24h) → hourly granularity', () => {
    const { granularity } = StatsService.parsePeriod('24h');
    expect(granularity).toBe('hourly');
  });

  it('parses weeks (2w) → daily granularity', () => {
    const { granularity } = StatsService.parsePeriod('2w');
    expect(granularity).toBe('daily');
  });

  it('parses months (3m) → weekly granularity', () => {
    const { granularity } = StatsService.parsePeriod('3m');
    expect(granularity).toBe('weekly');
  });

  it('parses years (1y) → monthly granularity', () => {
    const { granularity } = StatsService.parsePeriod('1y');
    expect(granularity).toBe('monthly');
  });

  it('throws 400 for invalid period string', () => {
    expect(() => StatsService.parsePeriod('invalid')).toThrow();
    try { StatsService.parsePeriod('invalid'); } catch (e) { expect(e.statusCode).toBe(400); }
  });

  it('throws for empty string', () => {
    expect(() => StatsService.parsePeriod('')).toThrow();
  });
});

// ─── bucketByGranularity ─────────────────────────────────────────────────────

describe('StatsService.bucketByGranularity', () => {
  const txs = [
    { amount: '10', timestamp: '2024-01-15T10:00:00Z' },
    { amount: '20', timestamp: '2024-01-15T14:00:00Z' },
    { amount: '30', timestamp: '2024-01-16T09:00:00Z' },
  ];

  it('daily: groups by date', () => {
    const buckets = StatsService.bucketByGranularity(txs, 'daily');
    expect(buckets).toHaveLength(2);
    expect(buckets[0].bucket).toBe('2024-01-15');
    expect(buckets[0].count).toBe(2);
    expect(buckets[0].totalAmount).toBeCloseTo(30, 5);
    expect(buckets[1].bucket).toBe('2024-01-16');
  });

  it('hourly: groups by hour', () => {
    const buckets = StatsService.bucketByGranularity(txs, 'hourly');
    expect(buckets).toHaveLength(3);
    expect(buckets[0].bucket).toMatch(/2024-01-15T10/);
  });

  it('monthly: groups by year-month', () => {
    const buckets = StatsService.bucketByGranularity(txs, 'monthly');
    expect(buckets).toHaveLength(1);
    expect(buckets[0].bucket).toBe('2024-01');
    expect(buckets[0].count).toBe(3);
  });

  it('weekly: groups by ISO week', () => {
    const buckets = StatsService.bucketByGranularity(txs, 'weekly');
    expect(buckets).toHaveLength(1);
    expect(buckets[0].bucket).toMatch(/W/);
  });

  it('computes avgAmount correctly', () => {
    const buckets = StatsService.bucketByGranularity(txs, 'daily');
    expect(buckets[0].avgAmount).toBeCloseTo(15, 5);
  });

  it('returns empty array for no transactions', () => {
    expect(StatsService.bucketByGranularity([], 'daily')).toEqual([]);
  });
});

// ─── movingAverage ────────────────────────────────────────────────────────────

describe('StatsService.movingAverage', () => {
  const buckets = [
    { bucket: 'a', totalAmount: 10 },
    { bucket: 'b', totalAmount: 20 },
    { bucket: 'c', totalAmount: 30 },
    { bucket: 'd', totalAmount: 40 },
  ];

  it('computes 3-window moving average', () => {
    const ma = StatsService.movingAverage(buckets, 3);
    expect(ma[0].movingAvg).toBeCloseTo(10, 5);       // [10] / 1
    expect(ma[1].movingAvg).toBeCloseTo(15, 5);       // [10,20] / 2
    expect(ma[2].movingAvg).toBeCloseTo(20, 5);       // [10,20,30] / 3
    expect(ma[3].movingAvg).toBeCloseTo(30, 5);       // [20,30,40] / 3
  });

  it('window=1 returns each value unchanged', () => {
    const ma = StatsService.movingAverage(buckets, 1);
    expect(ma.map(x => x.movingAvg)).toEqual([10, 20, 30, 40]);
  });

  it('returns empty array for empty input', () => {
    expect(StatsService.movingAverage([], 3)).toEqual([]);
  });

  it('preserves bucket labels', () => {
    const ma = StatsService.movingAverage(buckets, 2);
    expect(ma.map(x => x.bucket)).toEqual(['a', 'b', 'c', 'd']);
  });
});

// ─── getDashboardData ─────────────────────────────────────────────────────────

describe('StatsService.getDashboardData', () => {
  beforeEach(() => {
    seedTransactions([
      makeTx('ALICE', 'BOB',   10, 1),
      makeTx('ALICE', 'CAROL', 20, 2),
      makeTx('BOB',   'CAROL', 30, 3),
    ]);
  });

  it('returns required top-level keys', () => {
    const data = StatsService.getDashboardData({ period: '30d' });
    expect(data).toHaveProperty('period');
    expect(data).toHaveProperty('granularity');
    expect(data).toHaveProperty('dateRange');
    expect(data).toHaveProperty('summary');
    expect(data).toHaveProperty('trend');
    expect(data).toHaveProperty('trendMovingAvg');
    expect(data).toHaveProperty('topDonors');
    expect(data).toHaveProperty('topRecipients');
  });

  it('summary totals are correct', () => {
    const { summary } = StatsService.getDashboardData({ period: '30d' });
    expect(summary.totalDonations).toBe(3);
    expect(summary.totalAmount).toBeCloseTo(60, 5);
    expect(summary.avgAmount).toBeCloseTo(20, 5);
  });

  it('topDonors sorted by totalAmount descending', () => {
    const { topDonors } = StatsService.getDashboardData({ period: '30d' });
    expect(topDonors[0].address).toBe('ALICE');
    expect(topDonors[0].totalAmount).toBeCloseTo(30, 5);
    expect(topDonors[0].count).toBe(2);
  });

  it('topRecipients sorted by totalAmount descending', () => {
    const { topRecipients } = StatsService.getDashboardData({ period: '30d' });
    expect(topRecipients[0].address).toBe('CAROL');
    expect(topRecipients[0].totalAmount).toBeCloseTo(50, 5);
  });

  it('respects topN limit', () => {
    const { topDonors } = StatsService.getDashboardData({ period: '30d', topN: 1 });
    expect(topDonors).toHaveLength(1);
  });

  it('returns empty arrays when no transactions in range', () => {
    Transaction._clearAllData();
    const data = StatsService.getDashboardData({ period: '1d' });
    expect(data.summary.totalDonations).toBe(0);
    expect(data.topDonors).toHaveLength(0);
    expect(data.trend).toHaveLength(0);
  });

  it('caches result on second call (cached=true)', () => {
    StatsService.getDashboardData({ period: '30d' });
    const second = StatsService.getDashboardData({ period: '30d' });
    expect(second.cached).toBe(true);
  });

  it('first call returns cached=false', () => {
    const first = StatsService.getDashboardData({ period: '30d' });
    expect(first.cached).toBe(false);
  });

  it('granularity override is respected', () => {
    const data = StatsService.getDashboardData({ period: '30d', granularity: 'monthly' });
    expect(data.granularity).toBe('monthly');
  });

  it('throws for invalid period', () => {
    expect(() => StatsService.getDashboardData({ period: 'bad' })).toThrow();
  });
});

// ─── Cache invalidation ───────────────────────────────────────────────────────

describe('Cache invalidation on donation.created', () => {
  it('clears dashboard cache when donation.created fires', () => {
    seedTransactions([makeTx('A', 'B', 10, 1)]);
    StatsService.getDashboardData({ period: '30d' }); // populate cache
    expect(StatsService.getDashboardData({ period: '30d' }).cached).toBe(true);

    donationEvents.emit('donation.created', {});

    expect(StatsService.getDashboardData({ period: '30d' }).cached).toBe(false);
  });
});

// ─── HTTP integration ─────────────────────────────────────────────────────────

describe('GET /stats/dashboard', () => {
  beforeEach(() => {
    seedTransactions([
      makeTx('ALICE', 'BOB',   10, 1),
      makeTx('ALICE', 'CAROL', 20, 5),
      makeTx('BOB',   'CAROL', 30, 10),
    ]);
  });

  it('returns 200 with default period', async () => {
    const res = await request(buildApp()).get('/stats/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('summary');
  });

  it('returns correct summary for 30d', async () => {
    const res = await request(buildApp()).get('/stats/dashboard?period=30d');
    expect(res.status).toBe(200);
    expect(res.body.data.summary.totalDonations).toBe(3);
    expect(res.body.data.summary.totalAmount).toBeCloseTo(60, 5);
  });

  it('respects period=7d (excludes older transactions)', async () => {
    const res = await request(buildApp()).get('/stats/dashboard?period=7d');
    expect(res.status).toBe(200);
    // Only 2 transactions within 7 days (1 and 5 days ago)
    expect(res.body.data.summary.totalDonations).toBe(2);
  });

  it('accepts granularity override', async () => {
    const res = await request(buildApp()).get('/stats/dashboard?period=30d&granularity=monthly');
    expect(res.status).toBe(200);
    expect(res.body.data.granularity).toBe('monthly');
  });

  it('accepts topN param', async () => {
    const res = await request(buildApp()).get('/stats/dashboard?period=30d&topN=1');
    expect(res.status).toBe(200);
    expect(res.body.data.topDonors).toHaveLength(1);
  });

  it('returns 400 for invalid period', async () => {
    const res = await request(buildApp()).get('/stats/dashboard?period=bad');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PARAM');
  });

  it('returns 400 for invalid granularity', async () => {
    const res = await request(buildApp()).get('/stats/dashboard?granularity=yearly');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PARAM');
  });

  it('response includes trend and trendMovingAvg arrays', async () => {
    const res = await request(buildApp()).get('/stats/dashboard?period=30d');
    expect(Array.isArray(res.body.data.trend)).toBe(true);
    expect(Array.isArray(res.body.data.trendMovingAvg)).toBe(true);
  });

  it('response includes dateRange', async () => {
    const res = await request(buildApp()).get('/stats/dashboard?period=30d');
    expect(res.body.data.dateRange).toHaveProperty('start');
    expect(res.body.data.dateRange).toHaveProperty('end');
  });

  it('second identical request returns cached=true', async () => {
    const app = buildApp();
    await request(app).get('/stats/dashboard?period=30d');
    const res = await request(app).get('/stats/dashboard?period=30d');
    expect(res.body.data.cached).toBe(true);
  });
});
