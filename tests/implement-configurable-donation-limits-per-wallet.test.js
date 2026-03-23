/**
 * Tests: Configurable Donation Limits Per Wallet
 * Covers: per-transaction, daily, monthly limit enforcement,
 *         per-wallet overrides, admin PATCH endpoint, response headers, 422 format
 */

const request = require('supertest');
const app = require('../src/routes/app');
const Database = require('../src/utils/database');
const LimitService = require('../src/services/LimitService');
const encryption = require('../src/utils/encryption');

// Admin API key (starts with 'admin-' for legacy role detection)
const ADMIN_KEY = 'admin-test-key';
// Regular user key
const USER_KEY = 'test-key-1';

// Idempotency counter
let idempotencyCounter = 0;
const nextKey = () => `idem-limits-${++idempotencyCounter}-${Date.now()}`;

let senderId;
let receiverId;

beforeAll(async () => {
  // Insert test users — keys must be valid Stellar format
  // Stellar keys: prefix (S or G) + 55 chars from A-Z and 2-7 (base32), total 56 chars
  const validSecret = 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'; // S + 55 A's = 56
  const encSecret = encryption.encrypt(validSecret);

  const senderResult = await Database.run(
    'INSERT INTO users (publicKey, encryptedSecret) VALUES (?, ?)',
    ['GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', encSecret]
  );
  senderId = senderResult.id;

  const receiverResult = await Database.run(
    'INSERT INTO users (publicKey, encryptedSecret) VALUES (?, ?)',
    ['GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', encSecret]
  );
  receiverId = receiverResult.id;
});

afterEach(async () => {
  // Clear transactions and reset limits for test isolation
  await Database.run('DELETE FROM transactions WHERE senderId = ? OR receiverId = ?', [senderId, receiverId]);
  await Database.run(
    'UPDATE users SET daily_limit = NULL, monthly_limit = NULL, per_transaction_limit = NULL WHERE id = ?',
    [senderId]
  );
});

// ─── LimitService unit tests ──────────────────────────────────────────────────

describe('LimitService.checkLimits', () => {
  test('passes when no limits are set (falls back to global)', async () => {
    // No per-wallet limits, global max is 10000 — amount 100 should pass
    await expect(LimitService.checkLimits(senderId, 100)).resolves.toBeUndefined();
  });

  test('enforces per_transaction_limit', async () => {
    await LimitService.setWalletLimits(senderId, { per_transaction_limit: 50 });
    await expect(LimitService.checkLimits(senderId, 51)).rejects.toMatchObject({
      statusCode: 422,
      message: expect.stringContaining('per-transaction limit'),
    });
  });

  test('allows amount equal to per_transaction_limit', async () => {
    await LimitService.setWalletLimits(senderId, { per_transaction_limit: 50 });
    await expect(LimitService.checkLimits(senderId, 50)).resolves.toBeUndefined();
  });

  test('enforces daily_limit', async () => {
    await LimitService.setWalletLimits(senderId, { daily_limit: 200 });
    // Simulate 150 already donated today
    await Database.run(
      'INSERT INTO transactions (senderId, receiverId, amount, timestamp) VALUES (?, ?, ?, datetime("now"))',
      [senderId, receiverId, 150]
    );
    await expect(LimitService.checkLimits(senderId, 60)).rejects.toMatchObject({
      statusCode: 422,
      message: expect.stringContaining('daily limit'),
    });
  });

  test('allows donation that exactly fills daily_limit', async () => {
    await LimitService.setWalletLimits(senderId, { daily_limit: 200 });
    await Database.run(
      'INSERT INTO transactions (senderId, receiverId, amount, timestamp) VALUES (?, ?, ?, datetime("now"))',
      [senderId, receiverId, 100]
    );
    await expect(LimitService.checkLimits(senderId, 100)).resolves.toBeUndefined();
  });

  test('enforces monthly_limit', async () => {
    await LimitService.setWalletLimits(senderId, { monthly_limit: 500 });
    await Database.run(
      `INSERT INTO transactions (senderId, receiverId, amount, timestamp)
       VALUES (?, ?, ?, strftime('%Y-%m-01', 'now'))`,
      [senderId, receiverId, 450]
    );
    await expect(LimitService.checkLimits(senderId, 60)).rejects.toMatchObject({
      statusCode: 422,
      message: expect.stringContaining('monthly limit'),
    });
  });

  test('per-wallet limit overrides global max', async () => {
    // Global max is 10000; set per-wallet to 100
    await LimitService.setWalletLimits(senderId, { per_transaction_limit: 100 });
    await expect(LimitService.checkLimits(senderId, 101)).rejects.toMatchObject({
      statusCode: 422,
    });
    // But 100 is fine
    await expect(LimitService.checkLimits(senderId, 100)).resolves.toBeUndefined();
  });

  test('returns undefined for unknown userId (no user row)', async () => {
    await expect(LimitService.checkLimits(999999, 100)).resolves.toBeUndefined();
  });
});

