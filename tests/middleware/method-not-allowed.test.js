/**
 * 405 Method Not Allowed — Test Suite
 * Feature: return-405-for-unsupported-methods
 *
 * Covers:
 *  - Unit tests for methodRegistry (normalizePath, registerMethod, findMatchingRoute)
 *  - Unit tests for methodNotAllowedHandler and optionsHandler middleware
 *  - Integration tests via a real Express app
 */
'use strict';

const express = require('express');
const request = require('supertest');

const {
  methodRegistry,
  registerMethod,
  getSupportedMethods,
  findMatchingRoute,
  normalizePath,
  patternToRegex,
  clearRegistry,
} = require('../../src/middleware/methodRegistry');

const {
  optionsHandler,
  methodNotAllowedHandler,
} = require('../../src/middleware/methodNotAllowedHandler');

const { notFoundHandler, errorHandler } = require('../../src/middleware/errorHandler');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildApp(routes = []) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.id = 'test-id'; next(); }); // stub requestId

  for (const { method, path: p, handler } of routes) {
    app[method.toLowerCase()](p, handler || ((_q, res) => res.json({ ok: true })));
    registerMethod(method.toUpperCase(), p);
  }

  app.use(optionsHandler);
  app.use(methodNotAllowedHandler);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

beforeEach(() => clearRegistry());
afterEach(() => clearRegistry());

// ─── methodRegistry unit tests ────────────────────────────────────────────────

describe('methodRegistry — normalizePath', () => {
  it('adds leading slash if missing', () => expect(normalizePath('wallets')).toBe('/wallets'));
  it('removes trailing slash', () => expect(normalizePath('/wallets/')).toBe('/wallets'));
  it('preserves root /', () => expect(normalizePath('/')).toBe('/'));
  it('lowercases path', () => expect(normalizePath('/WALLETS')).toBe('/wallets'));
  it('handles empty string', () => expect(normalizePath('')).toBe('/'));
  it('removes double trailing slash', () => expect(normalizePath('/wallets//')).toBe('/wallets/'));
});

describe('methodRegistry — registerMethod', () => {
  it('registers a method for a path', () => {
    registerMethod('GET', '/wallets');
    expect(getSupportedMethods('/wallets')).toContain('GET');
  });

  it('auto-adds OPTIONS to every registered path', () => {
    registerMethod('POST', '/donations');
    expect(getSupportedMethods('/donations')).toContain('OPTIONS');
  });

  it('auto-adds HEAD when GET is registered', () => {
    registerMethod('GET', '/wallets');
    expect(getSupportedMethods('/wallets')).toContain('HEAD');
  });

  it('does NOT add HEAD for non-GET methods', () => {
    registerMethod('POST', '/wallets');
    expect(getSupportedMethods('/wallets')).not.toContain('HEAD');
  });

  it('accumulates multiple methods for same path', () => {
    registerMethod('GET', '/wallets');
    registerMethod('POST', '/wallets');
    const methods = getSupportedMethods('/wallets');
    expect(methods).toContain('GET');
    expect(methods).toContain('POST');
  });

  it('returns null for unregistered path', () => {
    expect(getSupportedMethods('/unknown')).toBeNull();
  });
});

describe('methodRegistry — findMatchingRoute', () => {
  it('matches exact path', () => {
    registerMethod('GET', '/wallets');
    expect(findMatchingRoute('/wallets')).toContain('GET');
  });

  it('matches parameterised path', () => {
    registerMethod('GET', '/wallets/:id');
    registerMethod('PATCH', '/wallets/:id');
    const methods = findMatchingRoute('/wallets/GABC123XYZ');
    expect(methods).toContain('GET');
    expect(methods).toContain('PATCH');
  });

  it('returns null for unknown path', () => {
    expect(findMatchingRoute('/nonexistent')).toBeNull();
  });

  it('matching is case-insensitive for path', () => {
    registerMethod('GET', '/wallets');
    expect(findMatchingRoute('/WALLETS')).toContain('GET');
  });

  it('returns sorted methods array', () => {
    registerMethod('POST', '/test');
    registerMethod('GET', '/test');
    registerMethod('DELETE', '/test');
    const methods = findMatchingRoute('/test');
    const sorted = [...methods].sort();
    expect(methods).toEqual(sorted);
  });
});

