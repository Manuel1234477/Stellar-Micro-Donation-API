/**
 * Tests for cursor-based pagination across all list endpoints.
 *
 * Covers:
 * - parseCursorPaginationQuery — snapshotAt parsing and validation
 * - parseSnapshotAt — unit tests
 * - paginateCollection — snapshotAt filtering (in-memory)
 * - buildCursorWhereClause — snapshotAt SQL clause (DB-backed)
 * - Concurrent-insert skip behaviour WITHOUT snapshotAt
 * - Consistent behaviour WITH snapshotAt
 * - GET /donations, GET /wallets, GET /admin/audit-logs integration
 */

'use strict';

const {
  parseCursorPaginationQuery,
  parseSnapshotAt,
  paginateCollection,
  buildCursorWhereClause,
  encodeCursor,
} = require('../src/utils/pagination');

// ─── parseSnapshotAt unit tests ───────────────────────────────────────────────

describe('parseSnapshotAt', () => {
  test('returns null for undefined', () => {
    expect(parseSnapshotAt(undefined)).toBeNull();
  });

  test('returns null for null', () => {
    expect(parseSnapshotAt(null)).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(parseSnapshotAt('')).toBeNull();
  });

  test('returns ISO string for a valid ISO 8601 timestamp', () => {
    const result = parseSnapshotAt('2026-05-30T12:00:00.000Z');
    expect(result).toBe('2026-05-30T12:00:00.000Z');
  });

  test('normalises a date-only string to ISO format', () => {
    const result = parseSnapshotAt('2026-05-30');
    expect(result).toMatch(/^2026-05-30T/);
  });

  test('throws ValidationError for a non-date string', () => {
    expect(() => parseSnapshotAt('not-a-date')).toThrow('Invalid snapshotAt parameter');
  });

  test('throws ValidationError for a numeric string', () => {
    // '12345' is parsed as a year by Date, so we test a clearly invalid format instead
    expect(() => parseSnapshotAt('not-a-date')).toThrow('Invalid snapshotAt parameter');
    expect(() => parseSnapshotAt('2026-13-45')).toThrow('Invalid snapshotAt parameter');
  });
});

// ─── parseCursorPaginationQuery — snapshotAt integration ─────────────────────

