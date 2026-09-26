'use strict';

/**
 * rotationLockMiddleware caching and failure policy (#1697)
 */

const express = require('express');
const request = require('supertest');
const Database = require('../../src/utils/database');
const log = require('../../src/utils/log');
const migration040 = require('../../src/migrations/040_rotation_lock');
const {
  rotationLockMiddleware,
  setRotationStatus,
  invalidateRotationLockCache,
} = require('../../src/middleware/rotationLock');

function buildApp() {
  const app = express();
  app.post('/donations', rotationLockMiddleware(), (req, res) => res.status(201).json({ ok: true }));
  // Surface anything forwarded via next(err) as a 500
  app.use((err, req, res, _next) => res.status(500).json({ error: err.message }));
  return app;
}

describe('rotationLockMiddleware', () => {
  const originalTtl = process.env.ROTATION_LOCK_CACHE_TTL_MS;
  const originalWarnInterval = process.env.ROTATION_LOCK_WARN_INTERVAL_MS;

  beforeEach(() => {
    process.env.ROTATION_LOCK_CACHE_TTL_MS = '60000';
    process.env.ROTATION_LOCK_WARN_INTERVAL_MS = '60000';
    invalidateRotationLockCache();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env.ROTATION_LOCK_CACHE_TTL_MS = originalTtl;
    process.env.ROTATION_LOCK_WARN_INTERVAL_MS = originalWarnInterval;
    if (originalTtl === undefined) delete process.env.ROTATION_LOCK_CACHE_TTL_MS;
    if (originalWarnInterval === undefined) delete process.env.ROTATION_LOCK_WARN_INTERVAL_MS;
    invalidateRotationLockCache();
  });

  describe('when the rotation_locks table is missing', () => {
    beforeEach(async () => {
      await migration040.down(Database);
    });

    it('fails open and logs a single warning instead of an error per request', async () => {
      const warn = jest.spyOn(log, 'warn');
      const error = jest.spyOn(log, 'error');
      const app = buildApp();

      for (let i = 0; i < 5; i++) {
        const res = await request(app).post('/donations');
        expect(res.status).toBe(201);
      }

      const lockWarnings = warn.mock.calls.filter(([scope]) => scope === 'ROTATION_LOCK');
      expect(lockWarnings).toHaveLength(1);
      expect(lockWarnings[0][1]).toContain('fail-open');
      expect(error.mock.calls.filter(([scope]) => scope === 'ROTATION_LOCK')).toHaveLength(0);
    });

    it('rate-limits the warning across cache expiries', async () => {
      process.env.ROTATION_LOCK_CACHE_TTL_MS = '0';
      const warn = jest.spyOn(log, 'warn');
      const get = jest.spyOn(Database, 'get');
      const app = buildApp();

      for (let i = 0; i < 3; i++) await request(app).post('/donations');

      expect(get).toHaveBeenCalledTimes(3); // TTL 0 → re-checked every request
      expect(warn.mock.calls.filter(([scope]) => scope === 'ROTATION_LOCK')).toHaveLength(1);
    });
  });

  describe('with the rotation_locks table present', () => {
    beforeEach(async () => {
      await migration040.up(Database);
      await Database.run("UPDATE rotation_locks SET status = 'idle' WHERE name = 'memoEncryption'");
    });

    afterAll(async () => {
      await Database.run("UPDATE rotation_locks SET status = 'idle' WHERE name = 'memoEncryption'");
    });

    it('queries the lock once per TTL rather than on every request', async () => {
      const get = jest.spyOn(Database, 'get');
      const app = buildApp();

      await Promise.all(Array.from({ length: 5 }, () => request(app).post('/donations')));
      await request(app).post('/donations');

      const lockQueries = get.mock.calls.filter(([sql]) => sql.includes('rotation_locks'));
      expect(lockQueries).toHaveLength(1);
    });

    it('returns 503 with Retry-After while a rotation is in progress', async () => {
      const app = buildApp();
      await request(app).post('/donations'); // warm the cache with "idle"

      await setRotationStatus('memoEncryption', 'in_progress'); // invalidates the cache

      const res = await request(app).post('/donations');
      expect(res.status).toBe(503);
      expect(res.headers['retry-after']).toBe('5');
      expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');

      await setRotationStatus('memoEncryption', 'idle');
      expect((await request(app).post('/donations')).status).toBe(201);
    });

    it('observes a lock taken by another process once the TTL expires', async () => {
      process.env.ROTATION_LOCK_CACHE_TTL_MS = '0';
      const app = buildApp();
      await request(app).post('/donations');

      // Simulate rotateKEK.js writing directly to the table
      await Database.run("UPDATE rotation_locks SET status = 'in_progress' WHERE name = 'memoEncryption'");

      expect((await request(app).post('/donations')).status).toBe(503);
    });
  });
});