describe('LimitService.getRemainingLimits', () => {
  test('returns null for both when no limits set', async () => {
    const result = await LimitService.getRemainingLimits(senderId);
    expect(result.dailyRemaining).toBeNull();
    expect(result.monthlyRemaining).toBeNull();
  });

  test('returns correct daily remaining', async () => {
    await LimitService.setWalletLimits(senderId, { daily_limit: 300 });
    await Database.run(
      'INSERT INTO transactions (senderId, receiverId, amount, timestamp) VALUES (?, ?, ?, datetime("now"))',
      [senderId, receiverId, 100]
    );
    const result = await LimitService.getRemainingLimits(senderId);
    expect(result.dailyRemaining).toBe(200);
  });

  test('returns correct monthly remaining', async () => {
    await LimitService.setWalletLimits(senderId, { monthly_limit: 1000 });
    await Database.run(
      `INSERT INTO transactions (senderId, receiverId, amount, timestamp)
       VALUES (?, ?, ?, strftime('%Y-%m-15', 'now'))`,
      [senderId, receiverId, 400]
    );
    const result = await LimitService.getRemainingLimits(senderId);
    expect(result.monthlyRemaining).toBe(600);
  });

  test('remaining never goes below 0', async () => {
    await LimitService.setWalletLimits(senderId, { daily_limit: 100 });
    await Database.run(
      'INSERT INTO transactions (senderId, receiverId, amount, timestamp) VALUES (?, ?, ?, datetime("now"))',
      [senderId, receiverId, 150]
    );
    const result = await LimitService.getRemainingLimits(senderId);
    expect(result.dailyRemaining).toBe(0);
  });
});

describe('LimitService.setWalletLimits', () => {
  test('sets all three limits', async () => {
    await LimitService.setWalletLimits(senderId, {
      daily_limit: 500,
      monthly_limit: 5000,
      per_transaction_limit: 100,
    });
    const user = await Database.get('SELECT * FROM users WHERE id = ?', [senderId]);
    expect(user.daily_limit).toBe(500);
    expect(user.monthly_limit).toBe(5000);
    expect(user.per_transaction_limit).toBe(100);
  });

  test('clears limits when set to null', async () => {
    await LimitService.setWalletLimits(senderId, {
      daily_limit: 500,
      monthly_limit: 5000,
      per_transaction_limit: 100,
    });
    await LimitService.setWalletLimits(senderId, {
      daily_limit: null,
      monthly_limit: null,
      per_transaction_limit: null,
    });
    const user = await Database.get('SELECT * FROM users WHERE id = ?', [senderId]);
    expect(user.daily_limit).toBeNull();
    expect(user.monthly_limit).toBeNull();
    expect(user.per_transaction_limit).toBeNull();
  });
});

// ─── PATCH /wallets/:id/limits endpoint ──────────────────────────────────────