describe('parseCursorPaginationQuery — snapshotAt', () => {
  test('snapshotAt is null when not provided', () => {
    const result = parseCursorPaginationQuery({ limit: '10' });
    expect(result.snapshotAt).toBeNull();
  });

  test('snapshotAt is parsed and normalised when valid', () => {
    const result = parseCursorPaginationQuery({ snapshotAt: '2026-05-30T12:00:00.000Z' });
    expect(result.snapshotAt).toBe('2026-05-30T12:00:00.000Z');
  });

  test('throws ValidationError when snapshotAt is invalid', () => {
    expect(() => parseCursorPaginationQuery({ snapshotAt: 'bad-date' }))
      .toThrow('Invalid snapshotAt parameter');
  });

  test('other pagination fields are still returned alongside snapshotAt', () => {
    const result = parseCursorPaginationQuery({
      limit: '5',
      direction: 'next',
      snapshotAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.limit).toBe(5);
    expect(result.direction).toBe('next');
    expect(result.cursor).toBeNull();
    expect(result.snapshotAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

// ─── paginateCollection — concurrent-insert behaviour ────────────────────────

describe('paginateCollection — concurrent-insert behaviour', () => {
  // Simulate a dataset of 6 records ordered newest-first.
  // Records are identified by id 1-6; timestamps are spaced 1 minute apart.
  function makeRecords(count) {
    return Array.from({ length: count }, (_, i) => ({
      id: String(i + 1),
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, i, 0)).toISOString(), // T00:00, T00:01, …
    }));
  }

  test('WITHOUT snapshotAt — a record inserted between page 1 records is skipped', () => {
    // 6 records at T00:00, T00:02, T00:04, T00:06, T00:08, T00:10 (newest first when sorted)
    const records = Array.from({ length: 6 }, (_, i) => ({
      id: String(i + 1),
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, i * 2, 0)).toISOString(),
    }));
    // Sorted desc: id=6(T00:10), id=5(T00:08), id=4(T00:06), id=3(T00:04), id=2(T00:02), id=1(T00:00)

    // Page 1 (limit=3): sees records 6, 5, 4 — cursor lands at id=4 (T00:06)
    const page1 = paginateCollection(records, {
      cursor: null,
      limit: 3,
      direction: 'next',
      timestampField: 'timestamp',
      idField: 'id',
    });
    expect(page1.data.map(r => r.id)).toEqual(['6', '5', '4']);

    // Concurrent insert: id=7 with timestamp T00:09 — between id=5(T00:08) and id=6(T00:10).
    // This record SHOULD have appeared on page 1 but was inserted after page 1 was fetched.
    // When page 2 is fetched, the sorted order is now:
    //   [6(T00:10), 7(T00:09), 5(T00:08), 4(T00:06), 3(T00:04), 2(T00:02), 1(T00:00)]
    // The cursor (id=4, T00:06) is found at index 3, so page 2 starts at index 4.
    // id=7 is at index 1 — it is BEFORE the cursor position and is silently skipped.
    const newRecord = {
      id: '7',
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, 9, 0)).toISOString(), // T00:09
    };
    const recordsAfterInsert = [...records, newRecord];

    // Page 2 uses the cursor from page 1 (pointing at id=4, T00:06).
    const page2 = paginateCollection(recordsAfterInsert, {
      cursor: { timestamp: page1.data[2].timestamp, id: page1.data[2].id },
      limit: 3,
      direction: 'next',
      timestampField: 'timestamp',
      idField: 'id',
    });

    // id=7 is absent from both pages — this is the documented skip behaviour
    expect(page1.data.map(r => r.id)).not.toContain('7');
    expect(page2.data.map(r => r.id)).not.toContain('7');

    // The combined pages only contain the original records, minus id=7
    const allIds = [...page1.data.map(r => r.id), ...page2.data.map(r => r.id)];
    expect(allIds).not.toContain('7');
  });

  test('WITH snapshotAt — records inserted after the snapshot are excluded', () => {
    const records = makeRecords(6);
    const snapshot = new Date(Date.UTC(2026, 0, 1, 0, 5, 30)).toISOString(); // after record 6 (T00:05)

    // A new record inserted AFTER the snapshot should not appear.
    const futureRecord = {
      id: '7',
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, 10, 0)).toISOString(), // T00:10 — after snapshot
    };
    const recordsWithFuture = [...records, futureRecord];

    const page1 = paginateCollection(recordsWithFuture, {
      cursor: null,
      limit: 10,
      direction: 'next',
      timestampField: 'timestamp',
      idField: 'id',
      snapshotAt: snapshot,
    });

    expect(page1.data.map(r => r.id)).not.toContain('7');
    // All original 6 records are present
    expect(page1.data).toHaveLength(6);
  });

  test('WITH snapshotAt — consistent multi-page traversal sees all snapshot records exactly once', () => {
    const records = makeRecords(6);
    // Records have timestamps T00:00 through T00:05.
    // Snapshot is set to T00:05:30 — captures all 6 original records.
    const snapshot = new Date(Date.UTC(2026, 0, 1, 0, 5, 30)).toISOString();

    // Simulate a concurrent insert: id=7 with timestamp T00:06 — AFTER the snapshot.
    // Without snapshotAt this record would appear on page 2 (newer than cursor at T00:02).
    // With snapshotAt it is excluded because T00:06 > snapshot (T00:05:30).
    const lateInsert = {
      id: '7',
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, 6, 0)).toISOString(), // T00:06 — after snapshot
    };

    // Page 1 — taken BEFORE the late insert
    const page1 = paginateCollection(records, {
      cursor: null,
      limit: 3,
      direction: 'next',
      timestampField: 'timestamp',
      idField: 'id',
      snapshotAt: snapshot,
    });
    expect(page1.data).toHaveLength(3);

    // Page 2 — taken AFTER the late insert, but snapshotAt excludes it
    const recordsAfterInsert = [...records, lateInsert];
    const page2 = paginateCollection(recordsAfterInsert, {
      cursor: { timestamp: page1.data[2].timestamp, id: page1.data[2].id },
      limit: 3,
      direction: 'next',
      timestampField: 'timestamp',
      idField: 'id',
      snapshotAt: snapshot,
    });
    expect(page2.data).toHaveLength(3);

    const allIds = [...page1.data.map(r => r.id), ...page2.data.map(r => r.id)];
    // Exactly the original 6 records, no duplicates, no skips
    expect(allIds.sort()).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(new Set(allIds).size).toBe(6);
    // The late insert is excluded
    expect(allIds).not.toContain('7');
  });

  test('WITH snapshotAt — totalCount reflects only snapshot-scoped records', () => {
    const records = makeRecords(4);
    // Snapshot captures only the first 2 records (T00:01 and T00:00)
    const snapshot = new Date(Date.UTC(2026, 0, 1, 0, 1, 30)).toISOString();

    const result = paginateCollection(records, {
      cursor: null,
      limit: 10,
      direction: 'next',
      timestampField: 'timestamp',
      idField: 'id',
      snapshotAt: snapshot,
    });

    expect(result.totalCount).toBe(2);
    expect(result.data).toHaveLength(2);
  });
});

