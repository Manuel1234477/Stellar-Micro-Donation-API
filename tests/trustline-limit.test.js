'use strict';

/**
 * Tests: Add support for Stellar change trust with limit (Issue #421)
 *
 * All Stellar interactions use MockStellarService — no live network calls.
 */

const MockStellarService = require('../src/services/MockStellarService');

const STELLAR_MAX_LIMIT = '922337203685.4775807';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a funded mock wallet via the mock's own createWallet() */
async function addWallet(mock) {
  return mock.createWallet();
}

/** Shared issuer keypair — created once for the whole suite */
let ISSUER_PUBLIC;
let ISSUER_SECRET;

beforeAll(async () => {
  const tmp = new MockStellarService();
  const issuer = await tmp.createWallet();
  ISSUER_PUBLIC = issuer.publicKey;
  ISSUER_SECRET = issuer.secretKey;
});

// ─────────────────────────────────────────────────────────────────────────────
// MockStellarService.addTrustline
// ─────────────────────────────────────────────────────────────────────────────
describe('MockStellarService.addTrustline', () => {
  let mock;

  beforeEach(() => {
    mock = new MockStellarService();
  });

  // Test Case 1: Successful trustline creation with a custom limit
  test('creates trustline with a custom limit', async () => {
    const { secretKey, publicKey } = await addWallet(mock);

    const result = await mock.addTrustline(secretKey, 'USDC', ISSUER_PUBLIC, '1000');

    expect(result.hash).toMatch(/^mock_trustline_/);
    expect(result.assetCode).toBe('USDC');
    expect(result.issuerPublic).toBe(ISSUER_PUBLIC);
    expect(result.limit).toBe('1000');
    expect(typeof result.ledger).toBe('number');

    // Verify stored state
    const stored = mock.getTrustline(publicKey, 'USDC', ISSUER_PUBLIC);
    expect(stored).toBeDefined();
    expect(stored.limit).toBe('1000');
  });

  // Test Case 4: No limit defaults to network maximum (unlimited)
  test('defaults to Stellar max when no limit provided', async () => {
    const { secretKey, publicKey } = await addWallet(mock);

    const result = await mock.addTrustline(secretKey, 'USDC', ISSUER_PUBLIC);

    expect(result.limit).toBe(STELLAR_MAX_LIMIT);
    const stored = mock.getTrustline(publicKey, 'USDC', ISSUER_PUBLIC);
    expect(stored.limit).toBe(STELLAR_MAX_LIMIT);
  });

  test('null limit defaults to Stellar max', async () => {
    const { secretKey } = await addWallet(mock);
    const result = await mock.addTrustline(secretKey, 'USDC', ISSUER_PUBLIC, null);
    expect(result.limit).toBe(STELLAR_MAX_LIMIT);
  });

  // Test Case 2: Successful limit update via PATCH (calling addTrustline again)
  test('updates an existing trustline limit', async () => {
    const { secretKey, publicKey } = await addWallet(mock);

    await mock.addTrustline(secretKey, 'USDC', ISSUER_PUBLIC, '500');
    const updated = await mock.addTrustline(secretKey, 'USDC', ISSUER_PUBLIC, '2000');

    expect(updated.limit).toBe('2000');
    const stored = mock.getTrustline(publicKey, 'USDC', ISSUER_PUBLIC);
    expect(stored.limit).toBe('2000');
  });

  // Test Case 3: Error handling for invalid limits
  test('rejects negative limit', async () => {
    const { secretKey } = await addWallet(mock);
    await expect(mock.addTrustline(secretKey, 'USDC', ISSUER_PUBLIC, '-1'))
      .rejects.toThrow('Trust limit must be a positive numeric string');
  });

  test('rejects zero limit', async () => {
    const { secretKey } = await addWallet(mock);
    await expect(mock.addTrustline(secretKey, 'USDC', ISSUER_PUBLIC, '0'))
      .rejects.toThrow('Trust limit must be a positive numeric string');
  });

  test('rejects non-numeric limit', async () => {
    const { secretKey } = await addWallet(mock);
    await expect(mock.addTrustline(secretKey, 'USDC', ISSUER_PUBLIC, 'abc'))
      .rejects.toThrow('Trust limit must be a positive numeric string');
  });

  test('rejects limit exceeding Stellar maximum', async () => {
    const { secretKey } = await addWallet(mock);
    await expect(mock.addTrustline(secretKey, 'USDC', ISSUER_PUBLIC, '999999999999'))
      .rejects.toThrow(`Trust limit cannot exceed Stellar maximum of ${STELLAR_MAX_LIMIT}`);
  });

  test('accepts limit equal to Stellar maximum', async () => {
    const { secretKey } = await addWallet(mock);
    const result = await mock.addTrustline(secretKey, 'USDC', ISSUER_PUBLIC, STELLAR_MAX_LIMIT);
    expect(result.limit).toBe(STELLAR_MAX_LIMIT);
  });

  test('rejects invalid asset code (too long)', async () => {
    const { secretKey } = await addWallet(mock);
    await expect(mock.addTrustline(secretKey, 'TOOLONGASSETCODE', ISSUER_PUBLIC, '100'))
      .rejects.toThrow('Asset code must be 1-12 alphanumeric characters');
  });

  test('rejects empty asset code', async () => {
    const { secretKey } = await addWallet(mock);
    await expect(mock.addTrustline(secretKey, '', ISSUER_PUBLIC, '100'))
      .rejects.toThrow('Asset code must be 1-12 alphanumeric characters');
  });

  test('rejects unregistered secret key', async () => {
    // Valid Stellar secret key format but not in mock wallets
    const unregistered = 'SBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
    await expect(mock.addTrustline(unregistered, 'USDC', ISSUER_PUBLIC, '100'))
      .rejects.toThrow();
  });

  test('stores separate trustlines per asset', async () => {
    const { secretKey, publicKey } = await addWallet(mock);

    await mock.addTrustline(secretKey, 'USDC', ISSUER_PUBLIC, '1000');
    await mock.addTrustline(secretKey, 'EURT', ISSUER_PUBLIC, '500');

    expect(mock.getTrustline(publicKey, 'USDC', ISSUER_PUBLIC).limit).toBe('1000');
    expect(mock.getTrustline(publicKey, 'EURT', ISSUER_PUBLIC).limit).toBe('500');
  });

  test('getTrustline returns undefined for unknown trustline', () => {
    expect(mock.getTrustline('GUNKNOWN', 'USDC', ISSUER_PUBLIC)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateTrustLimit helper (isolated unit tests)
// ─────────────────────────────────────────────────────────────────────────────
describe('validateTrustLimit helper', () => {
  const STELLAR_MAX = '922337203685.4775807';

  function validateTrustLimit(limit) {
    const num = parseFloat(limit);
    if (isNaN(num) || num <= 0) return 'limit must be a positive numeric string';
    if (num > parseFloat(STELLAR_MAX)) {
      return `limit cannot exceed Stellar maximum of ${STELLAR_MAX}`;
    }
    return null;
  }

  test('returns null for valid positive limit', () => {
    expect(validateTrustLimit('100')).toBeNull();
    expect(validateTrustLimit('0.0000001')).toBeNull();
    expect(validateTrustLimit(STELLAR_MAX)).toBeNull();
  });

  test('returns error for zero', () => {
    expect(validateTrustLimit('0')).not.toBeNull();
  });

  test('returns error for negative', () => {
    expect(validateTrustLimit('-5')).not.toBeNull();
  });

  test('returns error for non-numeric', () => {
    expect(validateTrustLimit('abc')).not.toBeNull();
  });

  test('returns error for value exceeding max', () => {
    expect(validateTrustLimit('999999999999')).toMatch(/cannot exceed/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /wallets/:id/trustlines — handler logic
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /wallets/:id/trustlines — handler logic', () => {
  const STELLAR_MAX = '922337203685.4775807';

  function validateTrustLimit(limit) {
    const num = parseFloat(limit);
    if (isNaN(num) || num <= 0) return 'limit must be a positive numeric string';
    if (num > parseFloat(STELLAR_MAX)) return `limit cannot exceed Stellar maximum of ${STELLAR_MAX}`;
    return null;
  }

  async function handler(req, res, next, stellarSvc) {
    try {
      const { secretKey, assetCode, issuerPublic, limit } = req.body;
      if (limit !== null && limit !== undefined) {
        const err = validateTrustLimit(limit);
        if (err) return res.status(400).json({ success: false, error: { code: 'INVALID_LIMIT', message: err } });
      }
      const result = await stellarSvc.addTrustline(secretKey, assetCode, issuerPublic, limit || null);
      return res.status(201).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }

  function makeRes() {
    return {
      _status: 200, _body: null,
      status(c) { this._status = c; return this; },
      json(b) { this._body = b; return this; },
    };
  }

  let mock;
  beforeEach(() => { mock = new MockStellarService(); });

  // Test Case 1: Successful trustline creation with a custom limit
  test('201 with custom limit', async () => {
    const { secretKey } = await addWallet(mock);
    const req = { body: { secretKey, assetCode: 'USDC', issuerPublic: ISSUER_PUBLIC, limit: '500' }, params: { id: '1' }, user: { id: 'u1' }, id: 'r1', ip: '127.0.0.1' };
    const res = makeRes();
    const next = jest.fn();
    await handler(req, res, next, mock);
    expect(res._status).toBe(201);
    expect(res._body.success).toBe(true);
    expect(res._body.data.limit).toBe('500');
  });

  // Test Case 4: No limit defaults to max
  test('201 with no limit — defaults to max', async () => {
    const { secretKey } = await addWallet(mock);
    const req = { body: { secretKey, assetCode: 'USDC', issuerPublic: ISSUER_PUBLIC }, params: { id: '1' }, user: { id: 'u1' }, id: 'r1', ip: '127.0.0.1' };
    const res = makeRes();
    await handler(req, res, jest.fn(), mock);
    expect(res._status).toBe(201);
    expect(res._body.data.limit).toBe(STELLAR_MAX_LIMIT);
  });

  // Test Case 3: Error — negative limit
  test('400 for negative limit', async () => {
    const { secretKey } = await addWallet(mock);
    const req = { body: { secretKey, assetCode: 'USDC', issuerPublic: ISSUER_PUBLIC, limit: '-1' }, params: { id: '1' }, user: { id: 'u1' }, id: 'r1', ip: '127.0.0.1' };
    const res = makeRes();
    await handler(req, res, jest.fn(), mock);
    expect(res._status).toBe(400);
    expect(res._body.error.code).toBe('INVALID_LIMIT');
  });

  test('400 for limit exceeding max', async () => {
    const { secretKey } = await addWallet(mock);
    const req = { body: { secretKey, assetCode: 'USDC', issuerPublic: ISSUER_PUBLIC, limit: '999999999999' }, params: { id: '1' }, user: { id: 'u1' }, id: 'r1', ip: '127.0.0.1' };
    const res = makeRes();
    await handler(req, res, jest.fn(), mock);
    expect(res._status).toBe(400);
  });

  test('calls next on stellar error', async () => {
    const req = { body: { secretKey: 'SBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', assetCode: 'USDC', issuerPublic: ISSUER_PUBLIC, limit: '100' }, params: { id: '1' }, user: { id: 'u1' }, id: 'r1', ip: '127.0.0.1' };
    const res = makeRes();
    const next = jest.fn();
    await handler(req, res, next, mock);
    expect(next).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /wallets/:id/trustlines/:asset — handler logic
// ─────────────────────────────────────────────────────────────────────────────
describe('PATCH /wallets/:id/trustlines/:asset — handler logic', () => {
  const STELLAR_MAX = '922337203685.4775807';

  function validateTrustLimit(limit) {
    const num = parseFloat(limit);
    if (isNaN(num) || num <= 0) return 'limit must be a positive numeric string';
    if (num > parseFloat(STELLAR_MAX)) return `limit cannot exceed Stellar maximum of ${STELLAR_MAX}`;
    return null;
  }

  async function handler(req, res, next, stellarSvc) {
    try {
      const { asset } = req.params;
      const { secretKey, issuerPublic, limit } = req.body;
      const err = validateTrustLimit(limit);
      if (err) return res.status(400).json({ success: false, error: { code: 'INVALID_LIMIT', message: err } });
      const result = await stellarSvc.addTrustline(secretKey, asset, issuerPublic, limit);
      return res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }

  function makeRes() {
    return {
      _status: 200, _body: null,
      status(c) { this._status = c; return this; },
      json(b) { this._body = b; return this; },
    };
  }

  let mock;
  beforeEach(() => { mock = new MockStellarService(); });

  // Test Case 2: Successful limit update via PATCH
  test('200 with updated limit', async () => {
    const { secretKey, publicKey } = await addWallet(mock);

    // First create the trustline
    await mock.addTrustline(secretKey, 'USDC', ISSUER_PUBLIC, '500');

    // Then update via PATCH handler
    const req = { body: { secretKey, issuerPublic: ISSUER_PUBLIC, limit: '2000' }, params: { id: '1', asset: 'USDC' }, user: { id: 'u1' }, id: 'r1', ip: '127.0.0.1' };
    const res = makeRes();
    await handler(req, res, jest.fn(), mock);

    expect(res._status).toBe(200);
    expect(res._body.success).toBe(true);
    expect(res._body.data.limit).toBe('2000');

    // Verify stored state changed
    const stored = mock.getTrustline(publicKey, 'USDC', ISSUER_PUBLIC);
    expect(stored.limit).toBe('2000');
  });

  test('400 for undefined limit', async () => {
    const { secretKey } = await addWallet(mock);
    const req = { body: { secretKey, issuerPublic: ISSUER_PUBLIC, limit: undefined }, params: { id: '1', asset: 'USDC' }, user: { id: 'u1' }, id: 'r1', ip: '127.0.0.1' };
    const res = makeRes();
    await handler(req, res, jest.fn(), mock);
    expect(res._status).toBe(400);
  });

  test('400 for negative limit', async () => {
    const { secretKey } = await addWallet(mock);
    const req = { body: { secretKey, issuerPublic: ISSUER_PUBLIC, limit: '-10' }, params: { id: '1', asset: 'USDC' }, user: { id: 'u1' }, id: 'r1', ip: '127.0.0.1' };
    const res = makeRes();
    await handler(req, res, jest.fn(), mock);
    expect(res._status).toBe(400);
  });

  test('400 for limit exceeding max', async () => {
    const { secretKey } = await addWallet(mock);
    const req = { body: { secretKey, issuerPublic: ISSUER_PUBLIC, limit: '999999999999' }, params: { id: '1', asset: 'USDC' }, user: { id: 'u1' }, id: 'r1', ip: '127.0.0.1' };
    const res = makeRes();
    await handler(req, res, jest.fn(), mock);
    expect(res._status).toBe(400);
  });

  test('calls next on stellar error', async () => {
    const req = { body: { secretKey: 'SBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', issuerPublic: ISSUER_PUBLIC, limit: '100' }, params: { id: '1', asset: 'USDC' }, user: { id: 'u1' }, id: 'r1', ip: '127.0.0.1' };
    const res = makeRes();
    const next = jest.fn();
    await handler(req, res, next, mock);
    expect(next).toHaveBeenCalled();
  });
});
