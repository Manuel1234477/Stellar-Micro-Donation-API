/**
 * Tests: Fix error handler to always return JSON responses
 * Verifies that every error path — 400, 401, 403, 404, 422, 429, 500 — returns
 * valid JSON with Content-Type: application/json, never HTML.
 * No live Stellar network required.
 */

const request = require('supertest');
const express = require('express');

// ─── Build a fresh isolated app for each test group ──────────────────────────
// We import the real app for integration-level checks and build minimal
// fixture apps for edge-case scenarios that are hard to trigger via routes.

jest.mock('../src/config/stellar', () => ({
  getStellarService: () => ({
    getContractEvents: async () => [],
  }),
  useMockStellar: true,
  network: 'testnet',
  port: undefined,
}));

const app = require('../../src/routes/app');

// ─── Helper: build a minimal Express app with the same error handler logic ───
function buildFixtureApp(routeSetup) {
  const a = express();
  a.use(express.json());
  routeSetup(a);

  // Mirror the hardened error handler from src/routes/app.js
  // eslint-disable-next-line no-unused-vars
  a.use((err, req, res, _next) => {
    const status =
      typeof err.status === 'number' && err.status >= 100 && err.status < 600
        ? err.status
        : typeof err.statusCode === 'number' && err.statusCode >= 100 && err.statusCode < 600
          ? err.statusCode
          : 500;

    const body = { success: false, error: err.message || 'Internal server error', status };
    res.setHeader('Content-Type', 'application/json');
    try {
      res.status(status).json(body);
    } catch (_e) {
      if (!res.headersSent) res.status(status).end(JSON.stringify(body));
    }
  });
  return a;
}

// =============================================================================
// 404 — unknown routes
// =============================================================================
describe('404 handler', () => {
  test('returns JSON for unknown route', async () => {
    const res = await request(app).get('/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeDefined();
  });

  test('includes path and method in 404 body', async () => {
    const res = await request(app).delete('/no-such-endpoint');
    expect(res.status).toBe(404);
    expect(res.body.path).toBe('/no-such-endpoint');
    expect(res.body.method).toBe('DELETE');
  });

  test('never returns HTML for 404', async () => {
    const res = await request(app).get('/totally-unknown');
    expect(res.text).not.toMatch(/<html/i);
  });
});

// =============================================================================
// 500 — error thrown inside a route
// =============================================================================
describe('500 error handler', () => {
  test('returns JSON when a route throws synchronously', async () => {
    const a = buildFixtureApp((app) => {
      app.get('/boom', (_req, _res, next) => {
        next(new Error('sync explosion'));
      });
    });
    const res = await request(a).get('/boom');
    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('sync explosion');
  });

  test('returns JSON when a route throws asynchronously', async () => {
    const a = buildFixtureApp((app) => {
      app.get('/async-boom', async (_req, _res, next) => {
        try { throw new Error('async explosion'); } catch (e) { next(e); }
      });
    });
    const res = await request(a).get('/async-boom');
    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.error).toBe('async explosion');
  });

  test('never returns HTML for 500', async () => {
    const a = buildFixtureApp((app) => {
      app.get('/html-check', (_req, _res, next) => next(new Error('no html please')));
    });
    const res = await request(a).get('/html-check');
    expect(res.text).not.toMatch(/<html/i);
  });
});

// =============================================================================
// Custom status codes via err.status / err.statusCode
// =============================================================================
describe('Custom HTTP status codes on errors', () => {
  const cases = [
    { status: 400, label: 'Bad Request' },
    { status: 401, label: 'Unauthorized' },
    { status: 403, label: 'Forbidden' },
    { status: 422, label: 'Unprocessable Entity' },
    { status: 429, label: 'Too Many Requests' },
  ];

  cases.forEach(({ status, label }) => {
    test(`returns ${status} JSON for err.status = ${status} (${label})`, async () => {
      const a = buildFixtureApp((app) => {
        app.get('/err', (_req, _res, next) => {
          const e = new Error(label);
          e.status = status;
          next(e);
        });
      });
      const res = await request(a).get('/err');
      expect(res.status).toBe(status);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe(label);
    });

    test(`returns ${status} JSON for err.statusCode = ${status}`, async () => {
      const a = buildFixtureApp((app) => {
        app.get('/err2', (_req, _res, next) => {
          const e = new Error(label);
          e.statusCode = status;
          next(e);
        });
      });
      const res = await request(a).get('/err2');
      expect(res.status).toBe(status);
      expect(res.headers['content-type']).toMatch(/application\/json/);
    });
  });
});

// =============================================================================
// Content-Type header is always set
// =============================================================================
describe('Content-Type: application/json is always set', () => {
  test('error response has correct Content-Type', async () => {
    const a = buildFixtureApp((app) => {
      app.get('/ct', (_req, _res, next) => next(new Error('ct test')));
    });
    const res = await request(a).get('/ct');
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  test('404 response has correct Content-Type', async () => {
    const res = await request(app).get('/missing-route-ct-check');
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});

// =============================================================================
// Error with no message
// =============================================================================
describe('Edge cases', () => {
  test('handles error with no message gracefully', async () => {
    const a = buildFixtureApp((app) => {
      app.get('/no-msg', (_req, _res, next) => next(new Error()));
    });
    const res = await request(a).get('/no-msg');
    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toHaveProperty('success', false);
  });

  test('handles non-Error objects passed to next()', async () => {
    const a = buildFixtureApp((app) => {
      app.get('/string-err', (_req, _res, next) => next({ message: 'object error', status: 400 }));
    });
    const res = await request(a).get('/string-err');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  test('falls back to 500 for out-of-range status codes', async () => {
    const a = buildFixtureApp((app) => {
      app.get('/bad-status', (_req, _res, next) => {
        const e = new Error('bad status');
        e.status = 9999;
        next(e);
      });
    });
    const res = await request(a).get('/bad-status');
    expect(res.status).toBe(500);
  });

  test('response body is valid JSON (parseable)', async () => {
    const a = buildFixtureApp((app) => {
      app.get('/json-check', (_req, _res, next) => next(new Error('json check')));
    });
    const res = await request(a).get('/json-check');
    expect(() => JSON.parse(res.text)).not.toThrow();
  });

  test('error handler is the last middleware — routes added before it still work', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});
