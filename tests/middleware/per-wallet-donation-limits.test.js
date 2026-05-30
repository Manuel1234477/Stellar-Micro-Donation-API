'use strict';

/**
 * Tests for per-wallet donation limits with admin override (#606)
 * Covers: per-wallet override, fallback to global, admin CRUD, X-Wallet-Limit headers
 */

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-admin-limits-key';

const request = require('supertest');
const express = require('express');
const Database = require('../../src/utils/database');
const walletLimitsRouter = require('../../src/routes/admin/walletLimits');
const requireApiKey = require('../../src/middleware/apiKey');
const { attachUserRole } = require('../../src/middleware/rbac');

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(requireApiKey);
  app.use(attachUserRole());
  // Force admin role for test key
  app.use((req, _res, next) => {
    if (req.user) req.user.role = 'admin';
    next();
  });
  app.use('/admin/wallets', walletLimitsRouter);
  app.use((err, req, res, _next) => {
    res.status(err.status || 500).json({ success: false, error: err.message });
  });
  return app;
}

let app;
const API_KEY = 'test-admin-limits-key';

async function createTestWallet(publicKey) {
  const existing = await Database.get('SELECT id FROM users WHERE publicKey = ?', [publicKey]);
  if (existing) return existing.id;
  const result = await Database.run('INSERT INTO users (publicKey) VALUES (?)', [publicKey]);
  return result.id;
}

beforeAll(async () => {
  await Database.initialize();
  app = createTestApp();
});

afterAll(async () => {
  await Database.close();
});

describe('POST /admin/wallets/:id/limits', () => {
  test('sets per-wallet limits for a wallet', async () => {
    const walletId = await createTestWallet('GLIMIT_TEST_W01_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');

    const res = await request(app)
      .post(`/admin/wallets/${walletId}/limits`)
      .set('X-API-Key', API_KEY)
      .send({ max_amount: 500, daily_cap: 1000 });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.limits.per_transaction_limit).toBe(500);
    expect(res.body.data.limits.daily_limit).toBe(1000);
  });

  test('returns 400 for invalid limit value', async () => {
    const walletId = await createTestWallet('GLIMIT_TEST_W02_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');

    const res = await request(app)
      .post(`/admin/wallets/${walletId}/limits`)
      .set('X-API-Key', API_KEY)
      .send({ max_amount: -10 });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('returns 400 when min_amount >= max_amount', async () => {
    const walletId = await createTestWallet('GLIMIT_TEST_W03_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');

    const res = await request(app)
      .post(`/admin/wallets/${walletId}/limits`)
      .set('X-API-Key', API_KEY)
      .send({ min_amount: 100, max_amount: 50 });

    expect(res.status).toBe(400);
  });

  test('returns 404 for non-existent wallet', async () => {
    const res = await request(app)
      .post('/admin/wallets/999999/limits')
      .set('X-API-Key', API_KEY)
      .send({ max_amount: 100 });

    expect(res.status).toBe(404);
  });

  test('returns 400 when no limit fields provided', async () => {
    const walletId = await createTestWallet('GLIMIT_TEST_W04_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');

    const res = await request(app)
      .post(`/admin/wallets/${walletId}/limits`)
      .set('X-API-Key', API_KEY)
      .send({});

    expect(res.status).toBe(400);
  });
});

describe('GET /admin/wallets/:id/limits', () => {
  test('retrieves current limits with effective and global defaults', async () => {
    const walletId = await createTestWallet('GLIMIT_TEST_W05_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');

    await request(app)
      .post(`/admin/wallets/${walletId}/limits`)
      .set('X-API-Key', API_KEY)
      .send({ max_amount: 250 });

    const res = await request(app)
      .get(`/admin/wallets/${walletId}/limits`)
      .set('X-API-Key', API_KEY);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.explicit.per_transaction_limit).toBe(250);
    expect(res.body.data.effective.per_transaction_limit).toBe(250);
    expect(res.body.data.globalDefaults).toBeDefined();
  });

  test('returns global defaults when no explicit limits set', async () => {
    const walletId = await createTestWallet('GLIMIT_TEST_W06_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');

    const res = await request(app)
      .get(`/admin/wallets/${walletId}/limits`)
      .set('X-API-Key', API_KEY);

    expect(res.status).toBe(200);
    expect(res.body.data.explicit.per_transaction_limit).toBeNull();
    expect(res.body.data.effective.per_transaction_limit).toBeDefined();
  });

  test('returns 404 for non-existent wallet', async () => {
    const res = await request(app)
      .get('/admin/wallets/999999/limits')
      .set('X-API-Key', API_KEY);

    expect(res.status).toBe(404);
  });
});

describe('DELETE /admin/wallets/:id/limits', () => {
  test('resets per-wallet limits to global defaults', async () => {
    const walletId = await createTestWallet('GLIMIT_TEST_W07_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');

    await request(app)
      .post(`/admin/wallets/${walletId}/limits`)
      .set('X-API-Key', API_KEY)
      .send({ max_amount: 100, daily_cap: 500 });

    const deleteRes = await request(app)
      .delete(`/admin/wallets/${walletId}/limits`)
      .set('X-API-Key', API_KEY);

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.success).toBe(true);

    const row = await Database.get(
      'SELECT per_transaction_limit, daily_limit, monthly_limit FROM users WHERE id = ?',
      [walletId]
    );
    expect(row.per_transaction_limit).toBeNull();
    expect(row.daily_limit).toBeNull();
    expect(row.monthly_limit).toBeNull();
  });

  test('returns 404 for non-existent wallet', async () => {
    const res = await request(app)
      .delete('/admin/wallets/999999/limits')
      .set('X-API-Key', API_KEY);

    expect(res.status).toBe(404);
  });
});

describe('Per-wallet limit enforcement in LimitService', () => {
  test('per-wallet limit overrides global when set', async () => {
    const LimitService = require('../../src/services/LimitService');
    const walletId = await createTestWallet('GLIMIT_TEST_W08_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');

    await Database.run('UPDATE users SET per_transaction_limit = 1 WHERE id = ?', [walletId]);

    await expect(LimitService.checkLimits(walletId, 100)).rejects.toThrow();
  });

  test('falls back to global limits when no per-wallet limits set', async () => {
    const LimitService = require('../../src/services/LimitService');
    const walletId = await createTestWallet('GLIMIT_TEST_W09_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');

    await expect(LimitService.checkLimits(walletId, 0.01)).resolves.not.toThrow();
  });
});

describe('Admin wallet limits route exports', () => {
  test('walletLimits router is an express router', () => {
    expect(typeof walletLimitsRouter).toBe('function');
  });

  test('LimitService exports setWalletLimits', () => {
    const LimitService = require('../../src/services/LimitService');
    expect(typeof LimitService.setWalletLimits).toBe('function');
  });

  test('supports per_transaction_limit field name', async () => {
    const walletId = await createTestWallet('GLIMIT_TEST_W10_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');

    const res = await request(app)
      .post(`/admin/wallets/${walletId}/limits`)
      .set('X-API-Key', API_KEY)
      .send({ per_transaction_limit: 300 });

    expect(res.status).toBe(201);
    expect(res.body.data.limits.per_transaction_limit).toBe(300);
  });
});