describe('PATCH /wallets/:id/limits', () => {
  test('admin can set limits', async () => {
    const res = await request(app)
      .patch(`/wallets/${senderId}/limits`)
      .set('x-api-key', ADMIN_KEY)
      .send({ daily_limit: 1000, monthly_limit: 10000, per_transaction_limit: 200 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.daily_limit).toBe(1000);
    expect(res.body.data.monthly_limit).toBe(10000);
    expect(res.body.data.per_transaction_limit).toBe(200);
  });

  test('admin can set partial limits', async () => {
    const res = await request(app)
      .patch(`/wallets/${senderId}/limits`)
      .set('x-api-key', ADMIN_KEY)
      .send({ daily_limit: 500 });

    expect(res.status).toBe(200);
    expect(res.body.data.daily_limit).toBe(500);
  });

  test('admin can clear a limit by setting null', async () => {
    await LimitService.setWalletLimits(senderId, { daily_limit: 500 });

    const res = await request(app)
      .patch(`/wallets/${senderId}/limits`)
      .set('x-api-key', ADMIN_KEY)
      .send({ daily_limit: null });

    expect(res.status).toBe(200);
    expect(res.body.data.daily_limit).toBeNull();
  });

  test('non-admin gets 403', async () => {
    const res = await request(app)
      .patch(`/wallets/${senderId}/limits`)
      .set('x-api-key', USER_KEY)
      .send({ daily_limit: 100 });

    expect(res.status).toBe(403);
  });

  test('unauthenticated gets 401', async () => {
    const res = await request(app)
      .patch(`/wallets/${senderId}/limits`)
      .send({ daily_limit: 100 });

    expect(res.status).toBe(401);
  });

  test('returns 404 for non-existent wallet', async () => {
    const res = await request(app)
      .patch('/wallets/999999/limits')
      .set('x-api-key', ADMIN_KEY)
      .send({ daily_limit: 100 });

    expect(res.status).toBe(404);
  });

  test('rejects negative limit value', async () => {
    const res = await request(app)
      .patch(`/wallets/${senderId}/limits`)
      .set('x-api-key', ADMIN_KEY)
      .send({ daily_limit: -100 });

    expect(res.status).toBe(400);
  });

  test('rejects zero limit value', async () => {
    const res = await request(app)
      .patch(`/wallets/${senderId}/limits`)
      .set('x-api-key', ADMIN_KEY)
      .send({ per_transaction_limit: 0 });

    expect(res.status).toBe(400);
  });

  test('rejects body with no recognized limit fields', async () => {
    const res = await request(app)
      .patch(`/wallets/${senderId}/limits`)
      .set('x-api-key', ADMIN_KEY)
      .send({ unknown_field: 100 });

    expect(res.status).toBe(400);
  });

  test('rejects invalid wallet ID', async () => {
    const res = await request(app)
      .patch('/wallets/abc/limits')
      .set('x-api-key', ADMIN_KEY)
      .send({ daily_limit: 100 });

    expect(res.status).toBe(400);
  });
});

// ─── POST /donations/send — limit enforcement via HTTP ───────────────────────

describe('POST /donations/send — limit enforcement', () => {
  test('donation succeeds when within per_transaction_limit', async () => {
    await LimitService.setWalletLimits(senderId, { per_transaction_limit: 500 });

    const res = await request(app)
      .post('/donations/send')
      .set('Idempotency-Key', nextKey())
      .send({ senderId, receiverId, amount: 100 });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  test('donation fails with 422 when exceeding per_transaction_limit', async () => {
    await LimitService.setWalletLimits(senderId, { per_transaction_limit: 50 });

    const res = await request(app)
      .post('/donations/send')
      .set('Idempotency-Key', nextKey())
      .send({ senderId, receiverId, amount: 100 });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeDefined();
  });

  test('donation fails with 422 when exceeding daily_limit', async () => {
    await LimitService.setWalletLimits(senderId, { daily_limit: 100 });
    // Pre-fill daily total
    await Database.run(
      'INSERT INTO transactions (senderId, receiverId, amount, timestamp) VALUES (?, ?, ?, datetime("now"))',
      [senderId, receiverId, 80]
    );

    const res = await request(app)
      .post('/donations/send')
      .set('Idempotency-Key', nextKey())
      .send({ senderId, receiverId, amount: 30 });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/daily limit/i);
  });

  test('donation fails with 422 when exceeding monthly_limit', async () => {
    await LimitService.setWalletLimits(senderId, { monthly_limit: 200 });
    await Database.run(
      `INSERT INTO transactions (senderId, receiverId, amount, timestamp)
       VALUES (?, ?, ?, strftime('%Y-%m-01', 'now'))`,
      [senderId, receiverId, 180]
    );

    const res = await request(app)
      .post('/donations/send')
      .set('Idempotency-Key', nextKey())
      .send({ senderId, receiverId, amount: 30 });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/monthly limit/i);
  });

  test('422 error body has correct structure', async () => {
    await LimitService.setWalletLimits(senderId, { per_transaction_limit: 10 });

    const res = await request(app)
      .post('/donations/send')
      .set('Idempotency-Key', nextKey())
      .send({ senderId, receiverId, amount: 100 });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      success: false,
      error: {
        code: expect.any(String),
        message: expect.any(String),
      },
    });
  });
});

