'use strict';

/**
 * Caching Middleware Tests
 *
 * Covers:
 * - ETag generation and uniqueness
 * - 304 response on unchanged resource (If-None-Match)
 * - 304 response via If-Modified-Since
 * - Cache-Control header values per resource type
 * - ETag changes when resource is modified (cache invalidation)
 * - Non-GET methods bypass caching
 * - Error responses are not cached
 */

const { cacheMiddleware, generateETag, buildCacheControl, MAX_AGE } = require('../../src/middleware/caching');

// ─── Minimal req/res factory ─────────────────────────────────────────────────

function makeReqRes(method = 'GET', reqHeaders = {}) {
  const req = {
    method,
    headers: Object.fromEntries(
      Object.entries(reqHeaders).map(([k, v]) => [k.toLowerCase(), v])
    ),
  };

  const _headers = {};
  let _statusCode = 200;

  const res = {
    get statusCode() { return _statusCode; },
    set statusCode(v) { _statusCode = v; },
    setHeader(k, v) { _headers[k.toLowerCase()] = v; },
    getHeader(k) { return _headers[k.toLowerCase()]; },
    status(code) { _statusCode = code; return res; },
    end() { res._ended = true; return res; },
    _ended: false,
    _body: null,
    // base json — will be wrapped by middleware
    json(body) { res._body = body; return res; },
  };

  return { req, res, headers: _headers };
}

// ─── generateETag ─────────────────────────────────────────────────────────────

describe('generateETag()', () => {
  it('returns a quoted hex string', () => {
    expect(generateETag({ id: 1 })).toMatch(/^"[a-f0-9]+"$/);
  });

  it('is deterministic for the same input', () => {
    const data = { id: 1, name: 'test' };
    expect(generateETag(data)).toBe(generateETag(data));
  });

  it('produces different tags for different data', () => {
    expect(generateETag({ id: 1 })).not.toBe(generateETag({ id: 2 }));
  });

  it('handles string input', () => {
    expect(generateETag('hello')).toMatch(/^"[a-f0-9]+"$/);
  });

  it('does not expose raw sensitive data in the tag', () => {
    const tag = generateETag({ secret: 'my-private-key-abc123' });
    expect(tag).not.toContain('my-private-key-abc123');
    expect(tag).not.toContain('secret');
  });
});

// ─── buildCacheControl ────────────────────────────────────────────────────────

describe('buildCacheControl()', () => {
  it('builds public header', () => {
    expect(buildCacheControl('public', 60)).toBe('public, max-age=60');
  });

  it('builds private header', () => {
    expect(buildCacheControl('private', 30)).toBe('private, max-age=30');
  });
});

// ─── MAX_AGE map ──────────────────────────────────────────────────────────────

describe('MAX_AGE', () => {
  it.each(['wallet', 'campaign', 'stats', 'exchange-rate', 'default'])(
    'has a positive value for %s',
    (key) => expect(MAX_AGE[key]).toBeGreaterThan(0)
  );

  it('stats max-age >= wallet max-age', () => {
    expect(MAX_AGE.stats).toBeGreaterThanOrEqual(MAX_AGE.wallet);
  });
});

// ─── cacheMiddleware — ETag & headers ────────────────────────────────────────

describe('cacheMiddleware() — headers', () => {
  it('sets ETag on successful GET', () => {
    const { req, res, headers } = makeReqRes();
    cacheMiddleware('wallet', 'private')(req, res, () => {});
    res.statusCode = 200;
    res.json({ id: 1 });
    expect(headers['etag']).toMatch(/^"[a-f0-9]+"$/);
  });

  it('sets Last-Modified on successful GET', () => {
    const { req, res, headers } = makeReqRes();
    cacheMiddleware('wallet', 'private')(req, res, () => {});
    res.statusCode = 200;
    res.json({ id: 1 });
    expect(headers['last-modified']).toBeDefined();
  });

  it('ETag changes when response data changes', () => {
    const m = cacheMiddleware('wallet', 'private');

    const { req: r1, res: res1, headers: h1 } = makeReqRes();
    m(r1, res1, () => {}); res1.statusCode = 200; res1.json({ balance: 100 });

    const { req: r2, res: res2, headers: h2 } = makeReqRes();
    m(r2, res2, () => {}); res2.statusCode = 200; res2.json({ balance: 200 });

    expect(h1['etag']).not.toBe(h2['etag']);
  });

  it('ETag is stable for identical data', () => {
    const body = { id: 1, balance: 100 };
    const m = cacheMiddleware('wallet', 'private');

    const { req: r1, res: res1, headers: h1 } = makeReqRes();
    m(r1, res1, () => {}); res1.statusCode = 200; res1.json(body);

    const { req: r2, res: res2, headers: h2 } = makeReqRes();
    m(r2, res2, () => {}); res2.statusCode = 200; res2.json(body);

    expect(h1['etag']).toBe(h2['etag']);
  });

  it('sets private Cache-Control for wallet', () => {
    const { req, res, headers } = makeReqRes();
    cacheMiddleware('wallet', 'private')(req, res, () => {});
    res.statusCode = 200; res.json({ id: 1 });
    expect(headers['cache-control']).toBe(`private, max-age=${MAX_AGE.wallet}`);
  });

  it('sets public Cache-Control for campaign', () => {
    const { req, res, headers } = makeReqRes();
    cacheMiddleware('campaign', 'public')(req, res, () => {});
    res.statusCode = 200; res.json({ id: 1 });
    expect(headers['cache-control']).toBe(`public, max-age=${MAX_AGE.campaign}`);
  });

  it('sets correct max-age for stats', () => {
    const { req, res, headers } = makeReqRes();
    cacheMiddleware('stats', 'private')(req, res, () => {});
    res.statusCode = 200; res.json({ total: 42 });
    expect(headers['cache-control']).toBe(`private, max-age=${MAX_AGE.stats}`);
  });

  it('falls back to default max-age for unknown resource type', () => {
    const { req, res, headers } = makeReqRes();
    cacheMiddleware('unknown', 'public')(req, res, () => {});
    res.statusCode = 200; res.json({ x: 1 });
    expect(headers['cache-control']).toBe(`public, max-age=${MAX_AGE.default}`);
  });
});

