/**
 * Tests for CORS Configuration with Allowlist Support
 *
 * Covers:
 *  - Allowed origins receive correct CORS headers
 *  - Disallowed origins receive 403
 *  - Wildcard subdomain matching
 *  - Preflight (OPTIONS) handling and caching
 *  - Same-origin / no-Origin requests pass through
 *  - Environment variable parsing
 *  - CORS_ALLOWED_METHODS and CORS_ALLOWED_HEADERS overrides
 *  - CORS_MAX_AGE configuration
 *  - Edge cases and validation
 */

const request = require('supertest');
const express = require('express');
const {
  createCorsMiddleware,
  parseAllowedOrigins,
  isOriginAllowed,
  wildcardToRegex,
  CORS_DEFAULTS,
} = require('../../src/middleware/cors');

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a minimal Express app with the CORS middleware and a test route.
 */
function buildApp(corsOptions = {}) {
  const app = express();
  app.use(createCorsMiddleware(corsOptions));
  app.get('/test', (req, res) => res.json({ success: true }));
  app.post('/test', (req, res) => res.json({ success: true }));
  return app;
}

// ─── Unit: parseAllowedOrigins ───────────────────────────────────────────────

describe('parseAllowedOrigins', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    delete process.env.CORS_ALLOWED_ORIGINS;
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('returns empty array when env var is not set', () => {
    expect(parseAllowedOrigins()).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(parseAllowedOrigins('')).toEqual([]);
  });

  it('parses a single origin', () => {
    expect(parseAllowedOrigins('https://example.com')).toEqual(['https://example.com']);
  });

  it('parses multiple comma-separated origins', () => {
    const result = parseAllowedOrigins('https://a.com,https://b.com,https://c.com');
    expect(result).toEqual(['https://a.com', 'https://b.com', 'https://c.com']);
  });

  it('trims whitespace around origins', () => {
    const result = parseAllowedOrigins('  https://a.com , https://b.com  ');
    expect(result).toEqual(['https://a.com', 'https://b.com']);
  });

  it('filters out empty entries from trailing commas', () => {
    const result = parseAllowedOrigins('https://a.com,,https://b.com,');
    expect(result).toEqual(['https://a.com', 'https://b.com']);
  });

  it('reads from process.env.CORS_ALLOWED_ORIGINS when no arg given', () => {
    process.env.CORS_ALLOWED_ORIGINS = 'https://env.example.com';
    expect(parseAllowedOrigins()).toEqual(['https://env.example.com']);
  });

  it('supports wildcard patterns in the list', () => {
    const result = parseAllowedOrigins('*.example.com,https://other.com');
    expect(result).toEqual(['*.example.com', 'https://other.com']);
  });
});

// ─── Unit: wildcardToRegex ───────────────────────────────────────────────────

describe('wildcardToRegex', () => {
  it('returns null for non-wildcard patterns', () => {
    expect(wildcardToRegex('https://example.com')).toBeNull();
    expect(wildcardToRegex('example.com')).toBeNull();
  });

  it('returns a RegExp for *.domain patterns', () => {
    const regex = wildcardToRegex('*.example.com');
    expect(regex).toBeInstanceOf(RegExp);
  });

  it('matches valid subdomains over http', () => {
    const regex = wildcardToRegex('*.example.com');
    expect(regex.test('http://app.example.com')).toBe(true);
  });

  it('matches valid subdomains over https', () => {
    const regex = wildcardToRegex('*.example.com');
    expect(regex.test('https://app.example.com')).toBe(true);
    expect(regex.test('https://admin.example.com')).toBe(true);
  });

  it('does not match the bare domain', () => {
    const regex = wildcardToRegex('*.example.com');
    expect(regex.test('https://example.com')).toBe(false);
  });

  it('does not match a different domain', () => {
    const regex = wildcardToRegex('*.example.com');
    expect(regex.test('https://app.other.com')).toBe(false);
  });

  it('does not match nested subdomains (only one level)', () => {
    const regex = wildcardToRegex('*.example.com');
    // "deep.sub.example.com" has a dot in the subdomain part — should not match
    expect(regex.test('https://deep.sub.example.com')).toBe(false);
  });

  it('escapes special regex characters in the domain', () => {
    const regex = wildcardToRegex('*.my-app.io');
    expect(regex.test('https://tenant.my-app.io')).toBe(true);
    expect(regex.test('https://tenant.myXapp.io')).toBe(false);
  });
});

