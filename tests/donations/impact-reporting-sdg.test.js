'use strict';

/**
 * Tests: Donation Impact Reporting with SDG Category Mapping (#624)
 *
 * Covers:
 *  - SDG_CATEGORIES has all 17 SDGs
 *  - validateSdgCodes accepts valid codes, rejects invalid
 *  - Donations can be tagged with SDG categories
 *  - GET /impact/sdg-breakdown returns accurate totals per SDG
 *  - GET /impact/report returns structured report for date range
 *  - POST /impact/report/export generates CSV and PDF
 *  - Invalid SDG codes return 400 with descriptive message
 */

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-key-1';

const request = require('supertest');
const express = require('express');
const path = require('path');
const os = require('os');
const fs = require('fs');

const Transaction = require('../../src/routes/models/transaction');
const impactRouter = require('../../src/routes/impact');
const donationRouter = require('../../src/routes/donation');
const { attachUserRole } = require('../../src/middleware/rbac');
const { SDG_CATEGORIES, VALID_SDG_CODES, validateSdgCodes } = require('../../src/services/ImpactMetricService');

// ─── Test app ─────────────────────────────────────────────────────────────────

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(attachUserRole());
  app.use('/impact', impactRouter);
  app.use('/donations', donationRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || err.statusCode || 500).json({
      success: false,
      error: { code: err.code || 'ERROR', message: err.message },
    });
  });
  return app;
}

let app;
let idCounter = 0;
const nextKey = () => `sdg-idem-${++idCounter}-${Date.now()}`;

beforeAll(() => {
  app = createApp();
  // Use a temp file for transaction storage
  process.env.DB_JSON_PATH = path.join(os.tmpdir(), `sdg-test-${Date.now()}.json`);
});

beforeEach(() => Transaction._clearAllData());
afterEach(() => Transaction._clearAllData());

afterAll(() => {
  if (process.env.DB_JSON_PATH && fs.existsSync(process.env.DB_JSON_PATH)) {
    fs.unlinkSync(process.env.DB_JSON_PATH);
  }
});

// ─── SDG_CATEGORIES constant ──────────────────────────────────────────────────

describe('SDG_CATEGORIES', () => {
  it('contains exactly 17 SDGs', () => {
    expect(SDG_CATEGORIES).toHaveLength(17);
  });

  it('has codes SDG1 through SDG17', () => {
    for (let i = 1; i <= 17; i++) {
      expect(VALID_SDG_CODES.has(`SDG${i}`)).toBe(true);
    }
  });

  it('each entry has code, goal, title, description', () => {
    for (const sdg of SDG_CATEGORIES) {
      expect(sdg.code).toMatch(/^SDG\d+$/);
      expect(typeof sdg.goal).toBe('number');
      expect(typeof sdg.title).toBe('string');
      expect(typeof sdg.description).toBe('string');
    }
  });
});

// ─── validateSdgCodes ─────────────────────────────────────────────────────────

describe('validateSdgCodes()', () => {
  it('accepts valid codes', () => {
    expect(validateSdgCodes(['SDG1', 'SDG13']).valid).toBe(true);
  });

  it('rejects invalid codes', () => {
    const result = validateSdgCodes(['SDG1', 'SDG99', 'INVALID']);
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain('SDG99');
    expect(result.invalid).toContain('INVALID');
  });

  it('returns valid for empty array', () => {
    expect(validateSdgCodes([]).valid).toBe(true);
  });

  it('returns invalid for non-array', () => {
    expect(validateSdgCodes('SDG1').valid).toBe(false);
  });
});

// ─── SDG tagging on donation creation ────────────────────────────────────────

