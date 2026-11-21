'use strict';
/**
 * Issue #1869 — the deduplication cache must be bounded in entry count and
 * stored body size, must not scan the whole cache on each request, and must
 * export size/hit metrics.
 */
const request = require('supertest');
const express = require('express');
const { createDeduplicationMiddleware, clearCache } = require('../../src/middleware/deduplication');
const { registry } = require('../../src/utils/metrics');

function buildApp(options) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(createDeduplicationMiddleware({ ttlMs: 60000, ...options }));
  app.post('/donations', (req, res) => res.status(201).json({ ok: true, body: req.body }));
  return app;
}

describe('Issue #1869: bounded deduplication cache', () => {
  beforeEach(() => {
    clearCache();
  });

  it('evicts the oldest entry once maxEntries is exceeded', async () => {
    const app = buildApp({ maxEntries: 5 });

    for (let i = 0; i < 10; i++) {
      await request(app).post('/donations').send({ amount: i });
    }

    // Entry 0 was pushed out by later writes, so the replay must reach the handler.
    const replay = await request(app).post('/donations').send({ amount: 0 });
    expect(replay.headers['x-deduplicated']).toBeUndefined();
  });

  it('does not cache responses larger than the configured body size limit', async () => {
    const app = buildApp({ maxBodyBytes: 16 * 1024 });
    const body = { note: 'x'.repeat(20 * 1024) };

    await request(app).post('/donations').send(body);
    const replay = await request(app).post('/donations').send(body);

    expect(replay.headers['x-deduplicated']).toBeUndefined();
  });

  it('does not iterate the whole cache on the request path', async () => {
    const app = buildApp({});
    const entriesSpy = jest.spyOn(Map.prototype, 'entries');

    try {
      for (let i = 0; i < 25; i++) {
        await request(app).post('/donations').send({ amount: i });
      }
      expect(entriesSpy).not.toHaveBeenCalled();
    } finally {
      entriesSpy.mockRestore();
    }
  });

  it('exports dedup_cache_entries and dedup_cache_hits_total metrics', () => {
    expect(registry.getSingleMetric('dedup_cache_entries')).toBeDefined();
    expect(registry.getSingleMetric('dedup_cache_hits_total')).toBeDefined();
  });
});