// ─── Unit: isOriginAllowed ───────────────────────────────────────────────────

describe('isOriginAllowed', () => {
  const origins = [
    'https://app.example.com',
    'https://admin.example.com',
    '*.tenant.io',
  ];

  it('returns false for empty/null origin', () => {
    expect(isOriginAllowed('', origins)).toBe(false);
    expect(isOriginAllowed(null, origins)).toBe(false);
    expect(isOriginAllowed(undefined, origins)).toBe(false);
  });

  it('returns false when allowlist is empty', () => {
    expect(isOriginAllowed('https://app.example.com', [])).toBe(false);
  });

  it('allows exact match', () => {
    expect(isOriginAllowed('https://app.example.com', origins)).toBe(true);
    expect(isOriginAllowed('https://admin.example.com', origins)).toBe(true);
  });

  it('rejects origin not in list', () => {
    expect(isOriginAllowed('https://evil.com', origins)).toBe(false);
  });

  it('allows wildcard subdomain match', () => {
    expect(isOriginAllowed('https://client1.tenant.io', origins)).toBe(true);
    expect(isOriginAllowed('https://client2.tenant.io', origins)).toBe(true);
  });

  it('rejects origin that only partially matches', () => {
    expect(isOriginAllowed('https://app.example.com.evil.com', origins)).toBe(false);
  });

  it('is case-sensitive for exact matches', () => {
    expect(isOriginAllowed('https://App.Example.Com', origins)).toBe(false);
  });
});

// ─── Integration: allowed origins ───────────────────────────────────────────