describe('POST /donations — SDG tagging', () => {
  it('accepts valid sdgCategories', async () => {
    const res = await request(app)
      .post('/donations')
      .set('X-API-Key', 'test-key-1')
      .set('X-Idempotency-Key', nextKey())
      .send({ amount: '10', donor: 'GABC', recipient: 'GDEF', sdgCategories: ['SDG1', 'SDG3'] });

    expect(res.status).toBe(201);
    const tx = Transaction.getAll()[0];
    expect(tx.sdgCategories).toEqual(['SDG1', 'SDG3']);
  });

  it('returns 400 for invalid SDG codes', async () => {
    const res = await request(app)
      .post('/donations')
      .set('X-API-Key', 'test-key-1')
      .set('X-Idempotency-Key', nextKey())
      .send({ amount: '10', donor: 'GABC', recipient: 'GDEF', sdgCategories: ['SDG99', 'INVALID'] });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(JSON.stringify(res.body)).toMatch(/SDG99|INVALID/);
  });

  it('stores empty sdgCategories when not provided', async () => {
    await request(app)
      .post('/donations')
      .set('X-API-Key', 'test-key-1')
      .set('X-Idempotency-Key', nextKey())
      .send({ amount: '5', donor: 'GABC', recipient: 'GDEF' });

    const tx = Transaction.getAll()[0];
    expect(tx.sdgCategories).toEqual([]);
  });
});

// ─── GET /impact/sdg-breakdown ────────────────────────────────────────────────

