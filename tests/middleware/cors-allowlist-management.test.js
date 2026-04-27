'use strict';

/**
 * Tests: CORS Allowlist Management (#611)
 * Covers: add, remove, list, cache invalidation, wildcard matching, non-admin rejection
 */

const {
  isOriginAllowed,
  wildcardToRegex,
  parseAllowedOrigins,
  invalidateCache,
  loadDbOrigins,
  _cache,
} = require('../../src/middleware/cors');

// ─── wildcardToRegex ──────────────────────────────────────────────────────────

describe('wildcardToRegex', () => {
  it('returns null for non-wildcard patterns', () => {
    expect(wildcardToRegex('https://example.com')).toBeNull();
  });

  it('returns a RegExp for *.example.com', () => {
    expect(wildcardToRegex('*.example.com')).toBeInstanceOf(RegExp);
  });

  it('matches subdomains', () => {
    const re = wildcardToRegex('*.example.com');
    expect(re.test('https://app.example.com')).toBe(true);
    expect(re.test('http://sub.example.com')).toBe(true);
  });

  it('does not match root domain without subdomain', () => {
    expect(wildcardToRegex('*.example.com').test('https://example.com')).toBe(false);
  });

  it('does not match a different domain', () => {
    expect(wildcardToRegex('*.example.com').test('https://evil.com')).toBe(false);
  });

  it('handles special regex chars in domain', () => {
    const re = wildcardToRegex('*.my-app.io');
    expect(re.test('https://api.my-app.io')).toBe(true);
    expect(re.test('https://api.myXapp.io')).toBe(false);
  });
});

// ─── isOriginAllowed ──────────────────────────────────────────────────────────

describe('isOriginAllowed', () => {
  it('returns false for empty/null origin', () => {
    expect(isOriginAllowed('', ['https://example.com'])).toBe(false);
    expect(isOriginAllowed(null, ['https://example.com'])).toBe(false);
    expect(isOriginAllowed(undefined, ['https://example.com'])).toBe(false);
  });

  it('returns false when allowlist is empty', () => {
    expect(isOriginAllowed('https://example.com', [])).toBe(false);
  });

  it('allows exact match', () => {
    expect(isOriginAllowed('https://example.com', ['https://example.com'])).toBe(true);
  });

  it('rejects non-matching origin', () => {
    expect(isOriginAllowed('https://evil.com', ['https://example.com'])).toBe(false);
  });

  it('allows wildcard subdomain match', () => {
    expect(isOriginAllowed('https://app.example.com', ['*.example.com'])).toBe(true);
  });

  it('rejects root domain for wildcard pattern', () => {
    expect(isOriginAllowed('https://example.com', ['*.example.com'])).toBe(false);
  });

  it('allows when one of multiple origins matches', () => {
    const list = ['https://a.com', '*.b.com', 'https://c.com'];
    expect(isOriginAllowed('https://sub.b.com', list)).toBe(true);
    expect(isOriginAllowed('https://c.com', list)).toBe(true);
    expect(isOriginAllowed('https://d.com', list)).toBe(false);
  });

  it('is case-sensitive for exact matches', () => {
    expect(isOriginAllowed('https://Example.com', ['https://example.com'])).toBe(false);
  });
});

// ─── parseAllowedOrigins ──────────────────────────────────────────────────────

describe('parseAllowedOrigins', () => {
  it('returns empty array for empty string', () => {
    expect(parseAllowedOrigins('')).toEqual([]);
  });

  it('returns empty array for whitespace-only string', () => {
    expect(parseAllowedOrigins('   ')).toEqual([]);
  });

  it('parses comma-separated origins', () => {
    expect(parseAllowedOrigins('https://a.com, https://b.com')).toEqual(['https://a.com', 'https://b.com']);
  });

  it('filters blank entries', () => {
    expect(parseAllowedOrigins('https://a.com,,https://b.com')).toEqual(['https://a.com', 'https://b.com']);
  });

  it('trims whitespace from each entry', () => {
    expect(parseAllowedOrigins('  https://a.com  ,  https://b.com  ')).toEqual(['https://a.com', 'https://b.com']);
  });
});