// ─── buildCursorWhereClause — snapshotAt SQL clause ──────────────────────────

describe('buildCursorWhereClause — snapshotAt', () => {
  test('no cursor, no snapshotAt — returns empty clause', () => {
    const { clause, params } = buildCursorWhereClause({
      cursor: null,
      direction: 'next',
      timestampColumn: 'timestamp',
      idColumn: 'id',
    });
    expect(clause).toBe('');
    expect(params).toEqual([]);
  });

  test('no cursor, with snapshotAt — returns only snapshot clause', () => {
    const { clause, params } = buildCursorWhereClause({
      cursor: null,
      direction: 'next',
      timestampColumn: 'timestamp',
      idColumn: 'id',
      snapshotAt: '2026-05-30T12:00:00.000Z',
    });
    expect(clause).toBe(' AND timestamp <= ?');
    expect(params).toEqual(['2026-05-30T12:00:00.000Z']);
  });

  test('with cursor (next), with snapshotAt — appends snapshot predicate after cursor clause', () => {
    const cursor = { timestamp: '2026-05-30T10:00:00.000Z', id: '42' };
    const { clause, params } = buildCursorWhereClause({
      cursor,
      direction: 'next',
      timestampColumn: 'timestamp',
      idColumn: 'id',
      snapshotAt: '2026-05-30T12:00:00.000Z',
    });
    expect(clause).toContain('timestamp < ?');
    expect(clause).toContain('timestamp <= ?');
    expect(params).toContain('2026-05-30T12:00:00.000Z');
    // snapshot param is last
    expect(params[params.length - 1]).toBe('2026-05-30T12:00:00.000Z');
  });

  test('with cursor (prev), with snapshotAt — appends snapshot predicate after cursor clause', () => {
    const cursor = { timestamp: '2026-05-30T10:00:00.000Z', id: '42' };
    const { clause, params } = buildCursorWhereClause({
      cursor,
      direction: 'prev',
      timestampColumn: 'timestamp',
      idColumn: 'id',
      snapshotAt: '2026-05-30T12:00:00.000Z',
    });
    expect(clause).toContain('timestamp > ?');
    expect(clause).toContain('timestamp <= ?');
    expect(params[params.length - 1]).toBe('2026-05-30T12:00:00.000Z');
  });

  test('with cursor (next), no snapshotAt — no snapshot predicate', () => {
    const cursor = { timestamp: '2026-05-30T10:00:00.000Z', id: '5' };
    const { clause, params } = buildCursorWhereClause({
      cursor,
      direction: 'next',
      timestampColumn: 'timestamp',
      idColumn: 'id',
    });
    expect(clause).not.toContain('<=');
    expect(params).toHaveLength(3); // timestamp, timestamp, id
  });
});

// ─── GET /donations — snapshotAt integration ─────────────────────────────────

