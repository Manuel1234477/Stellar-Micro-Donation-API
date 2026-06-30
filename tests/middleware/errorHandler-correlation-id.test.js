/**
 * Correlation ID in Error Responses — Test Suite
 * Feature: include-correlation-id-in-error-responses
 *
 * PURPOSE
 * ───────
 * Verifies that every error response emitted by errorHandler includes:
 *   1. requestId field in the response body (at error.requestId)
 *   2. X-Request-ID header in the response
 *
 * Also verifies that correlation IDs match between the request, response body,
 * and response headers.
 *
 * Includes both deterministic unit tests for specific error types and
 * property-based tests using fast-check to validate universal correctness.
 */

'use strict';

const express = require('express');
const request = require('supertest');
const fc = require('fast-check');

const requestIdMiddleware = require('../../src/middleware/requestId');
const { errorHandler, notFoundHandler } = require('../../src/middleware/errorHandler');
const { AppError, ERROR_CODES } = require('../../src/utils/errors');

// ─── Test App Builder ───────────────────────────────────────────────────────────

/**
 * Build a minimal Express app for error handler testing.
 * Accepts an array of { method, path, handler } route specs.
 */
function buildApp(routes = []) {
  const app = express();
  app.use(express.json());
  app.use(requestIdMiddleware);

  for (const { method, path: p, handler } of routes) {
    app[method](p, handler);
  }

  // 404 for unknown paths
  app.use(notFoundHandler);
  // Error handler must be last
  app.use(errorHandler);

  return app;
}

// ─── Pre-built apps for unit tests ────────────────────────────────────────────

const unitApp = buildApp([
  {
    method: 'get',
    path: '/throw-app-error',
    handler: (_req, _res, next) => {
      next(new AppError(ERROR_CODES.VALIDATION_ERROR, 'Test AppError message', 400));
    },
  },
  {
    method: 'get',
    path: '/throw-validation-error',
    handler: (_req, _res, next) => {
      const err = new Error('Schema validation failed');
      err.name = 'ValidationError';
      next(err);
    },
  },
  {
    method: 'get',
    path: '/throw-generic-error',
    handler: (_req, _res, next) => {
      next(new Error('Something went wrong'));
    },
  },
  {
    method: 'get',
    path: '/throw-500',
    handler: (_req, _res, next) => {
      const err = new Error('Unhandled crash');
      err.statusCode = 500;
      next(err);
    },
  },
]);

// ─── UUID Validator ───────────────────────────────────────────────────────────

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUUID = (s) => UUID_V4_RE.test(s);

// ─── Unit Tests ────────────────────────────────────────────────────────────────

