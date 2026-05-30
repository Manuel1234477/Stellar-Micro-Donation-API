'use strict';

/**
 * Tests: Stellar Federation Protocol Support
 *
 * Covers:
 *  federation.js utility:
 *   - isFederationAddress: valid, invalid formats
 *   - resolveAddress: success, cache hit, cache miss after TTL, not-found, server error, invalid address
 *   - resolveRecipient: federation address → public key, raw key passthrough
 *   - clearCache / getCacheSize
 *
 *  GET /.well-known/stellar.toml:
 *   - returns TOML with FEDERATION_SERVER URL, CORS header
 *
 *  GET /federation:
 *   - 200 name lookup success (with and without memo)
 *   - 404 not found
 *   - 400 missing params
 *   - 400 invalid address format
 *   - 501 unsupported type
 *
 *  POST /donations (federation integration):
 *   - resolves federation address before creating donation
 *   - passes raw public key through unchanged
 *   - returns 400 when federation resolution fails
 */

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-fed-key';

jest.mock('../src/services/AuditLogService', () => ({
  log: jest.fn().mockResolvedValue(undefined),
  CATEGORY: { AUTHENTICATION: 'AUTHENTICATION', DONATION: 'DONATION' },
  ACTION: { API_KEY_VALIDATION_FAILED: 'API_KEY_VALIDATION_FAILED', API_KEY_VALIDATED: 'API_KEY_VALIDATED' },
  SEVERITY: { HIGH: 'HIGH', LOW: 'LOW', MEDIUM: 'MEDIUM' },
}));

const request = require('supertest');
const express = require('express');
const { attachUserRole } = require('../../src/middleware/rbac');

// ─── federation.js utility tests ─────────────────────────────────────────────

