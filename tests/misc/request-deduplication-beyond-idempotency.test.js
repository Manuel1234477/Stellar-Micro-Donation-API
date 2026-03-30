const request = require('supertest');
const express = require('express');
const Cache = require('../../src/utils/cache');
const { createDeduplicationMiddleware } = require('../../src/middleware/deduplication');

function buildTestApp(options) {
  const app = express();
  app.use(express.json());
  app.use(createDeduplicationMiddleware(options));
  app.post('/test', (req, res) => {
    res.status(201).json({ success: true, data: { id: 1 } });
  });
  app.put('/test', (req, res) => {
    res.status(200).json({ success: true, data: { updated: true } });
  });
  app.patch('/test', (req, res) => {
    res.status(200).json({ success: true, data: { patched: true } });
  });
  app.get('/test', (req, res) => {
    res.status(200).json({ success: true, data: { list: [] } });
  });
  app.post('/other', (req, res) => {
    res.status(201).json({ success: true, data: { id: 2 } });
  });
  app.post('/error', (req, res) => {
    res.status(400).json({ success: false, error: { message: 'Bad request' } });
  });
  return app;
}

describe('Request Deduplication Middleware', () => {
  beforeEach(() => {
    Cache.clearPrefix('dedup:');
  });
  describe('cache miss and cache hit', () => {
    test('first request passes through and returns normally', async () => {
      const app = buildTestApp();
      const res = await request(app)
        .post('/test')
        .send({ amount: 10 });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ success: true, data: { id: 1 } });
      expect(res.headers['x-deduplicated']).toBeUndefined();
    });

    test('identical second request within 30s returns cached response with X-Deduplicated header', async () => {
      const app = buildTestApp();
      const body = { amount: 10 };

      await request(app).post('/test').send(body);
      const res = await request(app).post('/test').send(body);

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ success: true, data: { id: 1 } });
      expect(res.headers['x-deduplicated']).toBe('true');
    });
  });

  describe('fingerprint differentiation', () => {
    test('different request bodies are not deduplicated', async () => {
      const app = buildTestApp();

      await request(app).post('/test').send({ amount: 10 });
      const res = await request(app).post('/test').send({ amount: 20 });

      expect(res.status).toBe(201);
      expect(res.headers['x-deduplicated']).toBeUndefined();
    });

    test('different paths are not deduplicated', async () => {
      const app = buildTestApp();
      const body = { amount: 10 };

      await request(app).post('/test').send(body);
      const res = await request(app).post('/other').send(body);

      expect(res.status).toBe(201);
      expect(res.headers['x-deduplicated']).toBeUndefined();
    });

    test('different API keys are not deduplicated', async () => {
      const app = buildTestApp();
      const body = { amount: 10 };

      await request(app).post('/test').set('x-api-key', 'key-a').send(body);
      const res = await request(app).post('/test').set('x-api-key', 'key-b').send(body);

      expect(res.status).toBe(201);
      expect(res.headers['x-deduplicated']).toBeUndefined();
    });
  });

  describe('method filtering', () => {
    test('GET requests are never deduplicated', async () => {
      const app = buildTestApp();

      const res1 = await request(app).get('/test');
      const res2 = await request(app).get('/test');

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res2.headers['x-deduplicated']).toBeUndefined();
    });

    test('PUT requests are deduplicated', async () => {
      const app = buildTestApp();
      const body = { name: 'updated' };

      await request(app).put('/test').send(body);
      const res = await request(app).put('/test').send(body);

      expect(res.status).toBe(200);
      expect(res.headers['x-deduplicated']).toBe('true');
    });

    test('PATCH requests are deduplicated', async () => {
      const app = buildTestApp();
      const body = { name: 'patched' };

      await request(app).patch('/test').send(body);
      const res = await request(app).patch('/test').send(body);

      expect(res.status).toBe(200);
      expect(res.headers['x-deduplicated']).toBe('true');
    });
  });

  describe('error response handling', () => {
    test('error responses (4xx/5xx) are not cached for replay', async () => {
      const app = buildTestApp();
      const body = { bad: 'data' };

      await request(app).post('/error').send(body);
      const res = await request(app).post('/error').send(body);

      expect(res.status).toBe(400);
      expect(res.headers['x-deduplicated']).toBeUndefined();
    });
  });

  describe('TTL expiry', () => {
    test('duplicate after TTL expiry is treated as new request', async () => {
      const app = buildTestApp({ ttlMs: 100 });
      const body = { amount: 10 };

      await request(app).post('/test').send(body);

      await new Promise(resolve => setTimeout(resolve, 150));

      const res = await request(app).post('/test').send(body);

      expect(res.status).toBe(201);
      expect(res.headers['x-deduplicated']).toBeUndefined();
    });
  });

  describe('idempotency key interaction', () => {
    test('request with Idempotency-Key header skips deduplication', async () => {
      const app = buildTestApp();
      const body = { amount: 10 };

      await request(app).post('/test').send(body);
      const res = await request(app)
        .post('/test')
        .set('Idempotency-Key', 'unique-key-123')
        .send(body);

      expect(res.status).toBe(201);
      expect(res.headers['x-deduplicated']).toBeUndefined();
    });

    test('request with x-idempotency-key header skips deduplication', async () => {
      const app = buildTestApp();
      const body = { amount: 10 };

      await request(app).post('/test').send(body);
      const res = await request(app)
        .post('/test')
        .set('x-idempotency-key', 'unique-key-456')
        .send(body);

      expect(res.status).toBe(201);
      expect(res.headers['x-deduplicated']).toBeUndefined();
    });
  });

  describe('edge cases', () => {
    test('empty body produces valid fingerprint and deduplicates', async () => {
      const app = buildTestApp();

      const res1 = await request(app).post('/test').send();
      const res2 = await request(app).post('/test').send();

      expect(res1.status).toBe(201);
      expect(res2.status).toBe(201);
      expect(res1.headers['x-deduplicated']).toBeUndefined();
      expect(res2.headers['x-deduplicated']).toBe('true');
    });

    test('concurrent identical requests both proceed (no locking)', async () => {
      let callCount = 0;
      const app = express();
      app.use(express.json());
      app.use(createDeduplicationMiddleware());
      app.post('/slow', async (req, res) => {
        callCount++;
        await new Promise(resolve => setTimeout(resolve, 50));
        res.status(201).json({ success: true, data: { call: callCount } });
      });

      const body = { amount: 10 };
      const [res1, res2] = await Promise.all([
        request(app).post('/slow').send(body),
        request(app).post('/slow').send(body),
      ]);

      expect(res1.status).toBe(201);
      expect(res2.status).toBe(201);
      expect(callCount).toBe(2);
    });
  });

  describe('error resilience', () => {
    test('middleware continues if fingerprint computation throws', async () => {
      const app = express();
      app.use(express.json());
      // Insert middleware that makes body non-serializable BEFORE dedup
      app.use((req, res, next) => {
        const circular = {};
        circular.self = circular;
        req.body = circular;
        next();
      });
      app.use(createDeduplicationMiddleware());
      app.post('/test', (req, res) => {
        res.status(201).json({ success: true });
      });

      const res = await request(app).post('/test').send({ amount: 10 });
      expect(res.status).toBe(201);
    });

    test('middleware continues if Cache.set throws', async () => {
      const Cache = require('../../src/utils/cache');
      const originalSet = Cache.set;
      Cache.set = () => { throw new Error('cache failure'); };

      const app = buildTestApp();
      const res = await request(app).post('/test').send({ amount: 99 });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ success: true, data: { id: 1 } });

      Cache.set = originalSet;
    });
  });
});
