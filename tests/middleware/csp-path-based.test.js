'use strict';

const request = require('supertest');
const express = require('express');
const {
  createPathBasedCspMiddleware,
  createSwaggerCspMiddleware,
  buildSwaggerCspValue,
  cspReportRouter,
} = require('../../src/middleware/csp');

function buildApp() {
  const app = express();
  app.use(createPathBasedCspMiddleware());
  app.use(cspReportRouter);
  app.get('*', (req, res) => res.json({ ok: true }));
  return app;
}

// ─── buildSwaggerCspValue ─────────────────────────────────────────────────────

describe('buildSwaggerCspValue', () => {
  const val = buildSwaggerCspValue('/csp-report');

  it("includes default-src 'self'", () => {
    expect(val).toContain("default-src 'self'");
  });

  it("includes script-src with 'unsafe-inline'", () => {
    expect(val).toContain("'unsafe-inline'");
  });

  it("includes img-src with data:", () => {
    expect(val).toContain('data:');
  });

  it('includes report-uri', () => {
    expect(val).toContain('report-uri /csp-report');
  });

  it("does NOT contain default-src 'none'", () => {
    expect(val).not.toContain("default-src 'none'");
  });
});

// ─── createSwaggerCspMiddleware ───────────────────────────────────────────────

describe('createSwaggerCspMiddleware', () => {
  it("sets relaxed CSP with 'self' and 'unsafe-inline'", async () => {
    const app = express();
    app.use(createSwaggerCspMiddleware());
    app.get('/docs', (req, res) => res.json({}));

    const res = await request(app).get('/docs');
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("'unsafe-inline'");
    expect(csp).toContain('data:');
  });
});

// ─── Path-based: /docs gets relaxed CSP ──────────────────────────────────────

describe('createPathBasedCspMiddleware — /docs paths', () => {
  const app = buildApp();

  it('/docs gets relaxed CSP (default-src self)', async () => {
    const res = await request(app).get('/docs');
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("default-src 'self'");
  });

  it('/docs/anything gets relaxed CSP', async () => {
    const res = await request(app).get('/docs/some-page');
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("default-src 'self'");
  });

  it('/api/docs gets relaxed CSP', async () => {
    const res = await request(app).get('/api/docs');
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("default-src 'self'");
  });

  it('/docs CSP includes unsafe-inline for Swagger scripts/styles', async () => {
    const res = await request(app).get('/docs');
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("'unsafe-inline'");
  });

  it('/docs CSP includes data: for Swagger icons', async () => {
    const res = await request(app).get('/docs');
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain('data:');
  });

  it('/docs CSP does NOT contain nonce (not needed for Swagger)', async () => {
    const res = await request(app).get('/docs');
    const csp = res.headers['content-security-policy'];
    expect(csp).not.toMatch(/nonce-/);
  });
});

// ─── Path-based: API routes get strict CSP ───────────────────────────────────

describe('createPathBasedCspMiddleware — API routes', () => {
  const app = buildApp();

  it('/donations gets strict CSP (default-src none)', async () => {
    const res = await request(app).get('/donations');
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("default-src 'none'");
  });

  it('/wallets gets strict CSP', async () => {
    const res = await request(app).get('/wallets');
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("default-src 'none'");
  });

  it('/health gets strict CSP', async () => {
    const res = await request(app).get('/health');
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("default-src 'none'");
  });

  it('strict CSP includes a per-request nonce', async () => {
    const res = await request(app).get('/donations');
    const csp = res.headers['content-security-policy'];
    expect(csp).toMatch(/nonce-[A-Za-z0-9_-]+/);
  });

  it('strict CSP includes frame-ancestors none', async () => {
    const res = await request(app).get('/donations');
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('strict CSP does NOT contain unsafe-inline', async () => {
    const res = await request(app).get('/donations');
    const csp = res.headers['content-security-policy'];
    expect(csp).not.toContain("'unsafe-inline'");
  });

  it('nonces differ between requests', async () => {
    const [r1, r2] = await Promise.all([
      request(app).get('/donations'),
      request(app).get('/donations'),
    ]);
    const n1 = r1.headers['content-security-policy'].match(/nonce-([A-Za-z0-9_-]+)/)[1];
    const n2 = r2.headers['content-security-policy'].match(/nonce-([A-Za-z0-9_-]+)/)[1];
    expect(n1).not.toBe(n2);
  });
});

// ─── POST /csp-report ─────────────────────────────────────────────────────────

describe('POST /csp-report (path-based app)', () => {
  const app = buildApp();

  it('returns 204 and logs the violation', async () => {
    const log = require('../../src/utils/log');
    const spy = jest.spyOn(log, 'warn').mockImplementation(() => {});

    const res = await request(app)
      .post('/csp-report')
      .set('Content-Type', 'application/json')
      .send({ 'csp-report': { 'blocked-uri': 'https://evil.com', 'violated-directive': 'script-src' } });

    expect(res.status).toBe(204);
    expect(spy).toHaveBeenCalledWith('CSP', 'Violation report received', expect.any(Object));
    spy.mockRestore();
  });
});
