/**
 * Tests for Content Security Policy and security headers via helmet.
 *
 * Covers:
 * - Content-Security-Policy (default-src 'none', frame-ancestors 'none')
 * - X-Frame-Options: DENY
 * - X-Content-Type-Options: nosniff
 * - Referrer-Policy: no-referrer
 * - Strict-Transport-Security (max-age, includeSubDomains, preload)
 * - X-Powered-By removed
 * - Headers present on every response (200, 404, 503)
 */

'use strict';

const request = require('supertest');
const express = require('express');
const helmet = require('helmet');

/**
 * Build a minimal Express app with the same helmet config used in app.js.
 * Avoids loading the full app (and its DB/service dependencies) in unit tests.
 *
 * @returns {import('express').Application}
 */
function buildApp() {
  const app = express();

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    frameguard: { action: 'deny' },
    noSniff: true,
    referrerPolicy: { policy: 'no-referrer' },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    xssFilter: false,
    hidePoweredBy: true,
  }));

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/donations', (_req, res) => res.json({ data: [] }));
  app.get('/wallets', (_req, res) => res.json({ data: [] }));
  app.use((_req, res) => res.status(404).json({ error: 'not found' }));

  return app;
}

const app = buildApp();

// ─── Content-Security-Policy ─────────────────────────────────────────────────

describe('Content-Security-Policy', () => {
  it('is present on every response', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['content-security-policy']).toBeDefined();
  });

  it("contains default-src 'none'", async () => {
    const res = await request(app).get('/health');
    expect(res.headers['content-security-policy']).toMatch(/default-src\s+'none'/);
  });

  it("contains frame-ancestors 'none'", async () => {
    const res = await request(app).get('/health');
    expect(res.headers['content-security-policy']).toMatch(/frame-ancestors\s+'none'/);
  });
});

// ─── X-Frame-Options ─────────────────────────────────────────────────────────

describe('X-Frame-Options', () => {
  it('is set to DENY', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('is present on 404 responses', async () => {
    const res = await request(app).get('/nonexistent');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });
});

// ─── X-Content-Type-Options ──────────────────────────────────────────────────

describe('X-Content-Type-Options', () => {
  it('is set to nosniff', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

// ─── Referrer-Policy ─────────────────────────────────────────────────────────

describe('Referrer-Policy', () => {
  it('is set to no-referrer', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });
});

// ─── Strict-Transport-Security ───────────────────────────────────────────────

describe('Strict-Transport-Security', () => {
  it('is present', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['strict-transport-security']).toBeDefined();
  });

  it('has max-age of at least one year (31536000)', async () => {
    const res = await request(app).get('/health');
    const match = res.headers['strict-transport-security'].match(/max-age=(\d+)/);
    expect(match).not.toBeNull();
    expect(Number(match[1])).toBeGreaterThanOrEqual(31536000);
  });

  it('includes includeSubDomains', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['strict-transport-security']).toMatch(/includeSubDomains/i);
  });

  it('includes preload', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['strict-transport-security']).toMatch(/preload/i);
  });
});

// ─── X-Powered-By removed ────────────────────────────────────────────────────

