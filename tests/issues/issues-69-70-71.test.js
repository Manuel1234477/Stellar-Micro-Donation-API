'use strict';

/**
 * Tests for:
 *   Issue #69 - GET /wallets/:id/analytics
 *   Issue #70 - POST /admin/db/vacuum + GET /admin/db/vacuum/:jobId
 *   Issue #71 - GET /donations/recent with limit cap and caching
 */

const request = require('supertest');
const express = require('express');
const Database = require('../../src/utils/database');
const Cache = require('../../src/utils/cache');

// ─── helpers ─────────────────────────────────────────────────────────────────

function adminMiddleware(req, res, next) {
  req.user = { id: 1, role: 'admin' };
  req.apiKey = { id: 1, role: 'admin', permissions: ['*'] };
  next();
}

function userMiddleware(req, res, next) {
  req.user = { id: 2, role: 'user' };
  req.apiKey = { id: 2, role: 'user', permissions: ['wallets:read', 'donations:read'] };
  next();
}

function errorHandler(err, req, res, next) {
  void next;
  res.status(err.status || err.statusCode || 500).json({
    success: false,
    error: { code: err.code || 'ERROR', message: err.message },
  });
}

// ─── Issue #69 ────────────────────────────────────────────────────────────────

describe('Issue #69 — GET /wallets/:id/analytics', () => {
  let app;
  let walletId;
  let wallet2Id;

  beforeAll(async () => {
    // Create test wallets
    const w1 = await Database.run(
      "INSERT INTO users (publicKey) VALUES (?)",
      [`GTEST69A${Date.now()}`]
    );
    walletId = w1.id;

    const w2 = await Database.run(
      "INSERT INTO users (publicKey) VALUES (?)",
      [`GTEST69B${Date.now()}`]
    );
    wallet2Id = w2.id;

    // Insert some transactions: walletId sends to wallet2Id
    await Database.run(
      "INSERT INTO transactions (senderId, receiverId, amount, timestamp) VALUES (?, ?, ?, ?)",
      [walletId, wallet2Id, 10.5, new Date().toISOString()]
    );
    await Database.run(
      "INSERT INTO transactions (senderId, receiverId, amount, timestamp) VALUES (?, ?, ?, ?)",
      [walletId, wallet2Id, 5.0, new Date().toISOString()]
    );
    // wallet2Id sends to walletId
    await Database.run(
      "INSERT INTO transactions (senderId, receiverId, amount, timestamp) VALUES (?, ?, ?, ?)",
      [wallet2Id, walletId, 3.0, new Date().toISOString()]
    );

    const walletRouter = require('../../src/routes/wallet');
    app = express();
    app.use(express.json());
    app.use(userMiddleware);
    app.use('/wallets', walletRouter);
    app.use(errorHandler);
  });

  afterAll(async () => {
    Cache.clearPrefix('wallet:analytics:');
    await Database.run('DELETE FROM transactions WHERE senderId = ? OR receiverId = ?', [walletId, walletId]);
    await Database.run('DELETE FROM transactions WHERE senderId = ? OR receiverId = ?', [wallet2Id, wallet2Id]);
    await Database.run('DELETE FROM users WHERE id IN (?, ?)', [walletId, wallet2Id]);
  });

  it('returns 200 with correct aggregated analytics for wallet with transactions', async () => {
    const res = await request(app).get(`/wallets/${walletId}/analytics`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const d = res.body.data;
    expect(d.donationCount).toBe(2);
    expect(d.totalDonated).toBeCloseTo(15.5);
    expect(d.receiptCount).toBe(1);
    expect(d.totalReceived).toBeCloseTo(3.0);
    expect(d.averageDonationAmount).toBeCloseTo(7.75);
    expect(d.largestDonation).toBeCloseTo(10.5);
    expect(Array.isArray(d.topRecipients)).toBe(true);
    expect(Array.isArray(d.topDonors)).toBe(true);
    expect(Array.isArray(d.donationsByMonth)).toBe(true);
    expect(d.donationsByMonth).toHaveLength(12);
    expect(d.firstDonationAt).not.toBeNull();
    expect(d.lastDonationAt).not.toBeNull();
  });

  it('returns 200 with all-zero values for wallet with no transactions', async () => {
    const w3 = await Database.run("INSERT INTO users (publicKey) VALUES (?)", [`GTEST69C${Date.now()}`]);
    const res = await request(app).get(`/wallets/${w3.id}/analytics`);
    expect(res.status).toBe(200);
    expect(res.body.data.donationCount).toBe(0);
    expect(res.body.data.totalDonated).toBe(0);
    expect(res.body.data.receiptCount).toBe(0);
    expect(res.body.data.firstDonationAt).toBeNull();
    await Database.run('DELETE FROM users WHERE id = ?', [w3.id]);
  });

  it('returns 404 for non-existent wallet', async () => {
    const res = await request(app).get('/wallets/999999/analytics');
    expect(res.status).toBe(404);
  });

  it('caches the response (second call returns same data)', async () => {
    Cache.clearPrefix('wallet:analytics:');
    const res1 = await request(app).get(`/wallets/${walletId}/analytics`);
    const res2 = await request(app).get(`/wallets/${walletId}/analytics`);
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res2.body.data.donationCount).toBe(res1.body.data.donationCount);
  });
});

// ─── Issue #70 ────────────────────────────────────────────────────────────────