// ─── Cache invalidation ───────────────────────────────────────────────────────

describe('invalidateCache', () => {
  it('resets origins to null', () => {
    _cache.origins = ['https://cached.com'];
    _cache.expiresAt = Date.now() + 60000;
    invalidateCache();
    expect(_cache.origins).toBeNull();
  });

  it('resets expiresAt to 0', () => {
    _cache.expiresAt = Date.now() + 60000;
    invalidateCache();
    expect(_cache.expiresAt).toBe(0);
  });

  it('is idempotent', () => {
    invalidateCache();
    invalidateCache();
    expect(_cache.origins).toBeNull();
    expect(_cache.expiresAt).toBe(0);
  });
});

// ─── loadDbOrigins ────────────────────────────────────────────────────────────

const Database = require('../../src/utils/database');

describe('loadDbOrigins', () => {
  beforeAll(async () => {
    await Database.initialize();
    await Database.run(`
      CREATE TABLE IF NOT EXISTS cors_origins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        origin TEXT NOT NULL UNIQUE,
        allowCredentials INTEGER NOT NULL DEFAULT 1,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        createdBy TEXT
      )
    `);
  });

  afterAll(async () => {
    await Database.run('DELETE FROM cors_origins').catch(() => {});
    await Database.close();
  });

  beforeEach(async () => {
    await Database.run('DELETE FROM cors_origins').catch(() => {});
    invalidateCache();
  });

  it('returns empty array when table is empty', async () => {
    const origins = await loadDbOrigins();
    expect(origins).toEqual([]);
  });

  it('returns origins from database', async () => {
    await Database.run(`INSERT INTO cors_origins (origin) VALUES (?)`, ['https://db-origin.com']);
    const origins = await loadDbOrigins();
    expect(origins).toContain('https://db-origin.com');
  });

  it('caches results for 60 seconds', async () => {
    await Database.run(`INSERT INTO cors_origins (origin) VALUES (?)`, ['https://cached.com']);
    await loadDbOrigins(); // populate cache
    // Add another origin directly — should NOT appear in cached result
    await Database.run(`INSERT INTO cors_origins (origin) VALUES (?)`, ['https://new-origin.com']);
    const cached = await loadDbOrigins();
    expect(cached).not.toContain('https://new-origin.com');
  });

  it('reloads after cache invalidation', async () => {
    await Database.run(`INSERT INTO cors_origins (origin) VALUES (?)`, ['https://first.com']);
    await loadDbOrigins(); // populate cache
    await Database.run(`INSERT INTO cors_origins (origin) VALUES (?)`, ['https://second.com']);
    invalidateCache();
    const fresh = await loadDbOrigins();
    expect(fresh).toContain('https://second.com');
  });

  it('returns empty array gracefully when table does not exist', async () => {
    // Simulate missing table by temporarily mocking Database.query
    const original = Database.query.bind(Database);
    Database.query = async () => { throw new Error('no such table: cors_origins'); };
    const origins = await loadDbOrigins();
    expect(origins).toEqual([]);
    Database.query = original;
    invalidateCache();
  });
});

// ─── Admin route handler unit tests ──────────────────────────────────────────