describe('GET /impact/sdg-breakdown', () => {
  beforeEach(() => {
    Transaction.create({ id: 't1', amount: 100, donor: 'A', recipient: 'B', sdgCategories: ['SDG1', 'SDG3'], timestamp: '2026-01-15T00:00:00Z', status: 'confirmed' });
    Transaction.create({ id: 't2', amount: 50,  donor: 'A', recipient: 'B', sdgCategories: ['SDG1'],         timestamp: '2026-01-20T00:00:00Z', status: 'confirmed' });
    Transaction.create({ id: 't3', amount: 25,  donor: 'A', recipient: 'B', sdgCategories: ['SDG13'],        timestamp: '2026-02-01T00:00:00Z', status: 'confirmed' });
  });

  it('returns 200 with breakdown array of 17 entries', async () => {
    const res = await request(app).get('/impact/sdg-breakdown').set('X-API-Key', 'test-key-1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.breakdown).toHaveLength(17);
  });

  it('returns accurate totals for SDG1', async () => {
    const res = await request(app).get('/impact/sdg-breakdown').set('X-API-Key', 'test-key-1');
    const sdg1 = res.body.data.breakdown.find(s => s.code === 'SDG1');
    expect(sdg1.totalAmount).toBeCloseTo(150);
    expect(sdg1.count).toBe(2);
  });

  it('returns accurate totals for SDG3', async () => {
    const res = await request(app).get('/impact/sdg-breakdown').set('X-API-Key', 'test-key-1');
    const sdg3 = res.body.data.breakdown.find(s => s.code === 'SDG3');
    expect(sdg3.totalAmount).toBeCloseTo(100);
    expect(sdg3.count).toBe(1);
  });

  it('returns zero for SDGs with no donations', async () => {
    const res = await request(app).get('/impact/sdg-breakdown').set('X-API-Key', 'test-key-1');
    const sdg2 = res.body.data.breakdown.find(s => s.code === 'SDG2');
    expect(sdg2.totalAmount).toBe(0);
    expect(sdg2.count).toBe(0);
  });

  it('filters by startDate', async () => {
    const res = await request(app)
      .get('/impact/sdg-breakdown')
      .set('X-API-Key', 'test-key-1')
      .query({ startDate: '2026-02-01' });

    const sdg1 = res.body.data.breakdown.find(s => s.code === 'SDG1');
    expect(sdg1.count).toBe(0); // t1 and t2 are before Feb
    expect(res.body.data.totalDonations).toBe(1);
  });

  it('filters by endDate', async () => {
    const res = await request(app)
      .get('/impact/sdg-breakdown')
      .set('X-API-Key', 'test-key-1')
      .query({ endDate: '2026-01-31' });

    expect(res.body.data.totalDonations).toBe(2);
  });
});

// ─── GET /impact/report ───────────────────────────────────────────────────────

describe('GET /impact/report', () => {
  beforeEach(() => {
    Transaction.create({ id: 'r1', amount: 200, donor: 'A', recipient: 'B', sdgCategories: ['SDG4'], timestamp: '2026-03-01T00:00:00Z', status: 'confirmed' });
    Transaction.create({ id: 'r2', amount: 80,  donor: 'A', recipient: 'B', sdgCategories: ['SDG4', 'SDG7'], timestamp: '2026-03-10T00:00:00Z', status: 'confirmed' });
    Transaction.create({ id: 'r3', amount: 30,  donor: 'A', recipient: 'B', sdgCategories: [],              timestamp: '2026-03-15T00:00:00Z', status: 'confirmed' });
  });

  it('returns 200 with structured report', async () => {
    const res = await request(app).get('/impact/report').set('X-API-Key', 'test-key-1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('summary');
    expect(res.body.data).toHaveProperty('sdgBreakdown');
    expect(res.body.data).toHaveProperty('topSdgs');
    expect(res.body.data).toHaveProperty('generatedAt');
  });

  it('summary has correct totals', async () => {
    const res = await request(app).get('/impact/report').set('X-API-Key', 'test-key-1');
    const { summary } = res.body.data;
    expect(summary.totalDonations).toBe(3);
    expect(summary.totalAmount).toBeCloseTo(310);
    expect(summary.taggedDonations).toBe(2);
    expect(summary.activeSdgCount).toBeGreaterThanOrEqual(2);
  });

  it('topSdgs contains at most 5 entries sorted by totalAmount desc', async () => {
    const res = await request(app).get('/impact/report').set('X-API-Key', 'test-key-1');
    const { topSdgs } = res.body.data;
    expect(topSdgs.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < topSdgs.length; i++) {
      expect(topSdgs[i - 1].totalAmount).toBeGreaterThanOrEqual(topSdgs[i].totalAmount);
    }
  });

  it('filters by date range', async () => {
    const res = await request(app)
      .get('/impact/report')
      .set('X-API-Key', 'test-key-1')
      .query({ startDate: '2026-03-10', endDate: '2026-03-10' });

    expect(res.body.data.summary.totalDonations).toBe(1);
  });
});

// ─── POST /impact/report/export ───────────────────────────────────────────────

describe('POST /impact/report/export', () => {
  beforeEach(() => {
    Transaction.create({ id: 'e1', amount: 50, donor: 'A', recipient: 'B', sdgCategories: ['SDG2'], timestamp: '2026-01-01T00:00:00Z', status: 'confirmed' });
  });

  it('exports CSV with correct Content-Type', async () => {
    const res = await request(app)
      .post('/impact/report/export')
      .set('X-API-Key', 'test-key-1')
      .send({ format: 'csv' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/\.csv/);
    expect(res.text).toContain('SDG Code');
    expect(res.text).toContain('SDG2');
  });

  it('CSV contains correct totals for tagged SDG', async () => {
    const res = await request(app)
      .post('/impact/report/export')
      .set('X-API-Key', 'test-key-1')
      .send({ format: 'csv' });

    expect(res.text).toContain('SDG2');
    expect(res.text).toContain('50.0000000');
  });

  it('exports PDF with correct Content-Type', async () => {
    const res = await request(app)
      .post('/impact/report/export')
      .set('X-API-Key', 'test-key-1')
      .send({ format: 'pdf' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toMatch(/\.pdf/);
  });

  it('defaults to CSV when format not specified', async () => {
    const res = await request(app)
      .post('/impact/report/export')
      .set('X-API-Key', 'test-key-1')
      .send({});

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
  });

  it('returns 400 for invalid format', async () => {
    const res = await request(app)
      .post('/impact/report/export')
      .set('X-API-Key', 'test-key-1')
      .send({ format: 'xlsx' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 without API key', async () => {
    const res = await request(app)
      .post('/impact/report/export')
      .send({ format: 'csv' });

    expect(res.status).toBe(401);
  });

  it('filters export by date range', async () => {
    Transaction.create({ id: 'e2', amount: 999, donor: 'A', recipient: 'B', sdgCategories: ['SDG5'], timestamp: '2025-01-01T00:00:00Z', status: 'confirmed' });

    const res = await request(app)
      .post('/impact/report/export')
      .set('X-API-Key', 'test-key-1')
      .send({ format: 'csv', startDate: '2026-01-01', endDate: '2026-12-31' });

    expect(res.status).toBe(200);
    // SDG5 from 2025 should not appear with significant amount
    const sdg5Line = res.text.split('\n').find(l => l.startsWith('SDG5,'));
    expect(sdg5Line).toContain('0.0000000');
  });
});