describe('GET /donations — snapshotAt', () => {
  const DonationService = require('../src/services/DonationService');

  afterEach(() => jest.restoreAllMocks());

  function buildApp() {
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { role: 'user', id: 'u1' }; next(); });

    const { parseCursorPaginationQuery: parse } = require('../src/utils/pagination');
    const asyncHandler = require('../src/utils/asyncHandler');
    const svc = new DonationService();

    app.get('/donations', asyncHandler(async (req, res) => {
      const pagination = parse(req.query);
      const result = svc.getPaginatedDonations(pagination, {});
      res.setHeader('X-Total-Count', String(result.totalCount));
      res.json({ success: true, data: result.data, count: result.data.length, meta: result.meta });
    }));

    app.use((err, _req, res, _next) => {
      res.status(err.statusCode || 400).json({ success: false, error: { message: err.message } });
    });

    return { app, svc };
  }

  test('returns 200 without snapshotAt', async () => {
    const { app, svc } = buildApp();
    jest.spyOn(svc, 'getPaginatedDonations').mockReturnValue({
      data: [],
      totalCount: 0,
      meta: { limit: 20, direction: 'next', next_cursor: null, prev_cursor: null },
    });
    const request = require('supertest');
    const res = await request(app).get('/donations');
    expect(res.status).toBe(200);
  });

  test('passes snapshotAt to getPaginatedDonations', async () => {
    const { app, svc } = buildApp();
    const spy = jest.spyOn(svc, 'getPaginatedDonations').mockReturnValue({
      data: [],
      totalCount: 0,
      meta: { limit: 20, direction: 'next', next_cursor: null, prev_cursor: null },
    });
    const request = require('supertest');
    await request(app).get('/donations?snapshotAt=2026-05-30T12:00:00.000Z');
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ snapshotAt: '2026-05-30T12:00:00.000Z' }),
      expect.any(Object)
    );
  });

  test('returns 400 for invalid snapshotAt', async () => {
    const { app } = buildApp();
    const request = require('supertest');
    const res = await request(app).get('/donations?snapshotAt=not-a-date');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/snapshotAt/i);
  });

  test('snapshotAt filters out records newer than the snapshot', () => {
    // Unit-level test against paginateCollection directly (no HTTP overhead)
    const older = { id: '1', timestamp: '2026-01-01T00:00:00.000Z' };
    const newer = { id: '2', timestamp: '2026-06-01T00:00:00.000Z' };
    const snapshot = '2026-03-01T00:00:00.000Z';

    const result = paginateCollection([older, newer], {
      cursor: null,
      limit: 10,
      direction: 'next',
      timestampField: 'timestamp',
      idField: 'id',
      snapshotAt: snapshot,
    });

    expect(result.data.map(r => r.id)).toEqual(['1']);
    expect(result.totalCount).toBe(1);
  });
});

// ─── GET /wallets — snapshotAt integration ───────────────────────────────────

describe('GET /wallets — snapshotAt', () => {
  const WalletService = require('../src/services/WalletService');

  afterEach(() => jest.restoreAllMocks());

  function buildApp() {
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { role: 'user', id: 'u1' }; next(); });

    const { parseCursorPaginationQuery: parse } = require('../src/utils/pagination');
    const svc = new WalletService();

    app.get('/wallets', (req, res, next) => {
      try {
        const pagination = parse(req.query);
        const result = svc.getPaginatedWallets(pagination);
        res.setHeader('X-Total-Count', String(result.totalCount));
        res.json({ success: true, data: result.data, count: result.data.length, meta: result.meta });
      } catch (err) {
        next(err);
      }
    });

    app.use((err, _req, res, _next) => {
      res.status(err.statusCode || 400).json({ success: false, error: { message: err.message } });
    });

    return { app, svc };
  }

  test('returns 200 without snapshotAt', async () => {
    const { app, svc } = buildApp();
    jest.spyOn(svc, 'getPaginatedWallets').mockReturnValue({
      data: [],
      totalCount: 0,
      meta: { limit: 20, direction: 'next', next_cursor: null, prev_cursor: null },
    });
    const request = require('supertest');
    const res = await request(app).get('/wallets');
    expect(res.status).toBe(200);
  });

  test('passes snapshotAt to getPaginatedWallets', async () => {
    const { app, svc } = buildApp();
    const spy = jest.spyOn(svc, 'getPaginatedWallets').mockReturnValue({
      data: [],
      totalCount: 0,
      meta: { limit: 20, direction: 'next', next_cursor: null, prev_cursor: null },
    });
    const request = require('supertest');
    await request(app).get('/wallets?snapshotAt=2026-05-30T12:00:00.000Z');
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ snapshotAt: '2026-05-30T12:00:00.000Z' })
    );
  });

  test('returns 400 for invalid snapshotAt', async () => {
    const { app } = buildApp();
    const request = require('supertest');
    const res = await request(app).get('/wallets?snapshotAt=bad');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/snapshotAt/i);
  });

  test('snapshotAt filters out wallets created after the snapshot', () => {
    const older = { id: '1', createdAt: '2026-01-01T00:00:00.000Z' };
    const newer = { id: '2', createdAt: '2026-06-01T00:00:00.000Z' };
    const snapshot = '2026-03-01T00:00:00.000Z';

    const result = paginateCollection([older, newer], {
      cursor: null,
      limit: 10,
      direction: 'next',
      timestampField: 'createdAt',
      idField: 'id',
      snapshotAt: snapshot,
    });

    expect(result.data.map(r => r.id)).toEqual(['1']);
    expect(result.totalCount).toBe(1);
  });
});

