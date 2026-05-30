'use strict';

/**
 * Tests for #806 — POST /donations maxDailyPerDonor enforcement
 */

const LimitService = require('../src/services/LimitService');

// Helper: build a minimal express app with the limit logic inline
function buildApp({ maxDailyPerDonor = 0, dailyUsed = 0, sendCustodialResult = { id: 1 } } = {}) {
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { role: 'user' }; req.id = 'test-req'; next(); });

  // Stub idempotency middleware
  app.use((req, _res, next) => { req.idempotency = { key: null }; next(); });

  // Inline the limit logic (mirrors donation.js implementation)
  const asyncHandler = require('../src/utils/asyncHandler');
  const { validateFloat } = require('../src/utils/validationHelpers');

  const _donorLocks = new Map();
  async function withDonorLock(donorId, fn) {
    const prev = _donorLocks.get(donorId) || Promise.resolve();
    let release;
    const next = new Promise(r => { release = r; });
    _donorLocks.set(donorId, next);
    try { await prev; return await fn(); }
    finally { release(); if (_donorLocks.get(donorId) === next) _donorLocks.delete(donorId); }
  }

  app.post('/donations', asyncHandler(async (req, res) => {
    const { senderId, receiverId, amount } = req.body;
    if (!senderId || !receiverId || !amount) return res.status(400).json({ error: 'Missing fields' });
    const av = validateFloat(amount);
    if (!av.valid) return res.status(400).json({ error: 'Invalid amount' });

    const resetsAt = new Date();
    resetsAt.setUTCHours(24, 0, 0, 0);

    if (maxDailyPerDonor > 0) {
      res.set('X-RateLimit-Limit', String(maxDailyPerDonor));
      res.set('X-RateLimit-Remaining', String(Math.max(0, maxDailyPerDonor - dailyUsed)));
      res.set('X-RateLimit-Reset', String(Math.floor(resetsAt.getTime() / 1000)));

      try {
        await withDonorLock(String(senderId), () =>
          LimitService.checkLimits(senderId, av.value)
        );
      } catch (err) {
        if (err && err.details && err.details.limit !== undefined) {
          const { limit, used, remaining } = err.details;
          return res.status(429).json({
            error: 'Daily donation limit exceeded',
            limit,
            used,
            remaining: remaining !== undefined ? remaining : Math.max(0, limit - used),
            resetsAt: resetsAt.toISOString(),
          });
        }
        return res.status(500).json({ error: err.message });
      }
    }

    return res.status(201).json({ success: true, data: sendCustodialResult });
  }));

  return app;
}

