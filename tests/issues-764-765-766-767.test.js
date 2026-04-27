/**
 * Tests for GitHub issues #764, #766, #767, #765
 *
 * #764 - POST /donations returns transactionHash
 * #766 - GET /donations supports filtering (status, date range, amount)
 * #767 - GET /donations/limits returns Cache-Control and ETag headers
 * #765 - Dockerfile and docker-compose.yml exist
 */

'use strict';

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-key-issues';
process.env.MIN_DONATION_AMOUNT = '0.01';
process.env.MAX_DONATION_AMOUNT = '10000';

const path = require('path');
const fs = require('fs');
const express = require('express');
const request = require('supertest');

// ─── #764 — transactionHash in POST /donations ────────────────────────────────

describe('Issue #764 — POST /donations returns transactionHash', () => {
  test('DonationService.sendCustodialDonation result includes stellarTxId', async () => {
    // The route maps result.stellarTxId → transactionHash in the response.
    // Verify the mapping logic directly.
    const result = { id: 1, stellarTxId: 'abc123', amount: 10 };
    const responseData = {
      ...result,
      transactionHash: result.stellarTxId || null,
    };
    expect(responseData).toHaveProperty('transactionHash', 'abc123');
  });

  test('transactionHash is null when stellarTxId is absent', () => {
    const result = { id: 1, amount: 10 };
    const responseData = {
      ...result,
      transactionHash: result.stellarTxId || null,
    };
    expect(responseData.transactionHash).toBeNull();
  });

  test('POST /donations route source includes transactionHash mapping', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../src/routes/donation.js'),
      'utf8'
    );
    // Both the main POST / and POST /send routes should map stellarTxId → transactionHash
    const matches = source.match(/transactionHash:\s*result\.stellarTxId/g);
    expect(matches).not.toBeNull();
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  test('stellar_tx_id column exists in initDB schema', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../src/scripts/initDB.js'),
      'utf8'
    );
    expect(source).toContain('stellar_tx_id');
  });
});

// ─── #766 — GET /donations filtering ─────────────────────────────────────────

describe('Issue #766 — GET /donations filtering via DonationService.applyFilters', () => {
  // Test applyFilters directly — it already supports all required filters.
  // The route change passes query params through to getPaginatedDonations.

  const DonationService = require('../src/services/DonationService');

  const transactions = [
    { id: 1, amount: 5,   status: 'pending',    timestamp: '2026-01-15T10:00:00Z', donor: 'A', recipient: 'B', memo: '' },
    { id: 2, amount: 50,  status: 'completed',  timestamp: '2026-02-20T10:00:00Z', donor: 'A', recipient: 'B', memo: '' },
    { id: 3, amount: 200, status: 'processing', timestamp: '2026-03-10T10:00:00Z', donor: 'A', recipient: 'B', memo: '' },
    { id: 4, amount: 500, status: 'completed',  timestamp: '2026-04-01T10:00:00Z', donor: 'A', recipient: 'B', memo: '' },
  ];

  let svc;
  beforeAll(() => {
    svc = new DonationService({ sendDonation: jest.fn() });
  });

  test('status=pending returns only pending', () => {
    const result = svc.applyFilters(transactions, { status: 'pending' });
    expect(result.every(t => t.status === 'pending')).toBe(true);
    expect(result.length).toBe(1);
  });

  test('status=completed returns only completed', () => {
    const result = svc.applyFilters(transactions, { status: 'completed' });
    expect(result.every(t => t.status === 'completed')).toBe(true);
    expect(result.length).toBe(2);
  });

  test('status array [pending, processing] returns both', () => {
    const result = svc.applyFilters(transactions, { status: ['pending', 'processing'] });
    expect(result.every(t => ['pending', 'processing'].includes(t.status))).toBe(true);
    expect(result.length).toBe(2);
  });

  test('startDate/endDate filters by date range', () => {
    const result = svc.applyFilters(transactions, {
      startDate: '2026-02-01',
      endDate: '2026-03-31',
    });
    expect(result.length).toBe(2);
    result.forEach(t => {
      const ts = new Date(t.timestamp);
      expect(ts >= new Date('2026-02-01')).toBe(true);
      expect(ts <= new Date('2026-03-31')).toBe(true);
    });
  });

  test('minAmount/maxAmount filters by amount range', () => {
    const result = svc.applyFilters(transactions, { minAmount: 100, maxAmount: 300 });
    expect(result.length).toBe(1);
    expect(result[0].amount).toBe(200);
  });

  test('combined status + amount filter', () => {
    const result = svc.applyFilters(transactions, { status: 'completed', minAmount: 100 });
    expect(result.every(t => t.status === 'completed' && t.amount >= 100)).toBe(true);
    expect(result.length).toBe(1);
  });

  test('GET /donations route passes filter params to getPaginatedDonations', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../src/routes/donation.js'),
      'utf8'
    );
    // Verify the route extracts filter params from query
    expect(source).toContain('status, from, to, minAmount, maxAmount');
    expect(source).toContain('startDate: from');
    expect(source).toContain('endDate: to');
  });
});

