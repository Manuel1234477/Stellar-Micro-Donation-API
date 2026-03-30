'use strict';

/**
 * Tests for federation lookup endpoints (#607)
 * Covers: successful resolution, cache hit, timeout, invalid format, reverse lookup
 */

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-federation-key';
process.env.FEDERATION_CACHE_TTL = '300';

const request = require('supertest');
const express = require('express');

const VALID_PUBLIC_KEY = 'GDKV6OAXXQZ6HSBNB62P2BQAJWVKBX2LLCJAEEZHL7OYGKXGRPPR6OBM';

// Inject resolver functions via middleware for testing
function createTestApp(forwardResolver, reverseResolver) {
  const { router: federationLookupRouter } = require('../../src/routes/federationLookup');
  const app = express();
  app.use(express.json());
  // Inject test resolvers via req properties
  app.use((req, _res, next) => {
    if (forwardResolver) req._resolverFn = forwardResolver;
    if (reverseResolver) req._reverseResolverFn = reverseResolver;
    next();
  });
  app.use('/federation', federationLookupRouter);
  app.use((err, req, res, _next) => {
    res.status(err.status || 500).json({ success: false, error: err.message });
  });
  return app;
}

beforeEach(() => {
  const { clearCaches } = require('../../src/routes/federationLookup');
  clearCaches();
});

describe('GET /federation/resolve', () => {
  test('resolves a valid federation address', async () => {
    const app = createTestApp(() => Promise.resolve({ account_id: VALID_PUBLIC_KEY, stellar_address: 'alice*example.com' }));

    const res = await request(app).get('/federation/resolve?address=alice*example.com');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.account_id).toBe(VALID_PUBLIC_KEY);
    expect(res.body.data.address).toBe('alice*example.com');
    expect(res.body.cached).toBe(false);
  });

  test('returns cached result on second request', async () => {
    let callCount = 0;
    const resolver = () => { callCount++; return Promise.resolve({ account_id: VALID_PUBLIC_KEY }); };
    const app = createTestApp(resolver);

    await request(app).get('/federation/resolve?address=bob*example.com');
    const res = await request(app).get('/federation/resolve?address=bob*example.com');

    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(true);
    expect(callCount).toBe(1);
  });

  test('returns 400 for invalid federation address format', async () => {
    const app = createTestApp();
    const res = await request(app).get('/federation/resolve?address=notavalidaddress');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_FORMAT');
  });

  test('returns 400 when address parameter is missing', async () => {
    const app = createTestApp();
    const res = await request(app).get('/federation/resolve');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_PARAMETER');
  });

  test('returns 504 on federation server timeout', async () => {
    const app = createTestApp(() => Promise.reject(new Error('ETIMEDOUT: connection timed out')));
    const res = await request(app).get('/federation/resolve?address=timeout*example.com');

    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe('FEDERATION_TIMEOUT');
  });

  test('returns 404 when address is not found', async () => {
    const app = createTestApp(() => Promise.reject(new Error('not found')));
    const res = await request(app).get('/federation/resolve?address=unknown*example.com');

    expect(res.status).toBe(404);
  });

  test('returns 400 for address with no domain part', async () => {
    const app = createTestApp();
    const res = await request(app).get('/federation/resolve?address=alice*');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_FORMAT');
  });

  test('does not cache failed resolutions', async () => {
    const app = createTestApp(() => Promise.reject(new Error('not found')));
    await request(app).get('/federation/resolve?address=fail*example.com');

    const { _forwardCache } = require('../../src/routes/federationLookup');
    expect(_forwardCache.has('fail*example.com')).toBe(false);
  });
});

describe('GET /federation/reverse', () => {
  test('resolves a public key to a federation address', async () => {
    const app = createTestApp(null, () => Promise.resolve({ stellar_address: 'alice*example.com', account_id: VALID_PUBLIC_KEY }));
    const res = await request(app).get(`/federation/reverse?publicKey=${VALID_PUBLIC_KEY}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.federationAddress).toBe('alice*example.com');
    expect(res.body.data.publicKey).toBe(VALID_PUBLIC_KEY);
    expect(res.body.cached).toBe(false);
  });

  test('returns cached result on second reverse request', async () => {
    let callCount = 0;
    const resolver = () => { callCount++; return Promise.resolve({ stellar_address: 'bob*example.com' }); };
    const app = createTestApp(null, resolver);

    await request(app).get(`/federation/reverse?publicKey=${VALID_PUBLIC_KEY}`);
    const res = await request(app).get(`/federation/reverse?publicKey=${VALID_PUBLIC_KEY}`);

    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(true);
    expect(callCount).toBe(1);
  });

  test('returns 400 for invalid public key format', async () => {
    const app = createTestApp();
    const res = await request(app).get('/federation/reverse?publicKey=INVALID_KEY');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_FORMAT');
  });

  test('returns 400 when publicKey parameter is missing', async () => {
    const app = createTestApp();
    const res = await request(app).get('/federation/reverse');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_PARAMETER');
  });

  test('returns 504 on reverse lookup timeout', async () => {
    const app = createTestApp(null, () => Promise.reject(new Error('ETIMEDOUT')));
    const res = await request(app).get(`/federation/reverse?publicKey=${VALID_PUBLIC_KEY}`);

    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe('FEDERATION_TIMEOUT');
  });

  test('returns 404 when no federation address found for key', async () => {
    const app = createTestApp(null, () => Promise.reject(new Error('not found')));
    const res = await request(app).get(`/federation/reverse?publicKey=${VALID_PUBLIC_KEY}`);

    expect(res.status).toBe(404);
  });
});

describe('Federation cache TTL', () => {
  test('FEDERATION_CACHE_TTL env var is set', () => {
    expect(process.env.FEDERATION_CACHE_TTL).toBe('300');
  });

  test('cache stores resolved address with expiry', async () => {
    const app = createTestApp(() => Promise.resolve({ account_id: VALID_PUBLIC_KEY }));
    await request(app).get('/federation/resolve?address=cached*test.com');

    const { _forwardCache } = require('../../src/routes/federationLookup');
    expect(_forwardCache.has('cached*test.com')).toBe(true);
    const entry = _forwardCache.get('cached*test.com');
    expect(entry.expiresAt).toBeGreaterThan(Date.now());
    expect(entry.expiresAt - Date.now()).toBeLessThanOrEqual(300 * 1000 + 100);
  });

  test('clearCaches empties both forward and reverse caches', async () => {
    const app = createTestApp(() => Promise.resolve({ account_id: VALID_PUBLIC_KEY }));
    await request(app).get('/federation/resolve?address=clear*test.com');

    const { clearCaches, _forwardCache } = require('../../src/routes/federationLookup');
    expect(_forwardCache.size).toBeGreaterThan(0);
    clearCaches();
    expect(_forwardCache.size).toBe(0);
  });
});