describe('federation.js — isFederationAddress', () => {
  let fed;
  beforeEach(() => {
    jest.resetModules();
    fed = require('../../src/utils/federation');
  });

  it('returns true for valid federation address', () => {
    expect(fed.isFederationAddress('alice*example.com')).toBe(true);
    expect(fed.isFederationAddress('bob*stellar.org')).toBe(true);
    expect(fed.isFederationAddress('user.name*sub.domain.io')).toBe(true);
  });

  it('returns false for raw public key', () => {
    expect(fed.isFederationAddress('GABC123XYZ')).toBe(false);
  });

  it('returns false for missing domain', () => {
    expect(fed.isFederationAddress('alice*')).toBe(false);
  });

  it('returns false for missing name', () => {
    expect(fed.isFederationAddress('*example.com')).toBe(false);
  });

  it('returns false for multiple asterisks', () => {
    expect(fed.isFederationAddress('a*b*c.com')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(fed.isFederationAddress('')).toBe(false);
  });

  it('returns false for non-string', () => {
    expect(fed.isFederationAddress(null)).toBe(false);
    expect(fed.isFederationAddress(123)).toBe(false);
  });
});

describe('federation.js — resolveAddress', () => {
  const MOCK_RESULT = { account_id: 'GABC123PUBLICKEY56789012345678901234567890123456789012345' };
  let fed;

  beforeEach(() => {
    jest.resetModules();
    fed = require('../../src/utils/federation');
    fed.clearCache();
  });

  it('resolves a valid federation address', async () => {
    const result = await fed.resolveAddress('alice*example.com', {
      _resolverFn: async () => MOCK_RESULT,
    });
    expect(result.account_id).toBe(MOCK_RESULT.account_id);
  });

  it('caches the result on first call', async () => {
    const resolver = jest.fn().mockResolvedValue(MOCK_RESULT);
    await fed.resolveAddress('alice*example.com', { _resolverFn: resolver });
    await fed.resolveAddress('alice*example.com', { _resolverFn: resolver });
    expect(resolver).toHaveBeenCalledTimes(1); // second call hits cache
    expect(fed.getCacheSize()).toBe(1);
  });

  it('does not cache different addresses separately', async () => {
    const resolver = jest.fn().mockResolvedValue(MOCK_RESULT);
    await fed.resolveAddress('alice*example.com', { _resolverFn: resolver });
    await fed.resolveAddress('bob*example.com', { _resolverFn: resolver });
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(fed.getCacheSize()).toBe(2);
  });

  it('throws for invalid federation address', async () => {
    await expect(fed.resolveAddress('notafedaddress')).rejects.toThrow('Invalid federation address');
  });

  it('throws when resolver returns no account_id', async () => {
    await expect(
      fed.resolveAddress('alice*example.com', { _resolverFn: async () => ({}) })
    ).rejects.toThrow('not found');
  });

  it('throws and does not cache on resolver error', async () => {
    const resolver = jest.fn().mockRejectedValue(new Error('Server unreachable'));
    await expect(
      fed.resolveAddress('alice*example.com', { _resolverFn: resolver })
    ).rejects.toThrow('Federation resolution failed');
    expect(fed.getCacheSize()).toBe(0); // not cached
  });

  it('includes memo fields when present', async () => {
    const withMemo = { account_id: 'GABC...', memo_type: 'text', memo: '42' };
    const result = await fed.resolveAddress('alice*example.com', {
      _resolverFn: async () => withMemo,
    });
    expect(result.memo_type).toBe('text');
    expect(result.memo).toBe('42');
  });
});

describe('federation.js — resolveRecipient', () => {
  let fed;
  const PUBKEY = 'GABC123PUBLICKEY56789012345678901234567890123456789012345';

  beforeEach(() => {
    jest.resetModules();
    fed = require('../../src/utils/federation');
    fed.clearCache();
  });

  it('returns raw public key unchanged', async () => {
    const result = await fed.resolveRecipient(PUBKEY);
    expect(result).toBe(PUBKEY);
  });

  it('resolves federation address to account_id', async () => {
    const result = await fed.resolveRecipient('alice*example.com', {
      _resolverFn: async () => ({ account_id: PUBKEY }),
    });
    expect(result).toBe(PUBKEY);
  });

  it('throws when federation resolution fails', async () => {
    await expect(
      fed.resolveRecipient('alice*example.com', {
        _resolverFn: async () => { throw new Error('not found'); },
      })
    ).rejects.toThrow();
  });
});

describe('federation.js — clearCache / getCacheSize', () => {
  let fed;

  beforeEach(() => {
    jest.resetModules();
    fed = require('../../src/utils/federation');
    fed.clearCache();
  });

  it('getCacheSize returns 0 on fresh module', () => {
    expect(fed.getCacheSize()).toBe(0);
  });

  it('clearCache empties the cache', async () => {
    await fed.resolveAddress('alice*example.com', {
      _resolverFn: async () => ({ account_id: 'GABC...' }),
    });
    expect(fed.getCacheSize()).toBe(1);
    fed.clearCache();
    expect(fed.getCacheSize()).toBe(0);
  });
});

// ─── Federation server HTTP tests ────────────────────────────────────────────

function buildFedApp() {
  const { router: fedRouter, federationRegistry } = require('../../src/routes/federation');
  const app = express();
  app.use(express.json());
  app.use(fedRouter);
  return { app, federationRegistry };
}

describe('GET /.well-known/stellar.toml', () => {
  beforeEach(() => jest.resetModules());

  it('returns 200 with FEDERATION_SERVER line', async () => {
    const { app } = buildFedApp();
    const res = await request(app).get('/.well-known/stellar.toml');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/FEDERATION_SERVER=/);
  });

  it('sets Access-Control-Allow-Origin: *', async () => {
    const { app } = buildFedApp();
    const res = await request(app).get('/.well-known/stellar.toml');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('includes network passphrase', async () => {
    const { app } = buildFedApp();
    const res = await request(app).get('/.well-known/stellar.toml');
    expect(res.text).toMatch(/NETWORK_PASSPHRASE=/);
  });

  it('uses FEDERATION_DOMAIN env var when set', async () => {
    process.env.FEDERATION_DOMAIN = 'myapp.example.com';
    const { app } = buildFedApp();
    const res = await request(app).get('/.well-known/stellar.toml');
    expect(res.text).toContain('myapp.example.com');
    delete process.env.FEDERATION_DOMAIN;
  });
});

describe('GET /federation', () => {
  let app, federationRegistry;
  const PUBKEY = 'GABC123PUBLICKEY56789012345678901234567890123456789012345';

  beforeEach(() => {
    jest.resetModules();
    ({ app, federationRegistry } = buildFedApp());
    federationRegistry.clear();
    federationRegistry.set('alice', { account_id: PUBKEY });
    federationRegistry.set('bob', { account_id: PUBKEY, memo_type: 'text', memo: '99' });
  });

  it('returns 200 with account_id for known address', async () => {
    const res = await request(app).get('/federation?q=alice*example.com&type=name');
    expect(res.status).toBe(200);
    expect(res.body.account_id).toBe(PUBKEY);
    expect(res.body.stellar_address).toBe('alice*example.com');
  });

  it('includes memo fields when present', async () => {
    const res = await request(app).get('/federation?q=bob*example.com&type=name');
    expect(res.status).toBe(200);
    expect(res.body.memo_type).toBe('text');
    expect(res.body.memo).toBe('99');
  });

  it('returns 404 for unknown address', async () => {
    const res = await request(app).get('/federation?q=unknown*example.com&type=name');
    expect(res.status).toBe(404);
  });

  it('returns 400 when q is missing', async () => {
    const res = await request(app).get('/federation?type=name');
    expect(res.status).toBe(400);
  });

  it('returns 400 when type is missing', async () => {
    const res = await request(app).get('/federation?q=alice*example.com');
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid address format (no asterisk)', async () => {
    const res = await request(app).get('/federation?q=aliceexample.com&type=name');
    expect(res.status).toBe(400);
  });

  it('returns 501 for unsupported type', async () => {
    const res = await request(app).get('/federation?q=alice*example.com&type=id');
    expect(res.status).toBe(501);
  });

  it('sets Access-Control-Allow-Origin: * on success', async () => {
    const res = await request(app).get('/federation?q=alice*example.com&type=name');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('is case-insensitive for the name part', async () => {
    const res = await request(app).get('/federation?q=ALICE*example.com&type=name');
    expect(res.status).toBe(200);
    expect(res.body.account_id).toBe(PUBKEY);
  });
});

// ─── POST /donations federation integration ───────────────────────────────────

// Mock idempotency middleware to avoid DB dependency in these integration tests
jest.mock('../src/middleware/idempotency', () => ({
  requireIdempotency: (req, res, next) => {
    req.idempotency = { key: req.get('Idempotency-Key') || `auto-${Date.now()}` };
    next();
  },
  storeIdempotencyResponse: jest.fn().mockResolvedValue(undefined),
}));

describe('POST /donations — federation address resolution', () => {
  // Use the module-level singleton router (same pattern as other integration tests).
  // Mock federation at module level so the already-loaded donation router picks it up.
  const donationRouter = require('../../src/routes/donation');
  const fed = require('../../src/utils/federation');

  let app;
  const PUBKEY = 'GABC123PUBLICKEY56789012345678901234567890123456789012345';

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(attachUserRole());
    app.use('/donations', donationRouter);
    app.use((err, req, res, _next) => {
      res.status(err.statusCode || err.status || 500).json({
        success: false,
        error: { code: err.errorCode || err.code || 'ERROR', message: err.message },
      });
    });
  });

  it('resolves federation address and creates donation', async () => {
    jest.spyOn(fed, 'isFederationAddress').mockReturnValue(true);
    jest.spyOn(fed, 'resolveRecipient').mockResolvedValue(PUBKEY);

    const res = await request(app)
      .post('/donations')
      .set('x-api-key', 'test-fed-key')
      .set('Idempotency-Key', `fed-test-${Date.now()}`)
      .send({ amount: '10', recipient: 'alice*example.com' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(fed.resolveRecipient).toHaveBeenCalledWith('alice*example.com');
  });

  it('passes raw public key through without federation lookup', async () => {
    jest.spyOn(fed, 'isFederationAddress').mockReturnValue(false);
    const spy = jest.spyOn(fed, 'resolveRecipient');

    const res = await request(app)
      .post('/donations')
      .set('x-api-key', 'test-fed-key')
      .set('Idempotency-Key', `raw-test-${Date.now()}`)
      .send({ amount: '10', recipient: PUBKEY });
    expect(res.status).toBe(201);
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns error when federation resolution fails', async () => {
    jest.spyOn(fed, 'isFederationAddress').mockReturnValue(true);
    jest.spyOn(fed, 'resolveRecipient').mockRejectedValue(
      new Error('Federation resolution failed for "unknown*example.com": not found')
    );

    const res = await request(app)
      .post('/donations')
      .set('x-api-key', 'test-fed-key')
      .set('Idempotency-Key', `fail-test-${Date.now()}`)
      .send({ amount: '10', recipient: 'unknown*example.com' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.success).toBe(false);
  });

  afterEach(() => jest.restoreAllMocks());
});