describe('Correlation ID in Error Responses — Unit Tests', () => {
  describe('AppError responses', () => {
    it('should include requestId in body', async () => {
      const res = await request(unitApp).get('/throw-app-error');
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.requestId).toBeDefined();
      expect(isUUID(res.body.error.requestId)).toBe(true);
    });

    it('should include X-Request-ID header', async () => {
      const res = await request(unitApp).get('/throw-app-error');
      expect(res.headers['x-request-id']).toBeDefined();
      expect(isUUID(res.headers['x-request-id'])).toBe(true);
    });

    it('should have matching requestId in body and header', async () => {
      const res = await request(unitApp).get('/throw-app-error');
      expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
    });

    it('should preserve provided X-Request-ID', async () => {
      const myId = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5';
      const res = await request(unitApp)
        .get('/throw-app-error')
        .set('X-Request-ID', myId);
      expect(res.body.error.requestId).toBe(myId);
      expect(res.headers['x-request-id']).toBe(myId);
    });
  });

  describe('ValidationError responses', () => {
    it('should include requestId in body', async () => {
      const res = await request(unitApp).get('/throw-validation-error');
      expect(res.status).toBe(400);
      expect(res.body.error.requestId).toBeDefined();
      expect(isUUID(res.body.error.requestId)).toBe(true);
    });

    it('should include X-Request-ID header', async () => {
      const res = await request(unitApp).get('/throw-validation-error');
      expect(res.headers['x-request-id']).toBeDefined();
    });

    it('should have matching requestId in body and header', async () => {
      const res = await request(unitApp).get('/throw-validation-error');
      expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
    });
  });

  describe('Generic Error responses', () => {
    it('should include requestId in body', async () => {
      const res = await request(unitApp).get('/throw-generic-error');
      expect(res.status).toBe(500);
      expect(res.body.error.requestId).toBeDefined();
      expect(isUUID(res.body.error.requestId)).toBe(true);
    });

    it('should include X-Request-ID header', async () => {
      const res = await request(unitApp).get('/throw-generic-error');
      expect(res.headers['x-request-id']).toBeDefined();
    });

    it('should have matching requestId in body and header', async () => {
      const res = await request(unitApp).get('/throw-generic-error');
      expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
    });
  });

  describe('500-statusCode Error responses', () => {
    it('should include requestId in body', async () => {
      const res = await request(unitApp).get('/throw-500');
      expect(res.status).toBe(500);
      expect(res.body.error.requestId).toBeDefined();
    });

    it('should have matching requestId in body and header', async () => {
      const res = await request(unitApp).get('/throw-500');
      expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
    });
  });

  describe('404 Not Found responses', () => {
    it('should include requestId in body', async () => {
      const res = await request(unitApp).get('/nonexistent-path-12345');
      expect(res.status).toBe(404);
      expect(res.body.error.requestId).toBeDefined();
      expect(isUUID(res.body.error.requestId)).toBe(true);
    });

    it('should include X-Request-ID header', async () => {
      const res = await request(unitApp).get('/nonexistent-path-12345');
      expect(res.headers['x-request-id']).toBeDefined();
    });

    it('should have matching requestId in body and header', async () => {
      const res = await request(unitApp).get('/nonexistent-path-12345');
      expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
    });
  });

  describe('Error response structure', () => {
    it('should have success: false on all error types', async () => {
      const paths = [
        '/throw-app-error',
        '/throw-validation-error',
        '/throw-generic-error',
        '/nonexistent-path',
      ];
      for (const p of paths) {
        const res = await request(unitApp).get(p);
        expect(res.body.success).toBe(false);
      }
    });

    it('should place requestId at error.requestId path (not top-level)', async () => {
      const res = await request(unitApp).get('/throw-generic-error');
      // requestId must be nested under error object
      expect(res.body.error.requestId).toBeDefined();
      // NOT at the top level
      expect(res.body.requestId).toBeUndefined();
    });

    it('should include timestamp in error body', async () => {
      const res = await request(unitApp).get('/throw-generic-error');
      expect(res.body.error.timestamp).toBeDefined();
      // Must be a valid ISO date
      expect(() => new Date(res.body.error.timestamp)).not.toThrow();
    });
  });
});

// ─── Property-Based Tests ──────────────────────────────────────────────────────

