'use strict';

/**
 * Issue #1565: GET /wallets/:publicKey/transactions must use Horizon's native
 * cursor pagination when source=live, forward the paging_token cursor, return
 * next/prev cursors, and advertise that page/offset are deprecated.
 */

const request = require('supertest');
const db = require('../../src/utils/database');
const TransactionSyncService = require('../../src/services/TransactionSyncService');

const TEST_PK = 'GLIVECURSOR00000000000000000000000000000000000000000000001';

function buildApp() {
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 1, role: 'admin' };
    req.apiKey = { id: 1, role: 'admin' };
    next();
  });
  app.use('/wallets', require('../../src/routes/wallet'));
  app.use((err, req, res, next) => {
    void next;
    res.status(err.status || 500).json({ success: false, error: { code: err.code || 'ERROR', message: err.message } });
  });
  return app;
}

/**
 * Fake Horizon /accounts/:id/transactions honouring cursor, order and limit.
 * Records have paging_tokens 1..total (ascending by creation).
 */
function makeFakeHorizon(total) {
  const all = Array.from({ length: total }, (_, i) => ({
    id: `hash-${i + 1}`,
    paging_token: String(i + 1),
    source_account: TEST_PK,
    memo: `m${i + 1}`,
    created_at: new Date(1700000000000 + i * 1000).toISOString(),
    successful: true,
  }));
  return (publicKey, { limit, cursor, order }) => {
    void publicKey;
    let records = order === 'asc'
      ? all.filter((r) => !cursor || Number(r.paging_token) > Number(cursor))
      : all.filter((r) => !cursor || Number(r.paging_token) < Number(cursor));
    records = order === 'asc' ? records.slice(0, limit) : records.slice().reverse().slice(0, limit);
    return Promise.resolve(records);
  };
}

describe('GET /wallets/:publicKey/transactions source=live (#1565)', () => {
  let app;
  let spy;

  beforeAll(async () => {
    app = buildApp();
    await db.run('DELETE FROM users WHERE publicKey = ?', [TEST_PK]);
    await db.run('INSERT INTO users (publicKey) VALUES (?)', [TEST_PK]);
  });

  afterAll(async () => {
    await db.run('DELETE FROM users WHERE publicKey = ?', [TEST_PK]);
  });

  afterEach(() => {
    if (spy) spy.mockRestore();
    spy = null;
  });

  it('forwards the decoded paging_token as cursor with order=desc and returns next/prev cursors', async () => {
    spy = jest.spyOn(TransactionSyncService.prototype, 'fetchTransactionPage')
      .mockImplementation(makeFakeHorizon(10));

    const cursor = Buffer.from('7').toString('base64');
    const res = await request(app).get(`/wallets/${TEST_PK}/transactions?source=live&limit=3&cursor=${cursor}`);

    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith(TEST_PK, { limit: 3, cursor: '7', order: 'desc' });
    expect(res.body.source).toBe('live');
    expect(res.body.data.map((t) => t.pagingToken)).toEqual(['6', '5', '4']);
    expect(Buffer.from(res.body.pagination.nextCursor, 'base64').toString('utf8')).toBe('4');
    expect(Buffer.from(res.body.pagination.prevCursor, 'base64').toString('utf8')).toBe('6');
    expect(res.body.pagination.hasMore).toBe(true);
  });

  it('traverses every Horizon page exactly once with no gaps or duplicates', async () => {
    spy = jest.spyOn(TransactionSyncService.prototype, 'fetchTransactionPage')
      .mockImplementation(makeFakeHorizon(23));

    const seen = [];
    let cursor = null;
    let pages = 0;
    do {
      const qs = `source=live&limit=5${cursor ? `&cursor=${cursor}` : ''}`;
      const res = await request(app).get(`/wallets/${TEST_PK}/transactions?${qs}`);
      expect(res.status).toBe(200);
      seen.push(...res.body.data.map((t) => t.pagingToken));
      cursor = res.body.pagination.nextCursor;
      pages += 1;
      expect(pages).toBeLessThanOrEqual(10);
    } while (cursor);

    expect(pages).toBe(5);
    expect(seen).toHaveLength(23);
    expect(new Set(seen).size).toBe(23);
    expect(seen).toEqual(Array.from({ length: 23 }, (_, i) => String(23 - i)));
  });

  it('dir=prev returns newer records, still newest-first, and the cursor walks back', async () => {
    spy = jest.spyOn(TransactionSyncService.prototype, 'fetchTransactionPage')
      .mockImplementation(makeFakeHorizon(10));

    const cursor = Buffer.from('3').toString('base64');
    const res = await request(app).get(`/wallets/${TEST_PK}/transactions?source=live&limit=3&dir=prev&cursor=${cursor}`);

    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith(TEST_PK, { limit: 3, cursor: '3', order: 'asc' });
    expect(res.body.data.map((t) => t.pagingToken)).toEqual(['6', '5', '4']);
    expect(Buffer.from(res.body.pagination.prevCursor, 'base64').toString('utf8')).toBe('6');
    expect(Buffer.from(res.body.pagination.nextCursor, 'base64').toString('utf8')).toBe('4');
  });

  it('last Horizon page has no nextCursor', async () => {
    spy = jest.spyOn(TransactionSyncService.prototype, 'fetchTransactionPage')
      .mockImplementation(makeFakeHorizon(2));

    const res = await request(app).get(`/wallets/${TEST_PK}/transactions?source=live&limit=5`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination.nextCursor).toBeNull();
    expect(res.body.pagination.hasMore).toBe(false);
  });

  it('rejects a non-numeric cursor with INVALID_CURSOR', async () => {
    const cursor = Buffer.from('not-a-token').toString('base64');
    const res = await request(app).get(`/wallets/${TEST_PK}/transactions?source=live&cursor=${cursor}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CURSOR');
  });

  it('rejects an unknown dir with INVALID_DIRECTION', async () => {
    const res = await request(app).get(`/wallets/${TEST_PK}/transactions?source=live&dir=sideways`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_DIRECTION');
  });

  it('rejects an unknown source with INVALID_SOURCE', async () => {
    const res = await request(app).get(`/wallets/${TEST_PK}/transactions?source=chain`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_SOURCE');
  });

  it('returns 404 for an unknown wallet in live mode', async () => {
    const res = await request(app).get('/wallets/GNOSUCHWALLET0000000000000000000000000000000000000000000001/transactions?source=live');
    expect(res.status).toBe(404);
  });

  it('defaults to the local DB and does not call Horizon', async () => {
    spy = jest.spyOn(TransactionSyncService.prototype, 'fetchTransactionPage');
    const res = await request(app).get(`/wallets/${TEST_PK}/transactions`);
    expect(res.status).toBe(200);
    expect(res.body.source).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it('sets Deprecation and Warning headers when page or offset is supplied', async () => {
    const res = await request(app).get(`/wallets/${TEST_PK}/transactions?page=2&offset=10`);
    expect(res.status).toBe(200);
    expect(res.headers.deprecation).toBe('true');
    expect(res.headers.warning).toMatch(/^299 - ".*page, offset.*deprecated/);
  });

  it('does not set deprecation headers when only cursor paging is used', async () => {
    const res = await request(app).get(`/wallets/${TEST_PK}/transactions`);
    expect(res.headers.deprecation).toBeUndefined();
    expect(res.headers.warning).toBeUndefined();
  });
});