// ─── cacheMiddleware — If-None-Match (304) ────────────────────────────────────

describe('cacheMiddleware() — If-None-Match', () => {
  it('returns 304 when ETag matches', () => {
    const body = { id: 1 };
    const etag = generateETag(body);
    const { req, res } = makeReqRes('GET', { 'if-none-match': etag });
    cacheMiddleware('wallet', 'private')(req, res, () => {});
    res.statusCode = 200;
    res.json(body);
    expect(res.statusCode).toBe(304);
    expect(res._ended).toBe(true);
  });

  it('returns 200 when ETag does not match', () => {
    const { req, res } = makeReqRes('GET', { 'if-none-match': '"stale"' });
    cacheMiddleware('wallet', 'private')(req, res, () => {});
    res.statusCode = 200;
    res.json({ id: 1 });
    expect(res.statusCode).toBe(200);
  });

  it('returns 304 for wildcard If-None-Match: *', () => {
    const { req, res } = makeReqRes('GET', { 'if-none-match': '*' });
    cacheMiddleware('campaign', 'public')(req, res, () => {});
    res.statusCode = 200;
    res.json({ id: 2 });
    expect(res.statusCode).toBe(304);
    expect(res._ended).toBe(true);
  });

  it('handles multiple ETags in If-None-Match', () => {
    const body = { id: 3 };
    const etag = generateETag(body);
    const { req, res } = makeReqRes('GET', { 'if-none-match': `"other", ${etag}` });
    cacheMiddleware('wallet', 'private')(req, res, () => {});
    res.statusCode = 200;
    res.json(body);
    expect(res.statusCode).toBe(304);
  });
});

// ─── cacheMiddleware — If-Modified-Since (304) ────────────────────────────────

describe('cacheMiddleware() — If-Modified-Since', () => {
  it('returns 304 when resource not modified since future date', () => {
    const future = new Date(Date.now() + 60000).toUTCString();
    const { req, res } = makeReqRes('GET', { 'if-modified-since': future });
    cacheMiddleware('stats', 'private')(req, res, () => {});
    res.statusCode = 200;
    res.json({ total: 1 });
    expect(res.statusCode).toBe(304);
    expect(res._ended).toBe(true);
  });

  it('returns 200 when resource was modified after If-Modified-Since', () => {
    const past = new Date(Date.now() - 60000).toUTCString();
    const { req, res } = makeReqRes('GET', { 'if-modified-since': past });
    cacheMiddleware('stats', 'private')(req, res, () => {});
    res.statusCode = 200;
    res.json({ total: 1 });
    expect(res.statusCode).toBe(200);
  });

  it('If-None-Match takes precedence over If-Modified-Since', () => {
    const body = { id: 1 };
    const etag = generateETag(body);
    const future = new Date(Date.now() + 60000).toUTCString();
    const { req, res } = makeReqRes('GET', {
      'if-none-match': etag,
      'if-modified-since': future,
    });
    cacheMiddleware('wallet', 'private')(req, res, () => {});
    res.statusCode = 200;
    res.json(body);
    expect(res.statusCode).toBe(304);
  });
});

// ─── cacheMiddleware — cache invalidation ────────────────────────────────────

describe('cacheMiddleware() — cache invalidation', () => {
  it('stale ETag does not get 304 when data has changed', () => {
    const v1 = { id: 1, balance: 100 };
    const v2 = { id: 1, balance: 999 };
    const staleTag = generateETag(v1);

    const { req, res, headers } = makeReqRes('GET', { 'if-none-match': staleTag });
    cacheMiddleware('wallet', 'private')(req, res, () => {});
    res.statusCode = 200;
    res.json(v2); // resource changed

    expect(res.statusCode).toBe(200);
    expect(headers['etag']).toBe(generateETag(v2));
    expect(headers['etag']).not.toBe(staleTag);
  });
});

// ─── cacheMiddleware — non-GET bypass ────────────────────────────────────────

describe('cacheMiddleware() — non-GET bypass', () => {
  it.each(['POST', 'PATCH', 'PUT', 'DELETE'])('%s does not set ETag', (method) => {
    const { req, res, headers } = makeReqRes(method);
    cacheMiddleware('wallet', 'private')(req, res, () => {});
    res.statusCode = 200;
    res.json({ id: 1 });
    expect(headers['etag']).toBeUndefined();
  });
});

// ─── cacheMiddleware — error responses not cached ────────────────────────────

describe('cacheMiddleware() — error responses not cached', () => {
  it.each([400, 401, 403, 404, 500])('%d response has no ETag', (code) => {
    const { req, res, headers } = makeReqRes();
    cacheMiddleware('wallet', 'private')(req, res, () => {});
    res.statusCode = code;
    res.json({ error: 'oops' });
    expect(headers['etag']).toBeUndefined();
  });
});