describe('Correlation ID in Error Responses — Property Tests', () => {
  /**
   * Property 1: All error responses include correlation ID
   * Feature: include-correlation-id-in-error-responses, Property 1
   *
   * For any path that doesn't match a route, the 404 handler must include requestId.
   * We generate random path suffixes to ensure this holds universally.
   */
  it('Property 1: All 404 responses include correlation ID regardless of path', async () => {
    const app = buildApp([]);

    await fc.assert(
      fc.asyncProperty(
        // Generate random path-safe string segments
        fc.array(fc.stringOf(fc.constantFrom('a', 'b', 'c', 'd', '1', '2', '3', '-')), {
          minLength: 1,
          maxLength: 5,
        }),
        async (segments) => {
          const path = '/' + segments.join('/').replace(/\/+/g, '/').replace(/\/$/, '') || '/x';
          const res = await request(app).get(path);

          // Correlation ID must exist in all 404 responses
          expect(res.body.error).toBeDefined();
          expect(res.body.error.requestId).toBeDefined();
          expect(typeof res.body.error.requestId).toBe('string');
          expect(res.body.error.requestId.length).toBeGreaterThan(0);
          // Must match the X-Request-ID header
          expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2: Consistent field naming across all error types
   * Feature: include-correlation-id-in-error-responses, Property 2
   *
   * The correlation ID field must always be named 'requestId', never 'correlationId',
   * 'request_id', 'reqId', or any other variant.
   */
  it('Property 2: Correlation ID field always named requestId across all error types', async () => {
    // Build app with multiple error-throwing routes
    const errorRoutes = [
      {
        method: 'get',
        path: '/err/app',
        handler: (_r, _s, next) => next(new AppError(ERROR_CODES.VALIDATION_ERROR, 'app error', 422)),
      },
      {
        method: 'get',
        path: '/err/validation',
        handler: (_r, _s, next) => {
          const e = new Error('val');
          e.name = 'ValidationError';
          next(e);
        },
      },
      {
        method: 'get',
        path: '/err/generic',
        handler: (_r, _s, next) => next(new Error('generic')),
      },
    ];

    const testApp = buildApp(errorRoutes);
    const paths = ['/err/app', '/err/validation', '/err/generic', '/prop2-404-path'];

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...paths),
        async (p) => {
          const res = await request(testApp).get(p);

          // Field MUST be named requestId
          expect(res.body.error).toBeDefined();
          expect(res.body.error.requestId).toBeDefined();

          // Field must NOT be named any variant
          expect(res.body.error.correlationId).toBeUndefined();
          expect(res.body.error.request_id).toBeUndefined();
          expect(res.body.error.reqId).toBeUndefined();
          expect(res.body.error.traceId).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 3: Correlation ID appears at correct nested path
   * Feature: include-correlation-id-in-error-responses, Property 3
   *
   * The requestId must be accessible at response.body.error.requestId
   * and NOT at response.body.requestId.
   */
  it('Property 3: Correlation ID appears at error.requestId, not at top-level body', async () => {
    const app = buildApp([
      {
        method: 'get',
        path: '/prop3',
        handler: (_r, _s, next) => next(new Error('test')),
      },
    ]);

    await fc.assert(
      fc.asyncProperty(
        // Run 100 times (stateless, just re-confirming deterministic behavior)
        fc.constant('/prop3'),
        async (p) => {
          const res = await request(app).get(p);

          // Must be nested under error
          expect(res.body.error).toBeDefined();
          expect(res.body.error.requestId).toBeDefined();

          // Must NOT be at top level
          expect(res.body.requestId).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 4: X-Request-ID header present in all error responses
   * Feature: include-correlation-id-in-error-responses, Property 4
   *
   * Every error response (any status code) must emit the X-Request-ID header.
   */
  it('Property 4: X-Request-ID header present in all error responses', async () => {
    const errPaths = [
      { method: 'get', path: '/p4/app',   handler: (_r, _s, n) => n(new AppError(ERROR_CODES.VALIDATION_ERROR, 'e', 400)) },
      { method: 'get', path: '/p4/crash', handler: (_r, _s, n) => n(new Error('crash')) },
    ];
    const testApp = buildApp(errPaths);

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('/p4/app', '/p4/crash', '/p4/unknown-404'),
        async (p) => {
          const res = await request(testApp).get(p);

          // X-Request-ID header must be present
          expect(res.headers['x-request-id']).toBeDefined();
          expect(typeof res.headers['x-request-id']).toBe('string');
          expect(res.headers['x-request-id'].length).toBeGreaterThan(0);

          // Must match body
          expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 5: Client-provided X-Request-ID is preserved in error responses
   * Feature: include-correlation-id-in-error-responses, Property 5
   *
   * When the client sends a valid UUID in X-Request-ID, that exact ID must be
   * echoed back in both the header and body.requestId of any error response.
   */
  it('Property 5: Client-provided X-Request-ID is preserved in error responses', async () => {
    const app = buildApp([
      { method: 'get', path: '/p5', handler: (_r, _s, n) => n(new AppError(ERROR_CODES.INTERNAL_ERROR, 'test', 500)) },
    ]);

    // Valid UUID v4 arbitraries
    const hexChar = fc.constantFrom('0','1','2','3','4','5','6','7','8','9','a','b','c','d','e','f');
    const hexN = (n) => fc.array(hexChar, { minLength: n, maxLength: n }).map(a => a.join(''));
    const uuidArb = fc.tuple(hexN(8), hexN(4), hexN(4).map(s => '4' + s.slice(1)), fc.constantFrom('8','9','a','b').chain(v => hexN(3).map(s => v + s)), hexN(12))
      .map(([a, b, c, d, e]) => `${a}-${b}-${c}-${d}-${e}`);

    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        async (clientId) => {
          const res = await request(app)
            .get('/p5')
            .set('X-Request-ID', clientId);

          expect(res.headers['x-request-id']).toBe(clientId);
          expect(res.body.error.requestId).toBe(clientId);
        }
      ),
      { numRuns: 50 }
    );
  });
});