describe('methodRegistry — patternToRegex', () => {
  it('matches simple parameterised path', () => {
    const re = patternToRegex('/wallets/:id');
    expect(re.test('/wallets/abc123')).toBe(true);
    expect(re.test('/wallets/')).toBe(false);
  });

  it('matches multi-param path', () => {
    const re = patternToRegex('/wallets/:id/history/:cursor');
    expect(re.test('/wallets/abc/history/xyz')).toBe(true);
    expect(re.test('/wallets/abc/history')).toBe(false);
  });
});

// ─── middleware unit tests ─────────────────────────────────────────────────────

describe('methodNotAllowedHandler — unit', () => {
  it('calls next() for unknown paths', () => {
    const req = { method: 'DELETE', path: '/unknown', id: 'x' };
    const res = {};
    const next = jest.fn();
    methodNotAllowedHandler(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('calls next() when method is supported', () => {
    registerMethod('GET', '/wallets');
    const req = { method: 'GET', path: '/wallets', id: 'x' };
    const res = {};
    const next = jest.fn();
    methodNotAllowedHandler(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('returns 405 with Allow header for unsupported method on known path', () => {
    registerMethod('GET', '/wallets');
    const headers = {};
    const req = { method: 'DELETE', path: '/wallets', id: 'req-1' };
    const res = {
      set: jest.fn((k, v) => { headers[k] = v; }),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    methodNotAllowedHandler(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(405);
    expect(headers['Allow']).toBeDefined();
    expect(headers['Allow']).toContain('GET');
    expect(headers['Allow']).toContain('OPTIONS');
  });
});

describe('optionsHandler — unit', () => {
  it('calls next() for non-OPTIONS requests', () => {
    const req = { method: 'GET', path: '/wallets' };
    const next = jest.fn();
    optionsHandler(req, {}, next);
    expect(next).toHaveBeenCalled();
  });

  it('calls next() for OPTIONS on unknown path', () => {
    const req = { method: 'OPTIONS', path: '/unknown' };
    const next = jest.fn();
    optionsHandler(req, {}, next);
    expect(next).toHaveBeenCalled();
  });

  it('returns 200 with Allow header for OPTIONS on known path', () => {
    registerMethod('GET', '/wallets');
    registerMethod('POST', '/wallets');
    const headers = {};
    const req = { method: 'OPTIONS', path: '/wallets' };
    const res = {
      set: jest.fn((k, v) => { headers[k] = v; }),
      status: jest.fn().mockReturnThis(),
      end: jest.fn(),
    };
    optionsHandler(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(200);
    expect(headers['Allow']).toContain('GET');
    expect(headers['Allow']).toContain('POST');
    expect(headers['Allow']).toContain('OPTIONS');
  });
});

// ─── Integration tests ─────────────────────────────────────────────────────────

describe('405 Middleware — Integration', () => {
  describe('read-only route (GET only)', () => {
    let app;
    beforeEach(() => {
      app = buildApp([{ method: 'GET', path: '/api/v1/health' }]);
    });

    it('GET /api/v1/health → 200', async () => {
      const res = await request(app).get('/api/v1/health');
      expect(res.status).toBe(200);
    });

    it('DELETE /api/v1/health → 405 with Allow header', async () => {
      const res = await request(app).delete('/api/v1/health');
      expect(res.status).toBe(405);
      expect(res.headers['allow']).toBeDefined();
      expect(res.headers['allow']).toContain('GET');
    });

    it('POST /api/v1/health → 405', async () => {
      const res = await request(app).post('/api/v1/health');
      expect(res.status).toBe(405);
    });

    it('405 response body has correct structure', async () => {
      const res = await request(app).delete('/api/v1/health');
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('METHOD_NOT_ALLOWED');
      expect(res.body.error.numericCode).toBe(3006);
      expect(Array.isArray(res.body.error.allowedMethods)).toBe(true);
      expect(res.body.error.requestId).toBeDefined();
      expect(res.body.error.timestamp).toBeDefined();
    });

    it('Allow header does not appear on 200 response', async () => {
      const res = await request(app).get('/api/v1/health');
      expect(res.headers['allow']).toBeUndefined();
    });
  });

  describe('write route (POST only)', () => {
    let app;
    beforeEach(() => {
      app = buildApp([{ method: 'POST', path: '/api/v1/wallets' }]);
    });

    it('POST /api/v1/wallets → 200', async () => {
      const res = await request(app).post('/api/v1/wallets');
      expect(res.status).toBe(200);
    });

    it('GET /api/v1/wallets → 405 with Allow including POST', async () => {
      const res = await request(app).get('/api/v1/wallets');
      expect(res.status).toBe(405);
      expect(res.headers['allow']).toContain('POST');
    });

    it('DELETE /api/v1/wallets → 405', async () => {
      const res = await request(app).delete('/api/v1/wallets');
      expect(res.status).toBe(405);
    });
  });

  describe('mixed route (GET + PATCH)', () => {
    let app;
    beforeEach(() => {
      app = buildApp([
        { method: 'GET', path: '/api/v1/wallets/:id' },
        { method: 'PATCH', path: '/api/v1/wallets/:id' },
      ]);
    });

    it('GET /api/v1/wallets/abc → 200', async () => {
      const res = await request(app).get('/api/v1/wallets/abc');
      expect(res.status).toBe(200);
    });

    it('PATCH /api/v1/wallets/abc → 200', async () => {
      const res = await request(app).patch('/api/v1/wallets/abc');
      expect(res.status).toBe(200);
    });

    it('DELETE /api/v1/wallets/abc → 405', async () => {
      const res = await request(app).delete('/api/v1/wallets/abc');
      expect(res.status).toBe(405);
    });

    it('Allow header on 405 includes GET, PATCH, OPTIONS', async () => {
      const res = await request(app).delete('/api/v1/wallets/abc');
      const allow = res.headers['allow'];
      expect(allow).toContain('GET');
      expect(allow).toContain('PATCH');
      expect(allow).toContain('OPTIONS');
    });

    it('POST /api/v1/wallets/abc → 405 (not 404)', async () => {
      const res = await request(app).post('/api/v1/wallets/abc');
      expect(res.status).toBe(405);
    });
  });

  describe('unknown routes → 404 (no Allow header)', () => {
    let app;
    beforeEach(() => {
      app = buildApp([{ method: 'GET', path: '/api/v1/wallets' }]);
    });

    it('truly unknown path → 404', async () => {
      const res = await request(app).get('/api/v1/nonexistent');
      expect(res.status).toBe(404);
    });

    it('404 response does NOT include Allow header', async () => {
      const res = await request(app).get('/api/v1/nonexistent');
      expect(res.headers['allow']).toBeUndefined();
    });

    it('DELETE on unknown path → 404 (not 405)', async () => {
      const res = await request(app).delete('/api/v1/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  describe('OPTIONS support', () => {
    let app;
    beforeEach(() => {
      app = buildApp([
        { method: 'GET', path: '/api/v1/donations' },
        { method: 'POST', path: '/api/v1/donations' },
      ]);
    });

    it('OPTIONS on known route → 200', async () => {
      const res = await request(app).options('/api/v1/donations');
      expect(res.status).toBe(200);
    });

    it('OPTIONS response includes Allow header with all methods', async () => {
      const res = await request(app).options('/api/v1/donations');
      const allow = res.headers['allow'];
      expect(allow).toContain('GET');
      expect(allow).toContain('POST');
      expect(allow).toContain('OPTIONS');
    });

    it('OPTIONS includes HEAD when GET is registered', async () => {
      const res = await request(app).options('/api/v1/donations');
      expect(res.headers['allow']).toContain('HEAD');
    });

    it('OPTIONS on unknown path → 404', async () => {
      const res = await request(app).options('/api/v1/unknown');
      expect(res.status).toBe(404);
    });
  });

  describe('trailing slash handling', () => {
    let app;
    beforeEach(() => {
      app = buildApp([{ method: 'GET', path: '/api/v1/wallets' }]);
    });

    it('GET /api/v1/wallets/ treated same as /api/v1/wallets', async () => {
      // Express strips trailing slashes by default, but registry normalises
      const res = await request(app).get('/api/v1/wallets/');
      // The request should not be 405 — either 200 (Express strips slash) or 404
      expect([200, 404]).toContain(res.status);
      expect(res.status).not.toBe(405);
    });
  });
});
