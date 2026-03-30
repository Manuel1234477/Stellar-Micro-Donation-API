'use strict';

const request = require('supertest');
const express = require('express');
const { createCspMiddleware, cspReportRouter, generateNonce, buildCspValue } = require('../src/middleware/csp');

/**
 * Build a minimal Express app with the CSP middleware under test.
 *
 * @param {Object} [options] - Passed to createCspMiddleware
 * @returns {import('express').Application}
 */
function buildApp(options = {}) {
  const app = express();
  app.use(createCspMiddleware(options));
  app.use(cspReportRouter);
  app.get('/test', (req, res) => res.json({ nonce: res.locals.cspNonce }));
  return app;
}

// ─── generateNonce ────────────────────────────────────────────────────────────

describe('generateNonce', () => {
  it('returns a non-empty string', () => {
    expect(typeof generateNonce()).toBe('string');
    expect(generateNonce().length).toBeGreaterThan(0);
  });

  it('returns unique values on each call', () => {
    const nonces = new Set(Array.from({ length: 50 }, generateNonce));
    expect(nonces.size).toBe(50);
  });

  it('is base64url encoded (no +, /, = characters)', () => {
    for (let i = 0; i < 20; i++) {
      expect(generateNonce()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});

// ─── buildCspValue ────────────────────────────────────────────────────────────

describe('buildCspValue', () => {
  it("includes default-src 'none'", () => {
    expect(buildCspValue('abc', '/csp-report')).toContain("default-src 'none'");
  });

  it('includes script-src with the nonce', () => {
    expect(buildCspValue('mynonce', '/csp-report')).toContain("script-src 'nonce-mynonce'");
  });

  it('includes report-uri', () => {
    expect(buildCspValue('n', '/my-report')).toContain('report-uri /my-report');
  });
});

// ─── CSP header presence ──────────────────────────────────────────────────────

describe('CSP header — enforce mode (default)', () => {
  const app = buildApp();

  it('sets Content-Security-Policy header', async () => {
    const res = await request(app).get('/test');
    expect(res.headers['content-security-policy']).toBeDefined();
  });

  it('does NOT set Content-Security-Policy-Report-Only in enforce mode', async () => {
    const res = await request(app).get('/test');
    expect(res.headers['content-security-policy-report-only']).toBeUndefined();
  });

  it("header contains default-src 'none'", async () => {
    const res = await request(app).get('/test');
    expect(res.headers['content-security-policy']).toMatch(/default-src\s+'none'/);
  });

  it('header contains script-src with a nonce', async () => {
    const res = await request(app).get('/test');
    expect(res.headers['content-security-policy']).toMatch(/script-src\s+'nonce-[A-Za-z0-9_-]+'/);
  });

  it('header contains report-uri', async () => {
    const res = await request(app).get('/test');
    expect(res.headers['content-security-policy']).toMatch(/report-uri/);
  });
});

// ─── Report-only mode ─────────────────────────────────────────────────────────

describe('CSP header — report-only mode', () => {
  const app = buildApp({ reportOnly: true });

  it('sets Content-Security-Policy-Report-Only header', async () => {
    const res = await request(app).get('/test');
    expect(res.headers['content-security-policy-report-only']).toBeDefined();
  });

  it('does NOT set Content-Security-Policy in report-only mode', async () => {
    const res = await request(app).get('/test');
    expect(res.headers['content-security-policy']).toBeUndefined();
  });

  it('report-only header contains nonce', async () => {
    const res = await request(app).get('/test');
    expect(res.headers['content-security-policy-report-only']).toMatch(/nonce-[A-Za-z0-9_-]+/);
  });
});

// ─── Report-only via env var ──────────────────────────────────────────────────

describe('CSP_REPORT_ONLY env var', () => {
  it('enables report-only mode when CSP_REPORT_ONLY=true', async () => {
    const saved = process.env.CSP_REPORT_ONLY;
    process.env.CSP_REPORT_ONLY = 'true';
    // Re-require to pick up env at factory call time
    const { createCspMiddleware: create } = require('../src/middleware/csp');
    const app = express();
    app.use(create());
    app.get('/x', (_req, res) => res.json({}));
    const res = await request(app).get('/x');
    expect(res.headers['content-security-policy-report-only']).toBeDefined();
    expect(res.headers['content-security-policy']).toBeUndefined();
    process.env.CSP_REPORT_ONLY = saved;
  });
});

// ─── Nonce uniqueness per request ─────────────────────────────────────────────

describe('nonce uniqueness per request', () => {
  const app = buildApp();

  it('generates a different nonce for each request', async () => {
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => request(app).get('/test'))
    );
    const nonces = responses.map(r => r.body.nonce);
    const unique = new Set(nonces);
    expect(unique.size).toBe(10);
  });

  it('nonce in header matches res.locals.cspNonce', async () => {
    const res = await request(app).get('/test');
    const nonce = res.body.nonce;
    expect(res.headers['content-security-policy']).toContain(`'nonce-${nonce}'`);
  });
});

// ─── res.locals.cspNonce ──────────────────────────────────────────────────────

describe('res.locals.cspNonce', () => {
  it('is accessible in route handlers', async () => {
    const app = buildApp();
    const res = await request(app).get('/test');
    expect(typeof res.body.nonce).toBe('string');
    expect(res.body.nonce.length).toBeGreaterThan(0);
  });
});

// ─── POST /csp-report ─────────────────────────────────────────────────────────

describe('POST /csp-report', () => {
  const app = buildApp();

  it('returns 204 for a valid violation report', async () => {
    const res = await request(app)
      .post('/csp-report')
      .set('Content-Type', 'application/json')
      .send({ 'csp-report': { 'blocked-uri': 'https://evil.com', 'violated-directive': 'script-src' } });
    expect(res.status).toBe(204);
  });

  it('returns 204 for application/csp-report content type', async () => {
    const res = await request(app)
      .post('/csp-report')
      .set('Content-Type', 'application/csp-report')
      .send(JSON.stringify({ 'csp-report': { 'blocked-uri': 'inline' } }));
    expect(res.status).toBe(204);
  });

  it('returns 204 for an empty body', async () => {
    const res = await request(app)
      .post('/csp-report')
      .set('Content-Type', 'application/json')
      .send({});
    expect(res.status).toBe(204);
  });

  it('logs the violation report', async () => {
    const log = require('../src/utils/log');
    const warnSpy = jest.spyOn(log, 'warn').mockImplementation(() => {});
    await request(app)
      .post('/csp-report')
      .set('Content-Type', 'application/json')
      .send({ 'csp-report': { 'blocked-uri': 'https://evil.com' } });
    expect(warnSpy).toHaveBeenCalledWith('CSP', 'Violation report received', expect.any(Object));
    warnSpy.mockRestore();
  });
});

// ─── Custom reportUri option ──────────────────────────────────────────────────

describe('custom reportUri option', () => {
  it('uses the provided reportUri in the CSP header', async () => {
    const app = buildApp({ reportUri: '/custom-csp-endpoint' });
    const res = await request(app).get('/test');
    expect(res.headers['content-security-policy']).toContain('report-uri /custom-csp-endpoint');
  });
});
