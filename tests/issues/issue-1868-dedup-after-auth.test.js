'use strict';
/**
 * Issue #1868 — deduplication replays must not bypass authentication, and every
 * replay must be audit-logged.
 */
const request = require('supertest');
const express = require('express');

jest.mock('../../src/services/AuditLogService', () => ({
  log: jest.fn().mockResolvedValue({}),
  CATEGORY: { API_KEY_MANAGEMENT: 'API_KEY_MANAGEMENT' },
  SEVERITY: { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH' },
}));

const AuditLogService = require('../../src/services/AuditLogService');
const { createDeduplicationMiddleware, clearCache } = require('../../src/middleware/deduplication');

function buildApp(handler, revoked) {
  const app = express();
  app.use(express.json());
  // Stands in for requireApiKey: reads the key and rejects revoked keys.
  const authenticate = (req, res, next) => {
    const key = req.headers['x-api-key'];
    if (!key || revoked.has(key)) {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED' } });
    }
    req.apiKey = { id: key, role: 'user' };
    next();
  };
  // Mounted in the same order as bootstrap/middleware.js: dedup runs before route auth.
  app.use(createDeduplicationMiddleware({ ttlMs: 60000 }));
  app.post('/donations', authenticate, handler);
  return app;
}

describe('Issue #1868: deduplication must run after authentication', () => {
  beforeEach(() => {
    clearCache();
    AuditLogService.log.mockClear();
  });

  it('returns 401 for a revoked key even if an identical request was cached', async () => {
    const revoked = new Set();
    const handler = jest.fn((req, res) => res.status(201).json({ ok: true }));
    const app = buildApp(handler, revoked);
    const body = { amount: 10, recipient: 'GABC' };

    const first = await request(app).post('/donations').set('x-api-key', 'key-A').send(body);
    expect(first.status).toBe(201);

    revoked.add('key-A');
    const replay = await request(app).post('/donations').set('x-api-key', 'key-A').send(body);

    expect(replay.status).toBe(401);
    expect(replay.headers['x-deduplicated']).toBeUndefined();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('audit-logs a deduplicated replay with deduplicated: true', async () => {
    const app = buildApp(
      (req, res) => res.status(201).json({ ok: true }),
      new Set()
    );
    const body = { amount: 10, recipient: 'GABC' };

    await request(app).post('/donations').set('x-api-key', 'key-B').send(body);
    const replay = await request(app).post('/donations').set('x-api-key', 'key-B').send(body);

    expect(replay.headers['x-deduplicated']).toBe('true');
    expect(JSON.stringify(AuditLogService.log.mock.calls)).toContain('"deduplicated":true');
  });
});