// ─── Response headers ─────────────────────────────────────────────────────────

describe('Response headers — X-Donation-Daily-Remaining / X-Donation-Monthly-Remaining', () => {
  test('headers are present when daily_limit is set', async () => {
    await LimitService.setWalletLimits(senderId, { daily_limit: 500 });

    const res = await request(app)
      .post('/donations/send')
      .set('Idempotency-Key', nextKey())
      .send({ senderId, receiverId, amount: 100 });

    expect(res.status).toBe(201);
    expect(res.headers['x-donation-daily-remaining']).toBeDefined();
    expect(Number(res.headers['x-donation-daily-remaining'])).toBe(400);
  });

  test('headers are present when monthly_limit is set', async () => {
    await LimitService.setWalletLimits(senderId, { monthly_limit: 1000 });

    const res = await request(app)
      .post('/donations/send')
      .set('Idempotency-Key', nextKey())
      .send({ senderId, receiverId, amount: 200 });

    expect(res.status).toBe(201);
    expect(res.headers['x-donation-monthly-remaining']).toBeDefined();
    expect(Number(res.headers['x-donation-monthly-remaining'])).toBe(800);
  });

  test('headers are absent when no limits are set', async () => {
    const res = await request(app)
      .post('/donations/send')
      .set('Idempotency-Key', nextKey())
      .send({ senderId, receiverId, amount: 50 });

    expect(res.status).toBe(201);
    expect(res.headers['x-donation-daily-remaining']).toBeUndefined();
    expect(res.headers['x-donation-monthly-remaining']).toBeUndefined();
  });

  test('daily remaining decreases with each donation', async () => {
    await LimitService.setWalletLimits(senderId, { daily_limit: 300 });

    const res1 = await request(app)
      .post('/donations/send')
      .set('Idempotency-Key', nextKey())
      .send({ senderId, receiverId, amount: 100 });

    expect(Number(res1.headers['x-donation-daily-remaining'])).toBe(200);

    const res2 = await request(app)
      .post('/donations/send')
      .set('Idempotency-Key', nextKey())
      .send({ senderId, receiverId, amount: 50 });

    expect(Number(res2.headers['x-donation-daily-remaining'])).toBe(150);
  });
});

// ─── Limit reset timing ───────────────────────────────────────────────────────

describe('Limit reset timing', () => {
  test('daily total excludes transactions from yesterday', async () => {
    // Insert a transaction with yesterday's timestamp
    await Database.run(
      `INSERT INTO transactions (senderId, receiverId, amount, timestamp)
       VALUES (?, ?, ?, datetime('now', '-1 day'))`,
      [senderId, receiverId, 999]
    );
    const total = await LimitService.getDailyTotal(senderId);
    expect(total).toBe(0);
  });

  test('monthly total excludes transactions from last month', async () => {
    // Insert a transaction from last month
    await Database.run(
      `INSERT INTO transactions (senderId, receiverId, amount, timestamp)
       VALUES (?, ?, ?, datetime('now', '-32 days'))`,
      [senderId, receiverId, 999]
    );
    const total = await LimitService.getMonthlyTotal(senderId);
    expect(total).toBe(0);
  });

  test('daily total includes transactions from today', async () => {
    await Database.run(
      `INSERT INTO transactions (senderId, receiverId, amount, timestamp)
       VALUES (?, ?, ?, datetime('now'))`,
      [senderId, receiverId, 150]
    );
    const total = await LimitService.getDailyTotal(senderId);
    expect(total).toBe(150);
  });

  test('monthly total includes transactions from this month', async () => {
    await Database.run(
      `INSERT INTO transactions (senderId, receiverId, amount, timestamp)
       VALUES (?, ?, ?, strftime('%Y-%m-01', 'now'))`,
      [senderId, receiverId, 300]
    );
    const total = await LimitService.getMonthlyTotal(senderId);
    expect(total).toBe(300);
  });
});