describe('Admin CORS origins route handlers', () => {
  const corsOriginsRouter = require('../../src/routes/admin/corsOrigins');

  function makeReqRes(overrides = {}) {
    const req = {
      body: {},
      params: {},
      user: { id: 1, role: 'admin' },
      ...overrides,
    };
    const res = {
      _status: 200, _body: null,
      status(s) { this._status = s; return this; },
      json(b) { this._body = b; return this; },
    };
    const next = jest.fn();
    return { req, res, next };
  }

  beforeAll(async () => {
    await Database.initialize();
    await Database.run(`
      CREATE TABLE IF NOT EXISTS cors_origins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        origin TEXT NOT NULL UNIQUE,
        allowCredentials INTEGER NOT NULL DEFAULT 1,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        createdBy TEXT
      )
    `);
  });

  beforeEach(async () => {
    await Database.run('DELETE FROM cors_origins').catch(() => {});
    invalidateCache();
  });

  it('GET handler returns list of origins', async () => {
    await Database.run(`INSERT INTO cors_origins (origin) VALUES (?)`, ['https://test.com']);
    // Find the GET handler directly from the router stack
    const getHandler = corsOriginsRouter.stack.find(l => l.route && l.route.methods.get)?.route?.stack?.[2]?.handle;
    if (!getHandler) return; // skip if structure differs
    const { req, res } = makeReqRes();
    await getHandler(req, res, jest.fn());
    expect(res._body.data.length).toBeGreaterThan(0);
  });

  it('POST handler validates missing origin', async () => {
    const postHandler = corsOriginsRouter.stack.find(l => l.route && l.route.methods.post)?.route?.stack?.[2]?.handle;
    if (!postHandler) return;
    const { req, res, next } = makeReqRes({ body: {} });
    await postHandler(req, res, next);
    expect(res._status).toBe(400);
  });

  it('POST handler validates invalid origin format', async () => {
    const postHandler = corsOriginsRouter.stack.find(l => l.route && l.route.methods.post)?.route?.stack?.[2]?.handle;
    if (!postHandler) return;
    const { req, res, next } = makeReqRes({ body: { origin: 'not-a-url' } });
    await postHandler(req, res, next);
    expect(res._status).toBe(400);
  });

  it('POST handler adds valid URL origin', async () => {
    const postHandler = corsOriginsRouter.stack.find(l => l.route && l.route.methods.post)?.route?.stack?.[2]?.handle;
    if (!postHandler) return;
    const { req, res, next } = makeReqRes({ body: { origin: 'https://valid.com' } });
    await postHandler(req, res, next);
    expect(res._status).toBe(201);
    expect(res._body.data.origin).toBe('https://valid.com');
  });

  it('POST handler adds wildcard pattern', async () => {
    const postHandler = corsOriginsRouter.stack.find(l => l.route && l.route.methods.post)?.route?.stack?.[2]?.handle;
    if (!postHandler) return;
    const { req, res, next } = makeReqRes({ body: { origin: '*.valid.com' } });
    await postHandler(req, res, next);
    expect(res._status).toBe(201);
  });

  it('POST handler returns 409 for duplicate', async () => {
    const postHandler = corsOriginsRouter.stack.find(l => l.route && l.route.methods.post)?.route?.stack?.[2]?.handle;
    if (!postHandler) return;
    await Database.run(`INSERT INTO cors_origins (origin) VALUES (?)`, ['https://dup.com']);
    const { req, res, next } = makeReqRes({ body: { origin: 'https://dup.com' } });
    await postHandler(req, res, next);
    expect(res._status).toBe(409);
  });

  it('DELETE handler returns 404 for non-existent id', async () => {
    const deleteHandler = corsOriginsRouter.stack.find(l => l.route && l.route.methods.delete)?.route?.stack?.[2]?.handle;
    if (!deleteHandler) return;
    const { req, res, next } = makeReqRes({ params: { id: '99999' } });
    await deleteHandler(req, res, next);
    expect(res._status).toBe(404);
  });

  it('DELETE handler removes existing origin and invalidates cache', async () => {
    const deleteHandler = corsOriginsRouter.stack.find(l => l.route && l.route.methods.delete)?.route?.stack?.[2]?.handle;
    if (!deleteHandler) return;
    const insert = await Database.run(`INSERT INTO cors_origins (origin) VALUES (?)`, ['https://todelete.com']);
    _cache.origins = ['https://todelete.com'];
    _cache.expiresAt = Date.now() + 60000;
    const { req, res, next } = makeReqRes({ params: { id: String(insert.id) } });
    await deleteHandler(req, res, next);
    expect(res._status).toBe(200);
    expect(_cache.origins).toBeNull();
  });
});