describe('Issue #70 — POST /admin/db/vacuum', () => {
  let app;
  let dbRouter;

  beforeAll(() => {
    dbRouter = require('../../src/routes/admin/db');
    app = express();
    app.use(express.json());
    app.use(adminMiddleware);
    app.use('/admin/db', dbRouter);
    app.use(errorHandler);
  });

  it('POST /admin/db/vacuum returns 200 with a jobId immediately', async () => {
    const res = await request(app).post('/admin/db/vacuum');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.jobId).toBe('string');
    expect(res.body.jobId).toMatch(/^vacuum-/);
  });

  it('GET /admin/db/vacuum/:jobId returns job status', async () => {
    // Wait for any previous job to finish before starting a new one
    for (let i = 0; i < 30; i++) {
      const probe = await request(app).post('/admin/db/vacuum');
      if (probe.status === 200) {
        const { jobId } = probe.body;
        let statusRes;
        for (let j = 0; j < 30; j++) {
          await new Promise(r => setTimeout(r, 100));
          statusRes = await request(app).get(`/admin/db/vacuum/${jobId}`);
          if (statusRes.body.data?.status !== 'running') break;
        }
        expect(statusRes.status).toBe(200);
        expect(['completed', 'failed']).toContain(statusRes.body.data.status);
        if (statusRes.body.data.status === 'completed') {
          expect(typeof statusRes.body.data.sizeBefore).toBe('number');
          expect(typeof statusRes.body.data.sizeAfter).toBe('number');
          expect(typeof statusRes.body.data.reclaimedBytes).toBe('number');
          expect(typeof statusRes.body.data.durationMs).toBe('number');
        }
        return;
      }
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('Could not start a vacuum job within timeout');
  });

  it('returns 404 for unknown jobId', async () => {
    const res = await request(app).get('/admin/db/vacuum/vacuum-nonexistent');
    expect(res.status).toBe(404);
  });

  it('returns 403 for non-admin user', async () => {
    const nonAdminApp = express();
    nonAdminApp.use(express.json());
    nonAdminApp.use(userMiddleware);
    nonAdminApp.use('/admin/db', dbRouter);
    nonAdminApp.use(errorHandler);

    const res = await request(nonAdminApp).post('/admin/db/vacuum');
    expect(res.status).toBe(403);
  });
});

// ─── Issue #71 ────────────────────────────────────────────────────────────────

describe('Issue #71 — GET /donations/recent', () => {
  let app;
  let testUserIds = [];

  beforeAll(async () => {
    // Insert a few test transactions
    const u1 = await Database.run("INSERT INTO users (publicKey) VALUES (?)", [`GTEST71A${Date.now()}`]);
    const u2 = await Database.run("INSERT INTO users (publicKey) VALUES (?)", [`GTEST71B${Date.now()}`]);
    testUserIds = [u1.id, u2.id];

    for (let i = 0; i < 5; i++) {
      await Database.run(
        "INSERT INTO transactions (senderId, receiverId, amount, timestamp) VALUES (?, ?, ?, ?)",
        [u1.id, u2.id, i + 1, new Date(Date.now() - i * 1000).toISOString()]
      );
    }

    const donationRouter = require('../../src/routes/donation');
    app = express();
    app.use(express.json());
    app.use(userMiddleware);
    app.use('/donations', donationRouter);
    app.use(errorHandler);
  });

  afterAll(async () => {
    Cache.clearPrefix('donations:recent:');
    for (const id of testUserIds) {
      await Database.run('DELETE FROM transactions WHERE senderId = ? OR receiverId = ?', [id, id]);
      await Database.run('DELETE FROM users WHERE id = ?', [id]);
    }
  });

  beforeEach(() => {
    Cache.clearPrefix('donations:recent:');
  });

  it('returns 200 with default limit of 10', async () => {
    const res = await request(app).get('/donations/recent');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBeLessThanOrEqual(10);
  });

  it('respects custom limit within cap', async () => {
    const res = await request(app).get('/donations/recent?limit=3');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(3);
  });

  it('caps limit at RECENT_DONATIONS_MAX_LIMIT (100)', async () => {
    const res = await request(app).get('/donations/recent?limit=9999');
    expect(res.status).toBe(200);
    // Should not error — just capped
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('returns 400 with INVALID_LIMIT for non-integer limit', async () => {
    const res = await request(app).get('/donations/recent?limit=abc');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_LIMIT');
  });

  it('returns 400 with INVALID_LIMIT for negative limit', async () => {
    const res = await request(app).get('/donations/recent?limit=-5');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_LIMIT');
  });

  it('returns 400 with INVALID_LIMIT for zero limit', async () => {
    const res = await request(app).get('/donations/recent?limit=0');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_LIMIT');
  });

  it('returns 400 with INVALID_LIMIT for float limit', async () => {
    const res = await request(app).get('/donations/recent?limit=1.5');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_LIMIT');
  });

  it('caches response (X-Cache: HIT on second call)', async () => {
    const res1 = await request(app).get('/donations/recent?limit=5');
    expect(res1.status).toBe(200);
    expect(res1.headers['x-cache']).toBe('MISS');

    const res2 = await request(app).get('/donations/recent?limit=5');
    expect(res2.status).toBe(200);
    expect(res2.headers['x-cache']).toBe('HIT');
  });
});
