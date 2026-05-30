'use strict';

/**
 * Tests for GET /transactions date-range filtering (#905)
 *
 * Covers:
 *  - valid date range returns only matching transactions
 *  - reversed date range returns HTTP 400
 *  - invalid date format returns HTTP 400 with code INVALID_DATE_FORMAT (1004)
 *  - single-day range
 *  - range with no results
 *  - cursor-based pagination within a date range (cursor encodes the range)
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTransaction(overrides = {}) {
  return {
    id: overrides.id || `tx-${Math.random().toString(36).slice(2)}`,
    amount: overrides.amount || 10,
    donor: 'GABC',
    recipient: 'GXYZ',
    memo: '',
    status: 'confirmed',
    timestamp: overrides.timestamp || new Date().toISOString(),
    deleted_at: overrides.deleted_at || null,
  };
}

// ── Unit tests for Transaction.getCursorPaginated with date filters ───────────

describe('Transaction.getCursorPaginated — date range filtering', () => {
  let Transaction;
  let tmpPath;

  beforeEach(() => {
    jest.resetModules();

    // Write transactions to a temp file
    tmpPath = path.join(os.tmpdir(), `txn-test-${Date.now()}.json`);

    const transactions = [
      makeTransaction({ id: 'a', timestamp: '2026-01-05T12:00:00.000Z' }),
      makeTransaction({ id: 'b', timestamp: '2026-01-15T12:00:00.000Z' }),
      makeTransaction({ id: 'c', timestamp: '2026-01-25T12:00:00.000Z' }),
      makeTransaction({ id: 'd', timestamp: '2026-02-10T12:00:00.000Z' }),
      makeTransaction({ id: 'e', timestamp: '2026-03-01T12:00:00.000Z' }),
    ];

    fs.writeFileSync(tmpPath, JSON.stringify(transactions, null, 2));
    process.env.DB_JSON_PATH = tmpPath;

    Transaction = require('../../src/routes/models/transaction');
  });

  afterEach(() => {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    delete process.env.DB_JSON_PATH;
  });

  test('returns only transactions within January 2026', () => {
    const result = Transaction.getCursorPaginated({
      limit: 10,
      startDate: '2026-01-01T00:00:00.000Z',
      endDate:   '2026-01-31T23:59:59.999Z',
    });
    const ids = result.data.map(t => t.id);
    expect(ids).toContain('a');
    expect(ids).toContain('b');
    expect(ids).toContain('c');
    expect(ids).not.toContain('d');
    expect(ids).not.toContain('e');
  });

  test('single-day range returns only that day', () => {
    const result = Transaction.getCursorPaginated({
      limit: 10,
      startDate: '2026-01-15T00:00:00.000Z',
      endDate:   '2026-01-15T23:59:59.999Z',
    });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe('b');
  });

  test('range with no matching transactions returns empty array', () => {
    const result = Transaction.getCursorPaginated({
      limit: 10,
      startDate: '2025-01-01T00:00:00.000Z',
      endDate:   '2025-12-31T23:59:59.999Z',
    });
    expect(result.data).toHaveLength(0);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  test('cursor encodes date range for consistent pagination', () => {
    // Add more transactions so we exceed page size 2
    const extra = [
      makeTransaction({ id: 'f', timestamp: '2026-01-06T12:00:00.000Z' }),
      makeTransaction({ id: 'g', timestamp: '2026-01-07T12:00:00.000Z' }),
      makeTransaction({ id: 'h', timestamp: '2026-01-08T12:00:00.000Z' }),
    ];
    const existing = JSON.parse(fs.readFileSync(tmpPath, 'utf8'));
    fs.writeFileSync(tmpPath, JSON.stringify([...existing, ...extra], null, 2));

    const page1 = Transaction.getCursorPaginated({
      limit: 2,
      startDate: '2026-01-01T00:00:00.000Z',
      endDate:   '2026-01-31T23:59:59.999Z',
    });

    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).not.toBeNull();

    // Cursor should be a base64-JSON string containing the date range
    const decoded = JSON.parse(Buffer.from(page1.nextCursor, 'base64').toString('utf8'));
    expect(decoded.sd).toBe('2026-01-01T00:00:00.000Z');
    expect(decoded.ed).toBe('2026-01-31T23:59:59.999Z');

    // Fetch page 2 using ONLY the cursor (no repeated date params)
    const page2 = Transaction.getCursorPaginated({
      limit: 2,
      cursor: page1.nextCursor,
    });

    // All page-2 results must still be in January 2026
    page2.data.forEach(t => {
      const ts = new Date(t.timestamp).getTime();
      expect(ts).toBeGreaterThanOrEqual(new Date('2026-01-01T00:00:00.000Z').getTime());
      expect(ts).toBeLessThanOrEqual(new Date('2026-01-31T23:59:59.999Z').getTime());
    });
  });
});

// ── Integration tests for the HTTP route (minimal Express app) ───────────────

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-admin-key';

describe('GET /transactions — date range query parameter validation', () => {
  let app;
  let request;
  let tmpPath;

  beforeAll(() => {
    jest.resetModules();
    tmpPath = path.join(os.tmpdir(), `txn-route-test-${Date.now()}.json`);
    fs.writeFileSync(tmpPath, JSON.stringify([], null, 2));
    process.env.DB_JSON_PATH = tmpPath;
    process.env.NODE_ENV = 'test';

    const express = require('express');
    const transactionRouter = require('../../src/routes/transaction');

    // Minimal app — no authentication enforcement
    app = express();
    app.use(express.json());
    // Inject a mock user so checkPermission passes
    app.use((req, res, next) => {
      req.user = { role: 'admin' };
      req.apiKey = { id: 1, role: 'admin', key: 'test-admin-key' };
      next();
    });
    app.use('/transactions', transactionRouter);
    app.use((err, req, res, next) => {
      void next;
      res.status(err.statusCode || err.status || 500).json(err.toJSON ? err.toJSON() : { success: false, error: { message: err.message } });
    });

    request = require('supertest');
  });

  afterAll(() => {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    delete process.env.DB_JSON_PATH;
  });

  test('invalid startDate returns 400 with INVALID_DATE_FORMAT code', async () => {
    const res = await request(app)
      .get('/transactions?startDate=not-a-date');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_DATE_FORMAT');
    expect(res.body.error.numericCode).toBe(1004);
  });

  test('invalid endDate returns 400 with INVALID_DATE_FORMAT code', async () => {
    const res = await request(app)
      .get('/transactions?endDate=bad-date');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_DATE_FORMAT');
    expect(res.body.error.numericCode).toBe(1004);
  });

  test('startDate after endDate returns 400 with message "startDate must be before endDate"', async () => {
    const res = await request(app)
      .get('/transactions?startDate=2026-12-31&endDate=2026-01-01');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_DATE_RANGE');
    expect(res.body.error.message).toBe('startDate must be before endDate');
  });

  test('valid date range returns 200', async () => {
    const res = await request(app)
      .get('/transactions?startDate=2026-01-01&endDate=2026-01-31');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
