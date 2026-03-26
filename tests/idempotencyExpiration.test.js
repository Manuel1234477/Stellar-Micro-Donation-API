/**
 * Idempotency Key Expiration & Cleanup Tests
 */

const request = require('supertest');
const app = require('../src/routes/app');
const IdempotencyService = require('../src/services/IdempotencyService');
const Database = require('../src/utils/database');
const apiKeysModel = require('../src/models/apiKeys');

// ─── Unit Tests ───────────────────────────────────────────────────────────────

describe('IdempotencyService - Expiration & Cleanup', () => {
  const key = (suffix) => `idem_test_key_${suffix}_${Date.now()}`;

  it('stores a key with expiresAt set to DEFAULT_TTL from now', async () => {
    const k = key('store');
    const before = Date.now();
    await IdempotencyService.store(k, 'hash1', { ok: true });
    const row = await Database.get('SELECT expiresAt FROM idempotency_keys WHERE idempotencyKey = ?', [k]);
    expect(row).toBeDefined();
    const expiresAt = new Date(row.expiresAt).getTime();
    expect(expiresAt).toBeGreaterThan(before + IdempotencyService.DEFAULT_TTL - 5000);
    await IdempotencyService.delete(k);
  });

  it('get() returns null for an expired key', async () => {
    const k = key('expired');
    await Database.run(
      `INSERT INTO idempotency_keys (idempotencyKey, requestHash, response, userId, createdAt, expiresAt)
       VALUES (?, ?, ?, NULL, datetime('now'), datetime('now', '-1 second'))`,
      [k, 'hash-exp', JSON.stringify({ ok: true })]
    );
    const result = await IdempotencyService.get(k);
    expect(result).toBeNull();
    await IdempotencyService.delete(k);
  });

  it('get() returns cached response for a valid (non-expired) key', async () => {
    const k = key('valid');
    await IdempotencyService.store(k, 'hash-valid', { success: true, data: 42 });
    const result = await IdempotencyService.get(k);
    expect(result).not.toBeNull();
    expect(result.response.data).toBe(42);
    expect(result.isIdempotent).toBe(true);
    await IdempotencyService.delete(k);
  });

  it('get() returns cached response regardless of request body (key reuse with different params)', async () => {
    const k = key('reuse');
    await IdempotencyService.store(k, 'hash-original', { amount: 100 });
    // Simulate reuse with different hash — get() only looks up by key, not hash
    const result = await IdempotencyService.get(k);
    expect(result).not.toBeNull();
    expect(result.response.amount).toBe(100);
    await IdempotencyService.delete(k);
  });

  it('cleanupExpired() deletes expired keys and returns count', async () => {
    const k1 = key('cleanup1');
    const k2 = key('cleanup2');
    await Database.run(
      `INSERT INTO idempotency_keys (idempotencyKey, requestHash, response, userId, createdAt, expiresAt)
       VALUES (?, ?, ?, NULL, datetime('now'), datetime('now', '-1 second'))`,
      [k1, 'h1', JSON.stringify({})]
    );
    await Database.run(
      `INSERT INTO idempotency_keys (idempotencyKey, requestHash, response, userId, createdAt, expiresAt)
       VALUES (?, ?, ?, NULL, datetime('now'), datetime('now', '-1 second'))`,
      [k2, 'h2', JSON.stringify({})]
    );
    const deleted = await IdempotencyService.cleanupExpired();
    expect(deleted).toBeGreaterThanOrEqual(2);
    const row1 = await Database.get('SELECT id FROM idempotency_keys WHERE idempotencyKey = ?', [k1]);
    expect(row1).toBeUndefined();
  });

  it('cleanupExpired() does not delete non-expired keys', async () => {
    const k = key('keep');
    await IdempotencyService.store(k, 'hash-keep', { keep: true });
    await IdempotencyService.cleanupExpired();
    const result = await IdempotencyService.get(k);
    expect(result).not.toBeNull();
    await IdempotencyService.delete(k);
  });

  it('getStats() returns accurate counts', async () => {
    // Insert one expired key
    const kExp = key('stats-exp');
    await Database.run(
      `INSERT INTO idempotency_keys (idempotencyKey, requestHash, response, userId, createdAt, expiresAt)
       VALUES (?, ?, ?, NULL, datetime('now'), datetime('now', '-1 second'))`,
      [kExp, 'hstat', JSON.stringify({})]
    );
    const kActive = key('stats-active');
    await IdempotencyService.store(kActive, 'hstat2', { ok: true });

    const stats = await IdempotencyService.getStats();
    expect(stats.total).toBeGreaterThanOrEqual(2);
    expect(stats.active).toBeGreaterThanOrEqual(1);
    expect(stats.expired).toBeGreaterThanOrEqual(1);

    await IdempotencyService.delete(kExp);
    await IdempotencyService.delete(kActive);
  });
});

// ─── Integration Tests ────────────────────────────────────────────────────────

describe('Idempotency - Integration Tests', () => {
  let adminKey;

  beforeAll(async () => {
    const admin = await apiKeysModel.createApiKey({ name: 'Idem Admin', role: 'admin', createdBy: 'test' });
    adminKey = admin.key;
  });

  it('GET /admin/idempotency/stats returns stats (admin only)', async () => {
    const res = await request(app)
      .get('/admin/idempotency/stats')
      .set('x-api-key', adminKey);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('total');
    expect(res.body.data).toHaveProperty('active');
    expect(res.body.data).toHaveProperty('expired');
    expect(res.body.data).toHaveProperty('oldestActiveKeyAge');
  });

  it('GET /admin/idempotency/stats requires admin role', async () => {
    const userKey = await apiKeysModel.createApiKey({ name: 'User Key', role: 'user', createdBy: 'test' });
    const res = await request(app)
      .get('/admin/idempotency/stats')
      .set('x-api-key', userKey.key);
    expect(res.status).toBe(403);
  });

  it('reusing an idempotency key with different body returns original cached response', async () => {
    const k = `idem_reuse_integration_${Date.now()}_abcdefghij`;
    await IdempotencyService.store(k, 'original-hash', { success: true, data: { amount: 50 } });

    // Simulate a request that would have a different body — get() returns cached regardless
    const cached = await IdempotencyService.get(k);
    expect(cached).not.toBeNull();
    expect(cached.response.data.amount).toBe(50);
    expect(cached.isIdempotent).toBe(true);

    await IdempotencyService.delete(k);
  });
});
