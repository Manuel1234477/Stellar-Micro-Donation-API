'use strict';
/**
 * Issue #1867 — body-hash deduplication must be scoped to the authenticated
 * principal, not shared across all JWT callers in the "anonymous" bucket.
 */
const request = require('supertest');
const express = require('express');
const { createDeduplicationMiddleware, clearCache } = require('../../src/middleware/deduplication');

function buildApp(handler) {
  const app = express();
  app.use(express.json());
  // Stands in for attachUserRole: sets req.user from a JWT subject header.
  app.use((req, res, next) => {
    const sub = req.headers['x-test-sub'];
    if (sub) req.user = { id: sub };
    next();
  });
  app.use(createDeduplicationMiddleware({ ttlMs: 60000 }));
  app.post('/donations/recurring/pause', handler);
  return app;
}

describe('Issue #1867: deduplication keyed on the authenticated principal', () => {
  beforeEach(() => {
    clearCache();
  });

  it('executes identical requests from two different JWT subjects', async () => {
    const handler = jest.fn((req, res) => res.status(200).json({ owner: req.user.id }));
    const app = buildApp(handler);

    const first = await request(app)
      .post('/donations/recurring/pause')
      .set('x-test-sub', 'user-alice')
      .send({ amount: 5 });
    const second = await request(app)
      .post('/donations/recurring/pause')
      .set('x-test-sub', 'user-bob')
      .send({ amount: 5 });

    expect(handler).toHaveBeenCalledTimes(2);
    expect(second.headers['x-deduplicated']).toBeUndefined();
    expect(second.body.owner).toBe('user-bob');
    expect(first.body.owner).toBe('user-alice');
  });

  it('never serves an unauthenticated request from the dedup cache', async () => {
    const handler = jest.fn((req, res) => res.status(200).json({ ok: true }));
    const app = buildApp(handler);

    await request(app).post('/donations/recurring/pause').send({ amount: 5 });
    const second = await request(app).post('/donations/recurring/pause').send({ amount: 5 });

    expect(handler).toHaveBeenCalledTimes(2);
    expect(second.headers['x-deduplicated']).toBeUndefined();
  });

  it('does not deduplicate requests that differ only in query string', async () => {
    const handler = jest.fn((req, res) => res.status(200).json({ dryRun: req.query.dryRun }));
    const app = buildApp(handler);

    const first = await request(app)
      .post('/donations/recurring/pause?dryRun=true')
      .set('x-test-sub', 'user-alice')
      .send({ amount: 5 });
    const second = await request(app)
      .post('/donations/recurring/pause?dryRun=false')
      .set('x-test-sub', 'user-alice')
      .send({ amount: 5 });

    expect(first.body.dryRun).toBe('true');
    expect(second.body.dryRun).toBe('false');
    expect(second.headers['x-deduplicated']).toBeUndefined();
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
