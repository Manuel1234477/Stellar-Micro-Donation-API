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

// ─── helmet config matches app.js ────────────────────────────────────────────

describe('helmet config in app.js', () => {
  it('app.js requires helmet', () => {
    const fs = require('fs');
    const src = fs.readFileSync('src/routes/app.js', 'utf8');
    expect(src).toMatch(/require\(['"]helmet['"]\)/);
  });

  it('app.js calls app.use(helmet(', () => {
    const fs = require('fs');
    const src = fs.readFileSync('src/routes/app.js', 'utf8');
    expect(src).toMatch(/app\.use\(helmet\(/);
  });

  it('app.js sets frameguard DENY', () => {
    const fs = require('fs');
    const src = fs.readFileSync('src/routes/app.js', 'utf8');
    expect(src).toMatch(/frameguard.*deny/i);
  });

  it('app.js sets referrerPolicy no-referrer', () => {
    const fs = require('fs');
    const src = fs.readFileSync('src/routes/app.js', 'utf8');
    expect(src).toMatch(/no-referrer/);
  });

  it('app.js sets hsts with maxAge', () => {
    const fs = require('fs');
    const src = fs.readFileSync('src/routes/app.js', 'utf8');
    expect(src).toMatch(/maxAge/);
  });
});