describe('X-Powered-By', () => {
  it('is not present', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

// ─── Headers on multiple endpoints ───────────────────────────────────────────

describe('security headers on multiple endpoints', () => {
  const endpoints = ['/health', '/donations', '/wallets', '/nonexistent'];

  it.each(endpoints)('CSP present on %s', async (path) => {
    const res = await request(app).get(path);
    expect(res.headers['content-security-policy']).toBeDefined();
  });

  it.each(endpoints)('X-Frame-Options DENY on %s', async (path) => {
    const res = await request(app).get(path);
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it.each(endpoints)('X-Content-Type-Options nosniff on %s', async (path) => {
    const res = await request(app).get(path);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it.each(endpoints)('Referrer-Policy no-referrer on %s', async (path) => {
    const res = await request(app).get(path);
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it.each(endpoints)('HSTS present on %s', async (path) => {
    const res = await request(app).get(path);
    expect(res.headers['strict-transport-security']).toBeDefined();
  });
});

// === Regression: real csp.js middleware

const {
  createCspMiddleware,
  createPathBasedCspMiddleware,
} = require('../../src/middleware/csp');

/**
 * Build a minimal Express app using the real CSP middleware factory.
 * Mirrors the stack in src/bootstrap/middleware.js.
 */
function buildRealCspApp(cspOptions = {}) {
  const helmetApp = express();
  helmetApp.use(helmet({
    contentSecurityPolicy: false,
    frameguard: { action: 'deny' },
    noSniff: true,
    referrerPolicy: { policy: 'no-referrer' },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    xssFilter: false,
    hidePoweredBy: true,
  }));
  helmetApp.use(createPathBasedCspMiddleware(cspOptions));
  helmetApp.get('/api/v1/health', (_req, res) => res.json({ status: 'ok' }));
  helmetApp.get('/docs', (_req, res) => res.json({ docs: true }));
  return helmetApp;
}

describe('CSP middleware — enforcement mode', () => {
  const origEnv = process.env.NODE_ENV;
  const origFlag = process.env.CSP_REPORT_ONLY;

  afterEach(() => {
    process.env.NODE_ENV = origEnv;
    if (origFlag === undefined) delete process.env.CSP_REPORT_ONLY;
    else process.env.CSP_REPORT_ONLY = origFlag;
  });

  it('enforces CSP by default (header name is Content-Security-Policy)', async () => {
    delete process.env.CSP_REPORT_ONLY;
    const cspApp = buildRealCspApp();
    const res = await request(cspApp).get('/api/v1/health');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['content-security-policy-report-only']).toBeUndefined();
  });

  it('switches to report-only when CSP_REPORT_ONLY=true in non-production', async () => {
    process.env.NODE_ENV = 'development';
    process.env.CSP_REPORT_ONLY = 'true';
    const cspApp = buildRealCspApp();
    const res = await request(cspApp).get('/api/v1/health');
    expect(res.headers['content-security-policy-report-only']).toBeDefined();
    expect(res.headers['content-security-policy']).toBeUndefined();
  });

  it('always enforces CSP in production even when CSP_REPORT_ONLY=true', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CSP_REPORT_ONLY = 'true';
    const cspApp = buildRealCspApp();
    const res = await request(cspApp).get('/api/v1/health');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['content-security-policy-report-only']).toBeUndefined();
  });

  it("API routes include default-src 'none'", async () => {
    delete process.env.CSP_REPORT_ONLY;
    const cspApp = buildRealCspApp();
    const res = await request(cspApp).get('/api/v1/health');
    expect(res.headers['content-security-policy']).toMatch(/default-src\s+'none'/);
  });

  it("API routes include frame-ancestors 'none'", async () => {
    delete process.env.CSP_REPORT_ONLY;
    const cspApp = buildRealCspApp();
    const res = await request(cspApp).get('/api/v1/health');
    expect(res.headers['content-security-policy']).toMatch(/frame-ancestors\s+'none'/);
  });

  it('/docs uses relaxed CSP (default-src self) not strict none', async () => {
    delete process.env.CSP_REPORT_ONLY;
    const cspApp = buildRealCspApp();
    const res = await request(cspApp).get('/docs');
    expect(res.headers['content-security-policy']).toMatch(/default-src\s+'self'/);
  });
});

describe('Full security header regression', () => {
  let headerApp;

  beforeAll(() => {
    delete process.env.CSP_REPORT_ONLY;
    headerApp = buildRealCspApp();
  });

  const endpoints = ['/api/v1/health', '/docs'];

  it.each(endpoints)('Content-Security-Policy present on %s', async (path) => {
    const res = await request(headerApp).get(path);
    expect(res.headers['content-security-policy']).toBeDefined();
  });

  it.each(endpoints)('X-Frame-Options DENY on %s', async (path) => {
    const res = await request(headerApp).get(path);
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it.each(endpoints)('X-Content-Type-Options nosniff on %s', async (path) => {
    const res = await request(headerApp).get(path);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it.each(endpoints)('Referrer-Policy no-referrer on %s', async (path) => {
    const res = await request(headerApp).get(path);
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it.each(endpoints)('HSTS present on %s', async (path) => {
    const res = await request(headerApp).get(path);
    expect(res.headers['strict-transport-security']).toBeDefined();
  });

  it.each(endpoints)('X-Powered-By absent on %s', async (path) => {
    const res = await request(headerApp).get(path);
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

// ─── helmet config matches app.js ────────────────────────────────────────────

describe('helmet config in app.js', () => {
  it('app.js requires helmet', () => {
    const fs = require('fs');
    const src = fs.readFileSync('src/app.js', 'utf8');
    expect(src).toMatch(/require\(['"]helmet['"]\)/);
  });

  it('app.js calls app.use(helmet(', () => {
    const fs = require('fs');
    const src = fs.readFileSync('src/app.js', 'utf8');
    expect(src).toMatch(/app\.use\(helmet\(/);
  });

  it('app.js sets frameguard DENY', () => {
    const fs = require('fs');
    const src = fs.readFileSync('src/app.js', 'utf8');
    expect(src).toMatch(/frameguard.*deny/i);
  });

  it('app.js sets referrerPolicy no-referrer', () => {
    const fs = require('fs');
    const src = fs.readFileSync('src/app.js', 'utf8');
    expect(src).toMatch(/no-referrer/);
  });

  it('app.js sets hsts with maxAge', () => {
    const fs = require('fs');
    const src = fs.readFileSync('src/app.js', 'utf8');
    expect(src).toMatch(/maxAge/);
  });
});
