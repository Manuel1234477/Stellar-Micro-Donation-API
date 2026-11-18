/**
 * Tests: API Response Envelope Standardization
 *
 * Covers responseFormatter utility functions and the Express middleware
 * that attaches res.success / res.failure helpers.
 * No live Stellar network required.
 */

const {
  successResponse,
  errorResponse,
  buildMeta,
  responseFormatterMiddleware,
} = require('../../src/utils/responseFormatter');

const express = require('express');
const request = require('supertest');

// ─── Unit tests: pure functions ──────────────────────────────────────────────

describe('buildMeta', () => {
  test('includes requestId, timestamp, and duration', () => {
    const start = Date.now() - 50;
    const meta = buildMeta('req-123', start);

    expect(meta.requestId).toBe('req-123');
    expect(typeof meta.timestamp).toBe('string');
    expect(new Date(meta.timestamp).toISOString()).toBe(meta.timestamp);
    expect(meta.duration).toBeGreaterThanOrEqual(50);
  });

  test('duration is 0 when startTime is omitted', () => {
    const meta = buildMeta('req-abc');
    expect(meta.duration).toBe(0);
  });

  test('requestId is null when omitted', () => {
    const meta = buildMeta();
    expect(meta.requestId).toBeNull();
  });
});

describe('successResponse', () => {
  test('returns correct envelope shape', () => {
    const res = successResponse({ id: 1 }, 'req-1', Date.now());

    expect(res.success).toBe(true);
    expect(res.data).toEqual({ id: 1 });
    expect(res.meta).toBeDefined();
    expect(res.meta.requestId).toBe('req-1');
    expect(typeof res.meta.timestamp).toBe('string');
    expect(typeof res.meta.duration).toBe('number');
  });

  test('data can be an array', () => {
    const res = successResponse([1, 2, 3], 'req-2', Date.now());
    expect(Array.isArray(res.data)).toBe(true);
  });

  test('data can be null', () => {
    const res = successResponse(null, 'req-3', Date.now());
    expect(res.data).toBeNull();
  });

  test('does not include error field', () => {
    const res = successResponse({}, 'req-4', Date.now());
    expect(res.error).toBeUndefined();
  });
});

describe('errorResponse', () => {
  test('returns correct envelope shape', () => {
    const res = errorResponse('NOT_FOUND', 'Resource not found', 'req-5', Date.now());

    expect(res.success).toBe(false);
    expect(res.error.code).toBe('NOT_FOUND');
    expect(res.error.message).toBe('Resource not found');
    expect(res.meta).toBeDefined();
    expect(res.meta.requestId).toBe('req-5');
  });

  test('includes details when provided', () => {
    const res = errorResponse('VALIDATION_ERROR', 'Bad input', 'req-6', Date.now(), { field: 'amount' });
    expect(res.error.details).toEqual({ field: 'amount' });
  });

  test('omits details field when not provided', () => {
    const res = errorResponse('INTERNAL_ERROR', 'Oops', 'req-7', Date.now());
    expect(Object.prototype.hasOwnProperty.call(res.error, 'details')).toBe(false);
  });

  test('does not include data field', () => {
    const res = errorResponse('ERR', 'msg', 'req-8', Date.now());
    expect(res.data).toBeUndefined();
  });
});

// ─── Integration tests: middleware + res helpers ──────────────────────────────

function createTestApp() {
  const app = express();
  app.use(express.json());

  // Simulate requestId middleware
  app.use((req, res, next) => { req.id = 'test-req-id'; next(); });

  app.use(responseFormatterMiddleware());

  app.get('/ok', (req, res) => res.success({ value: 42 }));
  app.get('/ok-201', (req, res) => res.success({ created: true }, 201));
  app.get('/fail', (req, res) => res.failure('NOT_FOUND', 'Not found', 404));
  app.get('/fail-details', (req, res) => res.failure('VALIDATION_ERROR', 'Bad input', 400, { field: 'x' }));
  app.get('/fail-default-status', (req, res) => res.failure('ERR', 'error'));

  return app;
}

describe('responseFormatterMiddleware', () => {
  let app;

  beforeAll(() => { app = createTestApp(); });

  // res.success ───────────────────────────────────────────────────────────────

  describe('res.success', () => {
    test('returns 200 with success envelope', async () => {
      const res = await request(app).get('/ok');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({ value: 42 });
    });

    test('meta contains requestId, timestamp, duration', async () => {
      const res = await request(app).get('/ok');

      expect(res.body.meta).toBeDefined();
      expect(res.body.meta.requestId).toBe('test-req-id');
      expect(typeof res.body.meta.timestamp).toBe('string');
      expect(typeof res.body.meta.duration).toBe('number');
      expect(res.body.meta.duration).toBeGreaterThanOrEqual(0);
    });

    test('respects custom status code', async () => {
      const res = await request(app).get('/ok-201');
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    test('does not include error field', async () => {
      const res = await request(app).get('/ok');
      expect(res.body.error).toBeUndefined();
    });
  });

  // res.failure ───────────────────────────────────────────────────────────────

  describe('res.failure', () => {
    test('returns correct status with error envelope', async () => {
      const res = await request(app).get('/fail');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.body.error.message).toBe('Not found');
    });

    test('meta contains requestId, timestamp, duration', async () => {
      const res = await request(app).get('/fail');

      expect(res.body.meta.requestId).toBe('test-req-id');
      expect(typeof res.body.meta.timestamp).toBe('string');
      expect(typeof res.body.meta.duration).toBe('number');
    });

    test('includes details when provided', async () => {
      const res = await request(app).get('/fail-details');
      expect(res.body.error.details).toEqual({ field: 'x' });
    });

    test('defaults to 400 when no status provided', async () => {
      const res = await request(app).get('/fail-default-status');
      expect(res.status).toBe(400);
    });

    test('does not include data field', async () => {
      const res = await request(app).get('/fail');
      expect(res.body.data).toBeUndefined();
    });
  });

  // req._startTime ────────────────────────────────────────────────────────────

  test('duration reflects actual processing time', async () => {
    const slowApp = express();
    slowApp.use((req, res, next) => { req.id = 'slow-req'; next(); });
    slowApp.use(responseFormatterMiddleware());
    slowApp.get('/slow', async (req, res) => {
      await new Promise(r => setTimeout(r, 30));
      res.success({ done: true });
    });

    const res = await request(slowApp).get('/slow');
    expect(res.body.meta.duration).toBeGreaterThanOrEqual(30);
  });
});
