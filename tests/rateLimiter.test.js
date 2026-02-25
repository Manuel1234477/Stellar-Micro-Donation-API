/**
 * Rate Limiter Integration Tests
 */

const request = require('supertest');
const express = require('express');
const rateLimiter = require('../src/middleware/rateLimiter');

describe('Rate Limiter Middleware', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
  });

  describe('API Key Validation', () => {
    test('should reject request without X-API-Key header', async () => {
      app.use(rateLimiter({ limit: 10, windowMs: 1000 }));
      app.get('/test', (req, res) => res.json({ success: true }));

      const response = await request(app).get('/test');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('MISSING_API_KEY');
    });

    test('should reject request with empty X-API-Key header', async () => {
      app.use(rateLimiter({ limit: 10, windowMs: 1000 }));
      app.get('/test', (req, res) => res.json({ success: true }));

      const response = await request(app)
        .get('/test')
        .set('X-API-Key', '');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('MISSING_API_KEY');
    });

    test('should accept request with valid X-API-Key header', async () => {
      app.use(rateLimiter({ limit: 10, windowMs: 1000 }));
      app.get('/test', (req, res) => res.json({ success: true }));

      const response = await request(app)
        .get('/test')
        .set('X-API-Key', 'test-key');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('Rate Limit Enforcement', () => {
    test('should allow requests within limit', async () => {
      app.use(rateLimiter({ limit: 5, windowMs: 1000 }));
      app.get('/test', (req, res) => res.json({ success: true }));

      for (let i = 0; i < 5; i++) {
        const response = await request(app)
          .get('/test')
          .set('X-API-Key', 'test-key');

        expect(response.status).toBe(200);
      }
    });

    test('should reject requests exceeding limit', async () => {
      app.use(rateLimiter({ limit: 3, windowMs: 1000 }));
      app.get('/test', (req, res) => res.json({ success: true }));

      // Make 3 successful requests
      for (let i = 0; i < 3; i++) {
        await request(app)
          .get('/test')
          .set('X-API-Key', 'test-key');
      }

      // 4th request should be rate limited
      const response = await request(app)
        .get('/test')
        .set('X-API-Key', 'test-key');

      expect(response.status).toBe(429);
      expect(response.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(response.body.error.limit).toBe(3);
    });

    test('should reset count after window expires', async (done) => {
      const windowMs = 500;
      app.use(rateLimiter({ limit: 2, windowMs }));
      app.get('/test', (req, res) => res.json({ success: true }));

      // Make 2 requests
      await request(app).get('/test').set('X-API-Key', 'test-key');
      await request(app).get('/test').set('X-API-Key', 'test-key');

      // Wait for window to expire
      setTimeout(async () => {
        const response = await request(app)
          .get('/test')
          .set('X-API-Key', 'test-key');

        expect(response.status).toBe(200);
        done();
      }, windowMs + 50);
    });
  });

  describe('API Key Isolation', () => {
    test('should maintain separate counts for different API keys', async () => {
      app.use(rateLimiter({ limit: 2, windowMs: 1000 }));
      app.get('/test', (req, res) => res.json({ success: true }));

      // Key1: 2 requests (at limit)
      await request(app).get('/test').set('X-API-Key', 'key1');
      await request(app).get('/test').set('X-API-Key', 'key1');

      // Key2: should still work
      const response = await request(app)
        .get('/test')
        .set('X-API-Key', 'key2');

      expect(response.status).toBe(200);

      // Key1: should be rate limited
      const response2 = await request(app)
        .get('/test')
        .set('X-API-Key', 'key1');

      expect(response2.status).toBe(429);
    });
  });

  describe('Rate Limit Headers', () => {
    test('should include rate limit headers in successful response', async () => {
      app.use(rateLimiter({ limit: 10, windowMs: 1000 }));
      app.get('/test', (req, res) => res.json({ success: true }));

      const response = await request(app)
        .get('/test')
        .set('X-API-Key', 'test-key');

      expect(response.headers['x-ratelimit-limit']).toBe('10');
      expect(response.headers['x-ratelimit-remaining']).toBe('9');
      expect(response.headers['x-ratelimit-reset']).toBeDefined();
    });

    test('should include rate limit headers in rate limited response', async () => {
      app.use(rateLimiter({ limit: 1, windowMs: 1000 }));
      app.get('/test', (req, res) => res.json({ success: true }));

      // First request
      await request(app).get('/test').set('X-API-Key', 'test-key');

      // Second request (rate limited)
      const response = await request(app)
        .get('/test')
        .set('X-API-Key', 'test-key');

      expect(response.headers['x-ratelimit-limit']).toBe('1');
      expect(response.headers['x-ratelimit-remaining']).toBe('0');
      expect(response.headers['x-ratelimit-reset']).toBeDefined();
    });

    test('should update remaining count correctly', async () => {
      app.use(rateLimiter({ limit: 5, windowMs: 1000 }));
      app.get('/test', (req, res) => res.json({ success: true }));

      const response1 = await request(app)
        .get('/test')
        .set('X-API-Key', 'test-key');
      expect(response1.headers['x-ratelimit-remaining']).toBe('4');

      const response2 = await request(app)
        .get('/test')
        .set('X-API-Key', 'test-key');
      expect(response2.headers['x-ratelimit-remaining']).toBe('3');
    });
  });

  describe('Error Response Format', () => {
    test('should return correct error format for rate limit exceeded', async () => {
      app.use(rateLimiter({ limit: 1, windowMs: 1000 }));
      app.get('/test', (req, res) => res.json({ success: true }));

      await request(app).get('/test').set('X-API-Key', 'test-key');

      const response = await request(app)
        .get('/test')
        .set('X-API-Key', 'test-key');

      expect(response.body).toMatchObject({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: expect.any(String),
          limit: 1,
          resetAt: expect.any(String)
        }
      });
    });
  });

  describe('Middleware Flow Control', () => {
    test('should call next() when within limit', async () => {
      const nextMock = jest.fn((req, res) => res.json({ success: true }));
      
      app.use(rateLimiter({ limit: 10, windowMs: 1000 }));
      app.get('/test', nextMock);

      await request(app).get('/test').set('X-API-Key', 'test-key');

      expect(nextMock).toHaveBeenCalled();
    });

    test('should not call next() when rate limited', async () => {
      const nextMock = jest.fn((req, res) => res.json({ success: true }));
      
      app.use(rateLimiter({ limit: 1, windowMs: 1000 }));
      app.get('/test', nextMock);

      await request(app).get('/test').set('X-API-Key', 'test-key');
      await request(app).get('/test').set('X-API-Key', 'test-key');

      // Should be called only once (first request)
      expect(nextMock).toHaveBeenCalledTimes(1);
    });
  });
});