describe('CORS middleware — allowed origins', () => {
  let app;

  beforeEach(() => {
    app = buildApp({
      allowedOrigins: ['https://app.example.com', 'https://admin.example.com'],
    });
  });

  it('sets Access-Control-Allow-Origin for an allowed origin', async () => {
    const res = await request(app)
      .get('/test')
      .set('Origin', 'https://app.example.com');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://app.example.com');
  });

  it('sets Vary: Origin header', async () => {
    const res = await request(app)
      .get('/test')
      .set('Origin', 'https://app.example.com');

    expect(res.headers['vary']).toContain('Origin');
  });

  it('sets Access-Control-Allow-Credentials', async () => {
    const res = await request(app)
      .get('/test')
      .set('Origin', 'https://app.example.com');

    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('sets Access-Control-Allow-Methods', async () => {
    const res = await request(app)
      .get('/test')
      .set('Origin', 'https://app.example.com');

    expect(res.headers['access-control-allow-methods']).toBeDefined();
  });

  it('sets Access-Control-Allow-Headers', async () => {
    const res = await request(app)
      .get('/test')
      .set('Origin', 'https://app.example.com');

    expect(res.headers['access-control-allow-headers']).toBeDefined();
  });

  it('allows a second origin in the list', async () => {
    const res = await request(app)
      .get('/test')
      .set('Origin', 'https://admin.example.com');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://admin.example.com');
  });
});

// ─── Integration: disallowed origins ────────────────────────────────────────

describe('CORS middleware — disallowed origins', () => {
  let app;

  beforeEach(() => {
    app = buildApp({
      allowedOrigins: ['https://app.example.com'],
    });
  });

  it('returns 403 for a disallowed origin on GET', async () => {
    const res = await request(app)
      .get('/test')
      .set('Origin', 'https://evil.com');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CORS_ORIGIN_NOT_ALLOWED');
  });

  it('returns 403 for a disallowed origin on POST', async () => {
    const res = await request(app)
      .post('/test')
      .set('Origin', 'https://evil.com');

    expect(res.status).toBe(403);
  });

  it('does not set CORS headers for disallowed origin', async () => {
    const res = await request(app)
      .get('/test')
      .set('Origin', 'https://evil.com');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('returns 403 when allowlist is empty', async () => {
    const emptyApp = buildApp({ allowedOrigins: [] });
    const res = await request(emptyApp)
      .get('/test')
      .set('Origin', 'https://anything.com');

    expect(res.status).toBe(403);
  });
});

// ─── Integration: no Origin header ──────────────────────────────────────────

describe('CORS middleware — no Origin header', () => {
  let app;

  beforeEach(() => {
    app = buildApp({ allowedOrigins: ['https://app.example.com'] });
  });

  it('passes through requests without Origin header', async () => {
    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

// ─── Integration: preflight (OPTIONS) ───────────────────────────────────────

describe('CORS middleware — preflight requests', () => {
  let app;

  beforeEach(() => {
    app = buildApp({
      allowedOrigins: ['https://app.example.com'],
      maxAge: 3600,
    });
  });

  it('responds 204 to OPTIONS from allowed origin', async () => {
    const res = await request(app)
      .options('/test')
      .set('Origin', 'https://app.example.com')
      .set('Access-Control-Request-Method', 'POST');

    expect(res.status).toBe(204);
  });

  it('sets Access-Control-Max-Age on preflight', async () => {
    const res = await request(app)
      .options('/test')
      .set('Origin', 'https://app.example.com')
      .set('Access-Control-Request-Method', 'POST');

    expect(res.headers['access-control-max-age']).toBe('3600');
  });

  it('sets CORS headers on preflight', async () => {
    const res = await request(app)
      .options('/test')
      .set('Origin', 'https://app.example.com')
      .set('Access-Control-Request-Method', 'POST');

    expect(res.headers['access-control-allow-origin']).toBe('https://app.example.com');
    expect(res.headers['access-control-allow-methods']).toBeDefined();
    expect(res.headers['access-control-allow-headers']).toBeDefined();
  });

  it('returns 403 for OPTIONS from disallowed origin', async () => {
    const res = await request(app)
      .options('/test')
      .set('Origin', 'https://evil.com')
      .set('Access-Control-Request-Method', 'POST');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CORS_ORIGIN_NOT_ALLOWED');
  });

  it('uses default maxAge when not specified', async () => {
    const defaultApp = buildApp({ allowedOrigins: ['https://app.example.com'] });
    const res = await request(defaultApp)
      .options('/test')
      .set('Origin', 'https://app.example.com')
      .set('Access-Control-Request-Method', 'GET');

    expect(res.headers['access-control-max-age']).toBe(String(CORS_DEFAULTS.maxAge));
  });
});

// ─── Integration: wildcard subdomain ────────────────────────────────────────

describe('CORS middleware — wildcard subdomain matching', () => {
  let app;

  beforeEach(() => {
    app = buildApp({ allowedOrigins: ['*.example.com'] });
  });

  it('allows a matching subdomain', async () => {
    const res = await request(app)
      .get('/test')
      .set('Origin', 'https://tenant1.example.com');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://tenant1.example.com');
  });

  it('allows another matching subdomain', async () => {
    const res = await request(app)
      .get('/test')
      .set('Origin', 'https://tenant2.example.com');

    expect(res.status).toBe(200);
  });

  it('rejects the bare domain', async () => {
    const res = await request(app)
      .get('/test')
      .set('Origin', 'https://example.com');

    expect(res.status).toBe(403);
  });

  it('rejects a different domain', async () => {
    const res = await request(app)
      .get('/test')
      .set('Origin', 'https://tenant1.other.com');

    expect(res.status).toBe(403);
  });

  it('handles preflight for wildcard-matched origin', async () => {
    const res = await request(app)
      .options('/test')
      .set('Origin', 'https://tenant1.example.com')
      .set('Access-Control-Request-Method', 'POST');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('https://tenant1.example.com');
  });
});

// ─── Integration: method/header/maxAge overrides ────────────────────────────

describe('CORS middleware — configuration overrides', () => {
  it('uses custom allowed methods', async () => {
    const app = buildApp({
      allowedOrigins: ['https://app.example.com'],
      methods: 'GET,POST',
    });

    const res = await request(app)
      .get('/test')
      .set('Origin', 'https://app.example.com');

    expect(res.headers['access-control-allow-methods']).toBe('GET,POST');
  });

  it('uses custom allowed headers', async () => {
    const app = buildApp({
      allowedOrigins: ['https://app.example.com'],
      headers: 'Content-Type,X-Custom-Header',
    });

    const res = await request(app)
      .get('/test')
      .set('Origin', 'https://app.example.com');

    expect(res.headers['access-control-allow-headers']).toBe('Content-Type,X-Custom-Header');
  });

  it('uses CORS_ALLOWED_METHODS env var', async () => {
    const OLD_ENV = process.env.CORS_ALLOWED_METHODS;
    process.env.CORS_ALLOWED_METHODS = 'GET,HEAD';

    const app = buildApp({ allowedOrigins: ['https://app.example.com'] });
    const res = await request(app)
      .get('/test')
      .set('Origin', 'https://app.example.com');

    expect(res.headers['access-control-allow-methods']).toBe('GET,HEAD');
    process.env.CORS_ALLOWED_METHODS = OLD_ENV;
  });

  it('uses CORS_ALLOWED_HEADERS env var', async () => {
    const OLD_ENV = process.env.CORS_ALLOWED_HEADERS;
    process.env.CORS_ALLOWED_HEADERS = 'Authorization,X-Custom';

    const app = buildApp({ allowedOrigins: ['https://app.example.com'] });
    const res = await request(app)
      .get('/test')
      .set('Origin', 'https://app.example.com');

    expect(res.headers['access-control-allow-headers']).toBe('Authorization,X-Custom');
    process.env.CORS_ALLOWED_HEADERS = OLD_ENV;
  });

  it('uses CORS_MAX_AGE env var for preflight', async () => {
    const OLD_ENV = process.env.CORS_MAX_AGE;
    process.env.CORS_MAX_AGE = '7200';

    const app = buildApp({ allowedOrigins: ['https://app.example.com'] });
    const res = await request(app)
      .options('/test')
      .set('Origin', 'https://app.example.com')
      .set('Access-Control-Request-Method', 'GET');

    expect(res.headers['access-control-max-age']).toBe('7200');
    process.env.CORS_MAX_AGE = OLD_ENV;
  });
});

// ─── Integration: mixed exact + wildcard ────────────────────────────────────

describe('CORS middleware — mixed exact and wildcard origins', () => {
  let app;

  beforeEach(() => {
    app = buildApp({
      allowedOrigins: ['https://app.example.com', '*.tenant.io'],
    });
  });

  it('allows exact match', async () => {
    const res = await request(app)
      .get('/test')
      .set('Origin', 'https://app.example.com');
    expect(res.status).toBe(200);
  });

  it('allows wildcard match', async () => {
    const res = await request(app)
      .get('/test')
      .set('Origin', 'https://acme.tenant.io');
    expect(res.status).toBe(200);
  });

  it('rejects origin not matching either rule', async () => {
    const res = await request(app)
      .get('/test')
      .set('Origin', 'https://other.com');
    expect(res.status).toBe(403);
  });
});

// ─── CORS_DEFAULTS export ────────────────────────────────────────────────────

describe('CORS_DEFAULTS', () => {
  it('exports expected default values', () => {
    expect(CORS_DEFAULTS.methods).toContain('GET');
    expect(CORS_DEFAULTS.methods).toContain('POST');
    expect(CORS_DEFAULTS.methods).toContain('OPTIONS');
    expect(CORS_DEFAULTS.headers).toContain('Content-Type');
    expect(CORS_DEFAULTS.headers).toContain('Authorization');
    expect(typeof CORS_DEFAULTS.maxAge).toBe('number');
    expect(CORS_DEFAULTS.maxAge).toBeGreaterThan(0);
  });
});