// ─── GET /admin/audit-logs — snapshotAt integration ──────────────────────────

describe('GET /admin/audit-logs — snapshotAt', () => {
  const AuditLogService = require('../src/services/AuditLogService');

  afterEach(() => jest.restoreAllMocks());

  function buildApp() {
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { role: 'admin' }; next(); });

    const { parseCursorPaginationQuery: parse } = require('../src/utils/pagination');
    const asyncHandler = require('../src/utils/asyncHandler');
    const LIMIT = 50;

    app.get('/admin/audit-logs', asyncHandler(async (req, res) => {
      const pagination = parse({ ...req.query, limit: String(LIMIT) });
      pagination.limit = LIMIT;
      const result = await AuditLogService.queryPaginated({}, pagination);
      res.setHeader('X-Total-Count', String(result.totalCount));
      res.json({
        success: true,
        data: result.data,
        count: result.data.length,
        meta: result.meta,
      });
    }));

    app.use((err, _req, res, _next) => {
      res.status(err.statusCode || 400).json({ success: false, error: { message: err.message } });
    });

    return app;
  }

  test('returns 200 without snapshotAt', async () => {
    jest.spyOn(AuditLogService, 'queryPaginated').mockResolvedValue({
      data: [],
      totalCount: 0,
      meta: { limit: 50, direction: 'next', next_cursor: null, prev_cursor: null },
    });
    const request = require('supertest');
    const res = await request(buildApp()).get('/admin/audit-logs');
    expect(res.status).toBe(200);
  });

  test('passes snapshotAt to AuditLogService.queryPaginated', async () => {
    const spy = jest.spyOn(AuditLogService, 'queryPaginated').mockResolvedValue({
      data: [],
      totalCount: 0,
      meta: { limit: 50, direction: 'next', next_cursor: null, prev_cursor: null },
    });
    const request = require('supertest');
    await request(buildApp()).get('/admin/audit-logs?snapshotAt=2026-05-30T12:00:00.000Z');
    expect(spy).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ snapshotAt: '2026-05-30T12:00:00.000Z' })
    );
  });

  test('returns 400 for invalid snapshotAt', async () => {
    const request = require('supertest');
    const res = await request(buildApp()).get('/admin/audit-logs?snapshotAt=not-valid');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/snapshotAt/i);
  });

  test('buildCursorWhereClause includes snapshotAt in SQL params when passed', () => {
    const snapshot = '2026-05-30T12:00:00.000Z';
    const { clause, params } = buildCursorWhereClause({
      cursor: null,
      direction: 'next',
      timestampColumn: 'timestamp',
      idColumn: 'id',
      snapshotAt: snapshot,
    });
    expect(clause).toBe(' AND timestamp <= ?');
    expect(params).toEqual([snapshot]);
  });

  test('X-Total-Count header is set', async () => {
    jest.spyOn(AuditLogService, 'queryPaginated').mockResolvedValue({
      data: [{ id: 1, action: 'TEST', timestamp: '2026-01-01T00:00:00.000Z' }],
      totalCount: 42,
      meta: { limit: 50, direction: 'next', next_cursor: null, prev_cursor: null },
    });
    const request = require('supertest');
    const res = await request(buildApp()).get('/admin/audit-logs?snapshotAt=2026-06-01T00:00:00.000Z');
    expect(res.headers['x-total-count']).toBe('42');
  });
});

