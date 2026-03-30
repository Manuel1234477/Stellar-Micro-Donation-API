'use strict';

/**
 * tests/nonce-replay.test.js
 *
 * Tests for nonce-based request replay protection (issue #400).
 * Covers:
 *  - Replayed nonce rejected with 409
 *  - New nonce accepted
 *  - Nonces expire after the signing window
 *  - Store size is bounded (eviction)
 *  - Metrics track hit rate correctly
 *  - Missing X-Nonce on signed requests returns 401
 */

const { NonceStore } = require('../src/utils/nonceStore');

// ---------------------------------------------------------------------------
// Helper: build a store with a custom window for time-travel tests
// ---------------------------------------------------------------------------
function makeStore(windowMs = 5 * 60 * 1000) {
  return new NonceStore({ windowMs });
}

// ---------------------------------------------------------------------------
// Core behaviour
// ---------------------------------------------------------------------------
describe('NonceStore – core behaviour', () => {
  test('accepts a new nonce (seen: false)', () => {
    const store = makeStore();
    expect(store.check('nonce-abc').seen).toBe(false);
  });

  test('rejects a replayed nonce (seen: true)', () => {
    const store = makeStore();
    store.check('nonce-xyz');
    expect(store.check('nonce-xyz').seen).toBe(true);
  });

  test('different nonces are independent', () => {
    const store = makeStore();
    store.check('nonce-1');
    expect(store.check('nonce-2').seen).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Expiry
// ---------------------------------------------------------------------------
describe('NonceStore – nonce expiry', () => {
  test('nonce is treated as unseen after the window has elapsed', () => {
    // Use a very short window so we can fake expiry without real timers.
    const windowMs = 100;
    const store = makeStore(windowMs);

    // Record the nonce with a manually backdated expiry by reaching into internals.
    store.check('expiring-nonce');

    // Manually expire it by setting its expiry to the past.
    store._store.set('expiring-nonce', Date.now() - 1);

    // Should now be treated as unseen (expired).
    expect(store.check('expiring-nonce').seen).toBe(false);
  });

  test('cleanup() removes expired entries and returns count', () => {
    const store = makeStore(300_000);
    store.check('n1');
    store.check('n2');

    // Expire both manually.
    store._store.set('n1', Date.now() - 1);
    store._store.set('n2', Date.now() - 1);

    const { removed } = store.cleanup();
    expect(removed).toBe(2);
    expect(store._store.size).toBe(0);
  });

  test('cleanup() leaves unexpired entries intact', () => {
    const store = makeStore(300_000);
    store.check('keep');
    store.check('expire-me');
    store._store.set('expire-me', Date.now() - 1);

    store.cleanup();
    expect(store._store.has('keep')).toBe(true);
    expect(store._store.has('expire-me')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Bounded store size
// ---------------------------------------------------------------------------
describe('NonceStore – bounded size', () => {
  test('store never exceeds maxSize', () => {
    const maxSize = 5;
    const store = new NonceStore({ maxSize });

    for (let i = 0; i < maxSize + 3; i++) {
      store.check(`nonce-${i}`);
    }

    expect(store._store.size).toBeLessThanOrEqual(maxSize);
  });

  test('oldest entry is evicted when store is full', () => {
    const maxSize = 3;
    const store = new NonceStore({ maxSize });

    store.check('first');
    store.check('second');
    store.check('third');
    // Store is now full; inserting 'fourth' should evict 'first'.
    store.check('fourth');

    expect(store._store.has('first')).toBe(false);
    expect(store._store.has('fourth')).toBe(true);
    expect(store._store.size).toBe(maxSize);
  });

  test('eviction counter increments', () => {
    const store = new NonceStore({ maxSize: 2 });
    store.check('a');
    store.check('b');
    store.check('c'); // triggers eviction

    expect(store.getMetrics().evictions).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------
describe('NonceStore – metrics', () => {
  test('initial metrics are zeroed', () => {
    const store = makeStore();
    const m = store.getMetrics();
    expect(m.hits).toBe(0);
    expect(m.misses).toBe(0);
    expect(m.hitRate).toBe(0);
    expect(m.size).toBe(0);
  });

  test('misses increment on new nonces', () => {
    const store = makeStore();
    store.check('n1');
    store.check('n2');
    expect(store.getMetrics().misses).toBe(2);
  });

  test('hits increment on replayed nonces', () => {
    const store = makeStore();
    store.check('dup');
    store.check('dup');
    store.check('dup');
    expect(store.getMetrics().hits).toBe(2);
  });

  test('hitRate is computed correctly', () => {
    const store = makeStore();
    store.check('unique');   // miss
    store.check('unique');   // hit
    // 1 hit / 2 total = 0.5
    expect(store.getMetrics().hitRate).toBeCloseTo(0.5);
  });

  test('size reflects current store entries', () => {
    const store = makeStore();
    store.check('x');
    store.check('y');
    expect(store.getMetrics().size).toBe(2);
  });

  test('maxSize is reported in metrics', () => {
    const store = new NonceStore({ maxSize: 42 });
    expect(store.getMetrics().maxSize).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// Cleanup timer lifecycle
// ---------------------------------------------------------------------------
describe('NonceStore – cleanup timer', () => {
  test('startCleanup / stopCleanup do not throw', () => {
    const store = makeStore();
    expect(() => store.startCleanup()).not.toThrow();
    expect(() => store.stopCleanup()).not.toThrow();
  });

  test('calling startCleanup twice does not create two timers', () => {
    const store = makeStore();
    store.startCleanup();
    const timer1 = store._cleanupTimer;
    store.startCleanup();
    expect(store._cleanupTimer).toBe(timer1);
    store.stopCleanup();
  });

  test('stopCleanup clears the timer reference', () => {
    const store = makeStore();
    store.startCleanup();
    store.stopCleanup();
    expect(store._cleanupTimer).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Middleware integration: X-Nonce enforcement in apiKey middleware
// ---------------------------------------------------------------------------
describe('apiKey middleware – nonce enforcement', () => {
  let requireApiKey;
  let mockValidateKey;
  let mockNonceStore;

  beforeEach(() => {
    jest.resetModules();

    // Stub validateKey to return a key that requires signing.
    mockValidateKey = jest.fn().mockResolvedValue({
      id: 1,
      role: 'user',
      signingRequired: true,
      keySecret: 'test-secret',
      keyPrefix: 'test1234',
    });

    // Stub the nonce store so we control seen/unseen.
    mockNonceStore = { check: jest.fn().mockReturnValue({ seen: false }) };

    jest.mock('../src/models/apiKeys', () => ({ validateKey: mockValidateKey }));
    jest.mock('../src/utils/nonceStore', () => ({ defaultStore: mockNonceStore }));
    jest.mock('../src/config/securityConfig', () => ({ securityConfig: { API_KEYS: [] } }));
    jest.mock('../src/services/AuditLogService', () => ({ log: jest.fn().mockResolvedValue(undefined), CATEGORY: {}, ACTION: {}, SEVERITY: {} }));
    jest.mock('../src/utils/log', () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn() }));

    // Stub requestSigner to always return valid so we isolate nonce logic.
    jest.mock('../src/utils/requestSigner', () => ({
      verify: jest.fn().mockReturnValue({ valid: true }),
      SIGNATURE_MAX_AGE_MS: 300_000,
    }));

    requireApiKey = require('../src/middleware/apiKey');
  });

  afterEach(() => jest.resetModules());

  function makeReq(overrides = {}) {
    return {
      apiKey: null,
      id: 'req-1',
      ip: '127.0.0.1',
      method: 'POST',
      path: '/donations',
      originalUrl: '/donations',
      url: '/donations',
      rawBody: '{}',
      get: jest.fn((header) => {
        const headers = {
          'x-api-key': 'valid-key',
          'x-timestamp': String(Math.floor(Date.now() / 1000)),
          'x-signature': 'abc123',
          'x-nonce': 'unique-nonce-001',
          ...overrides.headers,
        };
        return headers[header.toLowerCase()] ?? null;
      }),
      ...overrides,
    };
  }

  function makeRes() {
    const res = { headers: {} };
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    res.setHeader = jest.fn((k, v) => { res.headers[k] = v; });
    return res;
  }

  test('accepts request with valid new nonce', async () => {
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();

    await requireApiKey(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(409);
  });

  test('rejects replayed nonce with 409', async () => {
    mockNonceStore.check.mockReturnValue({ seen: true });

    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();

    await requireApiKey(req, res, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'NONCE_REPLAYED' }),
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects missing X-Nonce with 401', async () => {
    const req = makeReq({ headers: { 'x-nonce': undefined } });
    // Override get to return null for x-nonce
    req.get = jest.fn((header) => {
      if (header.toLowerCase() === 'x-nonce') return null;
      const map = {
        'x-api-key': 'valid-key',
        'x-timestamp': String(Math.floor(Date.now() / 1000)),
        'x-signature': 'abc123',
      };
      return map[header.toLowerCase()] ?? null;
    });

    const res = makeRes();
    const next = jest.fn();

    await requireApiKey(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'MISSING_NONCE' }),
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('nonce check is skipped when signing is not required', async () => {
    mockValidateKey.mockResolvedValue({
      id: 2,
      role: 'user',
      signingRequired: false,
      keyPrefix: 'test5678',
    });

    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();

    await requireApiKey(req, res, next);

    expect(mockNonceStore.check).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});
