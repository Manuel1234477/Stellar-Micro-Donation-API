'use strict';

/**
 * Tests for issue #62: cursor-based pagination for GET /wallets/:publicKey/transactions
 */

const request = require('supertest');
const db = require('../../src/utils/database');

function buildApp() {
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 1, role: 'admin' };
    req.apiKey = { id: 1, role: 'admin' };
    next();
  });
  const walletRouter = require('../../src/routes/wallet');
  app.use('/wallets', walletRouter);
  app.use((err, req, res, next) => {
    void next;
    res.status(err.status || 500).json({ success: false, error: { code: err.code || 'ERROR', message: err.message } });
  });
  return app;
}

const TEST_PK = 'GCURSORTEST000000000000000000000000000000000000000000000001';
const TEST_PK2 = 'GCURSORTEST000000000000000000000000000000000000000000000002';
const STROOPS = 10000000; // 1 XLM

async function seedWalletWithTransactions(count) {
  await db.run('DELETE FROM transactions WHERE memo LIKE ?', ['cursor-test-%']);
  await db.run('DELETE FROM users WHERE publicKey IN (?, ?)', [TEST_PK, TEST_PK2]);

  const r1 = await db.run('INSERT INTO users (publicKey) VALUES (?)', [TEST_PK]);
  const r2 = await db.run('INSERT INTO users (publicKey) VALUES (?)', [TEST_PK2]);
  const uid1 = r1.id;
  const uid2 = r2.id;

  for (let i = 0; i < count; i++) {
    await db.run(
      'INSERT INTO transactions (senderId, receiverId, amount, memo) VALUES (?, ?, ?, ?)',
      [uid1, uid2, STROOPS, `cursor-test-${i}`]
    );
  }
  return { uid1, uid2 };
}

describe('GET /wallets/:publicKey/transactions - cursor pagination (#62)', () => {
  let app;

  beforeAll(async () => {
    app = buildApp();
  });

  afterAll(async () => {
    await db.run('DELETE FROM transactions WHERE memo LIKE ?', ['cursor-test-%']);
    await db.run('DELETE FROM users WHERE publicKey IN (?, ?)', [TEST_PK, TEST_PK2]);
  });

  it('returns first page with default limit 20', async () => {
    await seedWalletWithTransactions(25);
    const res = await request(app).get(`/wallets/${TEST_PK}/transactions`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(20);
    expect(res.body.pagination.hasMore).toBe(true);
    expect(res.body.pagination.nextCursor).toBeTruthy();
    expect(res.body.pagination.total).toBe(25);
  });

  it('returns subsequent page using cursor', async () => {
    await seedWalletWithTransactions(25);
    const first = await request(app).get(`/wallets/${TEST_PK}/transactions?limit=10`);
    const cursor = first.body.pagination.nextCursor;
    expect(cursor).toBeTruthy();

    const second = await request(app).get(`/wallets/${TEST_PK}/transactions?limit=10&cursor=${cursor}`);
    expect(second.status).toBe(200);
    expect(second.body.data.length).toBeGreaterThan(0);
    // IDs on second page should all be greater than last ID on first page
    const firstIds = first.body.data.map(t => t.id);
    const secondIds = second.body.data.map(t => t.id);
    expect(Math.min(...secondIds)).toBeGreaterThan(Math.max(...firstIds));
  });

  it('last page has hasMore=false and no nextCursor', async () => {
    await seedWalletWithTransactions(5);
    const res = await request(app).get(`/wallets/${TEST_PK}/transactions?limit=10`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(5);
    expect(res.body.pagination.hasMore).toBe(false);
    expect(res.body.pagination.nextCursor).toBeNull();
  });

  it('limit=1 returns exactly one record', async () => {
    await seedWalletWithTransactions(5);
    const res = await request(app).get(`/wallets/${TEST_PK}/transactions?limit=1`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination.hasMore).toBe(true);
  });

  it('limit=100 is accepted', async () => {
    await seedWalletWithTransactions(5);
    const res = await request(app).get(`/wallets/${TEST_PK}/transactions?limit=100`);
    expect(res.status).toBe(200);
  });

  it('invalid limit returns 400 with INVALID_LIMIT', async () => {
    await seedWalletWithTransactions(1);
    const res = await request(app).get(`/wallets/${TEST_PK}/transactions?limit=abc`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_LIMIT');
  });

  it('limit > 100 returns 400 with INVALID_LIMIT', async () => {
    await seedWalletWithTransactions(1);
    const res = await request(app).get(`/wallets/${TEST_PK}/transactions?limit=101`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_LIMIT');
  });

  it('empty result returns empty data array', async () => {
    await db.run('DELETE FROM users WHERE publicKey = ?', [TEST_PK]);
    const emptyPk = 'GEMPTY00000000000000000000000000000000000000000000000000001';
    await db.run('INSERT INTO users (publicKey) VALUES (?)', [emptyPk]);
    const res = await request(app).get(`/wallets/${emptyPk}/transactions`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.pagination.hasMore).toBe(false);
    expect(res.body.pagination.total).toBe(0);
    await db.run('DELETE FROM users WHERE publicKey = ?', [emptyPk]);
  });

  it('cursor is opaque (base64-encoded)', async () => {
    await seedWalletWithTransactions(5);
    const res = await request(app).get(`/wallets/${TEST_PK}/transactions?limit=2`);
    const cursor = res.body.pagination.nextCursor;
    // Should be valid base64
    const decoded = Buffer.from(cursor, 'base64').toString('utf8');
    expect(Number.isFinite(parseInt(decoded, 10))).toBe(true);
  });
});