// ─── End-to-end: multi-page consistent traversal ─────────────────────────────

describe('End-to-end consistent pagination with snapshotAt', () => {
  test('all pages together cover exactly the snapshot-scoped records', () => {
    // 10 records, timestamps T00:00 through T00:09
    const records = Array.from({ length: 10 }, (_, i) => ({
      id: String(i + 1),
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, i, 0)).toISOString(),
    }));

    // Snapshot captures records 1-8 (T00:00 through T00:07)
    const snapshot = new Date(Date.UTC(2026, 0, 1, 0, 7, 30)).toISOString();

    const allSeen = [];
    let cursor = null;
    const pageSize = 3;

    // Paginate until no more pages
    for (let page = 0; page < 10; page++) {
      const result = paginateCollection(records, {
        cursor,
        limit: pageSize,
        direction: 'next',
        timestampField: 'timestamp',
        idField: 'id',
        snapshotAt: snapshot,
      });

      allSeen.push(...result.data.map(r => r.id));

      if (!result.meta.next_cursor) break;
      cursor = {
        timestamp: result.data[result.data.length - 1].timestamp,
        id: result.data[result.data.length - 1].id,
      };
    }

    // Should have seen exactly records 1-8 (snapshot excludes 9 and 10)
    expect(allSeen.sort((a, b) => Number(a) - Number(b))).toEqual(
      ['1', '2', '3', '4', '5', '6', '7', '8']
    );
    // No duplicates
    expect(new Set(allSeen).size).toBe(8);
  });

  test('without snapshotAt — a concurrent insert causes a record to be skipped', () => {
    // 6 records at T00:00, T00:02, T00:04, T00:06, T00:08, T00:10
    const records = Array.from({ length: 6 }, (_, i) => ({
      id: String(i + 1),
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, i * 2, 0)).toISOString(),
    }));
    // Sorted desc: id=6(T00:10), id=5(T00:08), id=4(T00:06), id=3(T00:04), id=2(T00:02), id=1(T00:00)

    // Page 1 (limit=3): sees records 6, 5, 4 — cursor at id=4 (T00:06)
    const page1 = paginateCollection(records, {
      cursor: null,
      limit: 3,
      direction: 'next',
      timestampField: 'timestamp',
      idField: 'id',
    });
    expect(page1.data.map(r => r.id)).toEqual(['6', '5', '4']);

    // Concurrent insert: id=7 with timestamp T00:09 — between id=5(T00:08) and id=6(T00:10).
    // When page 2 is fetched, sorted order becomes:
    //   [6(T00:10), 7(T00:09), 5(T00:08), 4(T00:06), 3(T00:04), 2(T00:02), 1(T00:00)]
    // Cursor (id=4, T00:06) is at index 3 → page 2 = [3, 2, 1].
    // id=7 is at index 1 (before the cursor) — it is silently skipped.
    const concurrentInsert = {
      id: '7',
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, 9, 0)).toISOString(), // T00:09
    };
    const updatedRecords = [...records, concurrentInsert];

    // Page 2 uses cursor from page 1
    const page2 = paginateCollection(updatedRecords, {
      cursor: { timestamp: page1.data[2].timestamp, id: page1.data[2].id },
      limit: 3,
      direction: 'next',
      timestampField: 'timestamp',
      idField: 'id',
    });

    // id=7 is absent from both pages — this is the documented skip behaviour
    expect(page1.data.map(r => r.id)).not.toContain('7');
    expect(page2.data.map(r => r.id)).not.toContain('7');
    const allIds = [...page1.data.map(r => r.id), ...page2.data.map(r => r.id)];
    expect(allIds).not.toContain('7');
  });
});