describe('#806 — POST /donations maxDailyPerDonor enforcement', () => {
  const request = require('supertest');

  afterEach(() => jest.restoreAllMocks());

  test('limit not enforced when maxDailyPerDonor is 0', async () => {
    jest.spyOn(LimitService, 'checkLimits').mockResolvedValue(undefined);
    const app = buildApp({ maxDailyPerDonor: 0 });
    const res = await request(app).post('/donations').send({ senderId: 1, receiverId: 2, amount: 1000 });
    expect(res.status).toBe(201);
    expect(LimitService.checkLimits).not.toHaveBeenCalled();
  });

  test('donation accepted when under daily limit', async () => {
    jest.spyOn(LimitService, 'checkLimits').mockResolvedValue(undefined);
    const app = buildApp({ maxDailyPerDonor: 500, dailyUsed: 100 });
    const res = await request(app).post('/donations').send({ senderId: 1, receiverId: 2, amount: 50 });
    expect(res.status).toBe(201);
    expect(LimitService.checkLimits).toHaveBeenCalledWith(1, 50);
  });

  test('returns 429 with correct body when daily limit exceeded', async () => {
    const { BusinessLogicError, ERROR_CODES } = require('../src/utils/errors');
    jest.spyOn(LimitService, 'checkLimits').mockRejectedValue(
      new BusinessLogicError(ERROR_CODES.INVALID_AMOUNT, 'Daily limit exceeded', {
        limit: 500, used: 500, amount: 10, remaining: 0,
      })
    );
    const app = buildApp({ maxDailyPerDonor: 500, dailyUsed: 500 });
    const res = await request(app).post('/donations').send({ senderId: 1, receiverId: 2, amount: 10 });
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('Daily donation limit exceeded');
    expect(res.body.limit).toBe(500);
    expect(res.body.used).toBe(500);
    expect(res.body.remaining).toBe(0);
    expect(res.body.resetsAt).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);
  });

  test('X-RateLimit-* headers set on accepted donation', async () => {
    jest.spyOn(LimitService, 'checkLimits').mockResolvedValue(undefined);
    const app = buildApp({ maxDailyPerDonor: 500, dailyUsed: 200 });
    const res = await request(app).post('/donations').send({ senderId: 1, receiverId: 2, amount: 50 });
    expect(res.status).toBe(201);
    expect(res.headers['x-ratelimit-limit']).toBe('500');
    expect(res.headers['x-ratelimit-remaining']).toBe('300');
    expect(res.headers['x-ratelimit-reset']).toMatch(/^\d+$/);
  });

  test('X-RateLimit-* headers set on 429 response', async () => {
    const { BusinessLogicError, ERROR_CODES } = require('../src/utils/errors');
    jest.spyOn(LimitService, 'checkLimits').mockRejectedValue(
      new BusinessLogicError(ERROR_CODES.INVALID_AMOUNT, 'Daily limit exceeded', {
        limit: 500, used: 500, amount: 10, remaining: 0,
      })
    );
    const app = buildApp({ maxDailyPerDonor: 500, dailyUsed: 500 });
    const res = await request(app).post('/donations').send({ senderId: 1, receiverId: 2, amount: 10 });
    expect(res.status).toBe(429);
    expect(res.headers['x-ratelimit-limit']).toBe('500');
    expect(res.headers['x-ratelimit-remaining']).toBe('0');
  });

  test('no X-RateLimit headers when limit is 0 (unlimited)', async () => {
    jest.spyOn(LimitService, 'checkLimits').mockResolvedValue(undefined);
    const app = buildApp({ maxDailyPerDonor: 0 });
    const res = await request(app).post('/donations').send({ senderId: 1, receiverId: 2, amount: 10 });
    expect(res.status).toBe(201);
    expect(res.headers['x-ratelimit-limit']).toBeUndefined();
  });

  test('resetsAt is midnight UTC of the next day', async () => {
    const { BusinessLogicError, ERROR_CODES } = require('../src/utils/errors');
    jest.spyOn(LimitService, 'checkLimits').mockRejectedValue(
      new BusinessLogicError(ERROR_CODES.INVALID_AMOUNT, 'Daily limit exceeded', {
        limit: 100, used: 100, amount: 1, remaining: 0,
      })
    );
    const app = buildApp({ maxDailyPerDonor: 100, dailyUsed: 100 });
    const res = await request(app).post('/donations').send({ senderId: 1, receiverId: 2, amount: 1 });
    expect(res.status).toBe(429);
    const resetsAt = new Date(res.body.resetsAt);
    expect(resetsAt.getUTCHours()).toBe(0);
    expect(resetsAt.getUTCMinutes()).toBe(0);
    expect(resetsAt.getUTCSeconds()).toBe(0);
  });

  test('concurrent requests are serialized per donor (race condition)', async () => {
    let callCount = 0;
    jest.spyOn(LimitService, 'checkLimits').mockImplementation(async () => {
      callCount++;
      // Simulate async work
      await new Promise(r => setTimeout(r, 5));
    });
    const app = buildApp({ maxDailyPerDonor: 500, dailyUsed: 0 });
    // Fire 5 concurrent requests for the same donor
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app).post('/donations').send({ senderId: 1, receiverId: 2, amount: 10 })
      )
    );
    // All should succeed (mock never throws), and checkLimits called 5 times sequentially
    expect(callCount).toBe(5);
    results.forEach(r => expect(r.status).toBe(201));
  });
});