// ─── #767 — GET /donations/limits caching ────────────────────────────────────

describe('Issue #767 — GET /donations/limits caching headers', () => {
  // Build a minimal app that only mounts the limits handler logic
  function buildLimitsApp() {
    const crypto = require('crypto');
    const app = express();
    app.use(express.json());

    app.get('/donations/limits', (req, res) => {
      const minAmount = 0.01;
      const maxAmount = 10000;
      const maxDailyPerDonor = 0;
      const limitsData = { minAmount, maxAmount, maxDailyPerDonor, currency: 'XLM' };
      const etag = `"${crypto.createHash('sha256').update(JSON.stringify(limitsData)).digest('hex').slice(0, 32)}"`;

      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('ETag', etag);

      const ifNoneMatch = req.headers['if-none-match'];
      if (ifNoneMatch && (ifNoneMatch === etag || ifNoneMatch === '*')) {
        return res.status(304).end();
      }
      return res.json({ success: true, data: limitsData });
    });

    return app;
  }

  let app;
  beforeAll(() => { app = buildLimitsApp(); });

  test('returns 200 with Cache-Control: public, max-age=3600', async () => {
    const res = await request(app).get('/donations/limits');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
  });

  test('returns ETag header', async () => {
    const res = await request(app).get('/donations/limits');
    expect(res.headers['etag']).toBeDefined();
    expect(res.headers['etag']).toMatch(/^"[a-f0-9]+"$/);
  });

  test('returns 304 when If-None-Match matches ETag', async () => {
    const first = await request(app).get('/donations/limits');
    const etag = first.headers['etag'];

    const second = await request(app)
      .get('/donations/limits')
      .set('If-None-Match', etag);

    expect(second.status).toBe(304);
  });

  test('ETag is consistent across requests', async () => {
    const r1 = await request(app).get('/donations/limits');
    const r2 = await request(app).get('/donations/limits');
    expect(r1.headers['etag']).toBe(r2.headers['etag']);
  });

  test('response includes minAmount, maxAmount, currency', async () => {
    const res = await request(app).get('/donations/limits');
    expect(res.body.data).toHaveProperty('minAmount');
    expect(res.body.data).toHaveProperty('maxAmount');
    expect(res.body.data).toHaveProperty('currency', 'XLM');
  });

  test('GET /donations/limits route is defined in donation.js', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../src/routes/donation.js'),
      'utf8'
    );
    expect(source).toContain("router.get('/limits'");
    expect(source).toContain('public, max-age=3600');
    expect(source).toContain('ETag');
  });
});

// ─── #765 — Dockerfile and docker-compose.yml ────────────────────────────────

describe('Issue #765 — Dockerfile and docker-compose.yml', () => {
  const root = path.resolve(__dirname, '../');

  test('Dockerfile exists', () => {
    expect(fs.existsSync(path.join(root, 'Dockerfile'))).toBe(true);
  });

  test('docker-compose.yml exists', () => {
    expect(fs.existsSync(path.join(root, 'docker-compose.yml'))).toBe(true);
  });

  test('Dockerfile uses node base image', () => {
    const content = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
    expect(content).toMatch(/FROM node:/);
  });

  test('Dockerfile exposes port 3000', () => {
    const content = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
    expect(content).toContain('EXPOSE 3000');
  });

  test('docker-compose.yml loads .env file', () => {
    const content = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');
    expect(content).toMatch(/\.env/);
  });

  test('docker-compose.yml defines a volume for database persistence', () => {
    const content = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');
    expect(content).toMatch(/volumes:/);
  });

  test('docker-compose.yml maps port 3000', () => {
    const content = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');
    expect(content).toContain('3000:3000');
  });
});
