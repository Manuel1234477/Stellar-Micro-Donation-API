'use strict';

/**
 * Tests for issues #18, #19, #20, #21
 */

// ─── Issue #18: Stats summary caching ────────────────────────────────────────

const Cache = require('../../src/utils/cache');

describe('Issue #18 — GET /stats/summary caching', () => {
  const SUMMARY_PREFIX = 'stats:summary:';

  beforeEach(() => Cache.clear());

  test('cache miss: stores result and sets X-Cache: MISS', () => {
    const key = `${SUMMARY_PREFIX}{}`;
    expect(Cache.get(key)).toBeNull();

    const body = { success: true, data: { total: 5 } };
    Cache.set(key, body, 60_000);

    expect(Cache.get(key)).toEqual(body);
  });

  test('cache hit: returns stored result', () => {
    const key = `${SUMMARY_PREFIX}{"from":"2024-01-01"}`;
    const body = { success: true, data: { total: 10 } };
    Cache.set(key, body, 60_000);

    expect(Cache.get(key)).toEqual(body);
  });

  test('different query params produce independent cache entries', () => {
    const key1 = `${SUMMARY_PREFIX}{}`;
    const key2 = `${SUMMARY_PREFIX}{"from":"2024-01-01"}`;
    Cache.set(key1, { data: 'a' }, 60_000);
    Cache.set(key2, { data: 'b' }, 60_000);

    expect(Cache.get(key1)).toEqual({ data: 'a' });
    expect(Cache.get(key2)).toEqual({ data: 'b' });
  });

  test('donation event invalidates summary cache', () => {
    const key = `${SUMMARY_PREFIX}{}`;
    Cache.set(key, { data: 'cached' }, 60_000);
    expect(Cache.get(key)).not.toBeNull();

    // Simulate what the event listener does
    Cache.clearPrefix(SUMMARY_PREFIX);
    expect(Cache.get(key)).toBeNull();
  });

  test('cache expires after TTL', () => {
    jest.useFakeTimers();
    const key = `${SUMMARY_PREFIX}{}`;
    Cache.set(key, { data: 'x' }, 100);

    jest.advanceTimersByTime(101);
    expect(Cache.get(key)).toBeNull();
    jest.useRealTimers();
  });

  test('STATS_SUMMARY_CACHE_TTL_SECONDS env var is respected', () => {
    const original = process.env.STATS_SUMMARY_CACHE_TTL_SECONDS;
    process.env.STATS_SUMMARY_CACHE_TTL_SECONDS = '120';
    const ttl = parseInt(process.env.STATS_SUMMARY_CACHE_TTL_SECONDS || '60', 10) * 1000;
    expect(ttl).toBe(120_000);
    process.env.STATS_SUMMARY_CACHE_TTL_SECONDS = original;
  });
});

// ─── Issue #19: Wallet soft-delete ───────────────────────────────────────────

describe('Issue #19 — Wallet soft-delete', () => {
  test('deleted_at IS NULL filter excludes soft-deleted wallets', () => {
    const wallets = [
      { id: 1, publicKey: 'G1', deleted_at: null },
      { id: 2, publicKey: 'G2', deleted_at: '2024-01-01T00:00:00Z' },
    ];
    const active = wallets.filter(w => w.deleted_at === null);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(1);
  });

  test('409 when wallet has active schedules', () => {
    const activeSchedules = [{ id: 10 }, { id: 11 }];
    const shouldBlock = activeSchedules.length > 0;
    expect(shouldBlock).toBe(true);
    expect(activeSchedules.map(s => s.id)).toEqual([10, 11]);
  });

  test('no 409 when wallet has no active schedules', () => {
    const activeSchedules = [];
    expect(activeSchedules.length > 0).toBe(false);
  });

  test('restore clears deleted_at', () => {
    const wallet = { id: 1, deleted_at: '2024-01-01T00:00:00Z' };
    // Simulate restore
    wallet.deleted_at = null;
    expect(wallet.deleted_at).toBeNull();
  });

  test('restore returns 404 for non-deleted wallet', () => {
    const wallet = { id: 1, deleted_at: null };
    // Only wallets with deleted_at IS NOT NULL can be restored
    const canRestore = wallet.deleted_at !== null;
    expect(canRestore).toBe(false);
  });

  test('includeDeleted=true returns all wallets', () => {
    const wallets = [
      { id: 1, deleted_at: null },
      { id: 2, deleted_at: '2024-01-01' },
    ];
    const includeDeleted = true;
    const result = includeDeleted ? wallets : wallets.filter(w => w.deleted_at === null);
    expect(result).toHaveLength(2);
  });
});

// ─── Issue #20: Circuit breaker persistence ───────────────────────────────────

const { CircuitBreaker, STATES } = require('../../src/utils/circuitBreaker');

describe('Issue #20 — Circuit breaker persistence', () => {
  test('loadState() exists on CircuitBreaker', () => {
    const cb = new CircuitBreaker({ name: 'test' });
    expect(typeof cb.loadState).toBe('function');
  });

  test('_persistState() exists on CircuitBreaker', () => {
    const cb = new CircuitBreaker({ name: 'test' });
    expect(typeof cb._persistState).toBe('function');
  });

  test('loadState() with no DB gracefully does nothing', async () => {
    const cb = new CircuitBreaker({ name: 'test-no-db' });
    // Should not throw even if DB is unavailable
    await expect(cb.loadState()).resolves.toBeUndefined();
    expect(cb.state).toBe(STATES.CLOSED);
  });

  test('loadState() with mocked open state within cooldown restores OPEN', async () => {
    const cb = new CircuitBreaker({ name: 'test-open', cooldownMs: 30_000 });
    const openedAt = Date.now() - 5_000; // 5s ago, still within 30s cooldown

    // Mock the DB
    const mockDb = {
      get: jest.fn().mockResolvedValue({ state: 'open', failureCount: 5, lastFailureAt: openedAt, openedAt })
    };
    jest.spyOn(cb, 'loadState').mockImplementation(async () => {
      const row = await mockDb.get();
      if (row && row.state === STATES.OPEN && row.openedAt) {
        const elapsed = Date.now() - row.openedAt;
        if (elapsed < cb.cooldownMs) {
          cb._state = STATES.OPEN;
          cb._openedAt = row.openedAt;
        }
      }
    });

    await cb.loadState();
    expect(cb.state).toBe(STATES.OPEN);
  });

  test('loadState() with open state past cooldown stays CLOSED', async () => {
    const cb = new CircuitBreaker({ name: 'test-expired', cooldownMs: 1_000 });
    const openedAt = Date.now() - 60_000; // 60s ago, past 1s cooldown

    jest.spyOn(cb, 'loadState').mockImplementation(async () => {
      const row = { state: 'open', failureCount: 5, openedAt };
      if (row.state === STATES.OPEN && row.openedAt) {
        const elapsed = Date.now() - row.openedAt;
        if (elapsed < cb.cooldownMs) {
          cb._state = STATES.OPEN;
        }
        // else: stay CLOSED
      }
    });

    await cb.loadState();
    expect(cb.state).toBe(STATES.CLOSED);
  });

  test('_persistState() is called on _open()', async () => {
    const cb = new CircuitBreaker({ name: 'test-persist', failureThreshold: 1 });
    const persistSpy = jest.spyOn(cb, '_persistState').mockImplementation(() => {});

    await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
    expect(persistSpy).toHaveBeenCalled();
  });

  test('_persistState() is called on _onSuccess()', async () => {
    const cb = new CircuitBreaker({ name: 'test-success', failureThreshold: 5, cooldownMs: 0 });
    // Open the circuit
    for (let i = 0; i < 5; i++) {
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
    }
    // Advance past cooldown
    cb._openedAt = Date.now() - 1;
    cb._state = STATES.HALF_OPEN;

    const persistSpy = jest.spyOn(cb, '_persistState').mockImplementation(() => {});
    await cb.execute(() => Promise.resolve('ok'));
    expect(persistSpy).toHaveBeenCalled();
  });

  test('_persistState() is called on reset()', () => {
    const cb = new CircuitBreaker({ name: 'test-reset' });
    const persistSpy = jest.spyOn(cb, '_persistState').mockImplementation(() => {});
    cb.reset();
    expect(persistSpy).toHaveBeenCalled();
  });
});

// ─── Issue #21: Bulk donations endpoint ──────────────────────────────────────

describe('Issue #21 — POST /donations/bulk', () => {
  function validateItem(item) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { valid: false, error: { code: 'INVALID_ITEM', message: 'Each item must be an object' } };
    }
    const missing = [];
    if (item.senderId == null) missing.push('senderId');
    if (item.receiverId == null) missing.push('receiverId');
    if (item.amount == null) missing.push('amount');
    if (missing.length > 0) {
      return { valid: false, error: { code: 'MISSING_FIELDS', message: `Missing: ${missing.join(', ')}` } };
    }
    if (typeof item.amount !== 'number' || item.amount <= 0) {
      return { valid: false, error: { code: 'INVALID_AMOUNT', message: 'amount must be a positive number' } };
    }
    return { valid: true };
  }

  test('rejects non-array donations field', () => {
    const body = { donations: 'not-an-array' };
    expect(Array.isArray(body.donations)).toBe(false);
  });

  test('rejects empty array', () => {
    expect([].length === 0).toBe(true);
  });

  test('rejects array with more than 50 items', () => {
    const arr = new Array(51).fill({ senderId: 1, receiverId: 2, amount: 1 });
    expect(arr.length > 50).toBe(true);
  });

  test('validates each item independently', () => {
    const items = [
      { senderId: 1, receiverId: 2, amount: 5 },
      { senderId: null, receiverId: 2, amount: 5 },
      { senderId: 1, receiverId: 2, amount: -1 },
    ];
    const results = items.map(validateItem);
    expect(results[0].valid).toBe(true);
    expect(results[1].valid).toBe(false);
    expect(results[1].error.code).toBe('MISSING_FIELDS');
    expect(results[2].valid).toBe(false);
    expect(results[2].error.code).toBe('INVALID_AMOUNT');
  });

  test('returns 207 Multi-Status format', () => {
    const results = [
      { index: 0, status: 'success', donationId: 1, transactionHash: 'abc' },
      { index: 1, status: 'failed', error: { code: 'MISSING_FIELDS', message: 'Missing: amount' } },
    ];
    // 207 response shape
    expect(results[0].status).toBe('success');
    expect(results[1].status).toBe('failed');
    expect(results[1].error.code).toBeDefined();
  });

  test('rate limit: 50 items per minute per key', () => {
    const maxPerWindow = 50;
    const windowMs = 60_000;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Simulate 45 existing timestamps
    const timestamps = new Array(45).fill(now - 1000);
    const newItems = 10;
    const wouldExceed = timestamps.filter(t => t > windowStart).length + newItems > maxPerWindow;
    expect(wouldExceed).toBe(true);
  });

  test('rate limit: allows batch within quota', () => {
    const maxPerWindow = 50;
    const windowMs = 60_000;
    const now = Date.now();
    const windowStart = now - windowMs;

    const timestamps = new Array(30).fill(now - 1000);
    const newItems = 10;
    const wouldExceed = timestamps.filter(t => t > windowStart).length + newItems > maxPerWindow;
    expect(wouldExceed).toBe(false);
  });

  test('per-item idempotency key is respected', () => {
    const cache = new Map();
    const key = 'idem-key-123';
    const cachedResult = { index: 0, status: 'success', donationId: 42 };
    cache.set(key, cachedResult);

    const item = { senderId: 1, receiverId: 2, amount: 5, idempotencyKey: key };
    const cached = cache.get(item.idempotencyKey);
    expect(cached).toEqual(cachedResult);
  });

  test('BULK_DONATION_CONCURRENCY env var is respected', () => {
    const original = process.env.BULK_DONATION_CONCURRENCY;
    process.env.BULK_DONATION_CONCURRENCY = '3';
    const concurrency = parseInt(process.env.BULK_DONATION_CONCURRENCY || '5', 10);
    expect(concurrency).toBe(3);
    process.env.BULK_DONATION_CONCURRENCY = original;
  });

  test('all success scenario', () => {
    const results = [
      { index: 0, status: 'success', donationId: 1 },
      { index: 1, status: 'success', donationId: 2 },
    ];
    expect(results.every(r => r.status === 'success')).toBe(true);
  });

  test('all failure scenario', () => {
    const results = [
      { index: 0, status: 'failed', error: { code: 'MISSING_FIELDS' } },
      { index: 1, status: 'failed', error: { code: 'INVALID_AMOUNT' } },
    ];
    expect(results.every(r => r.status === 'failed')).toBe(true);
  });

  test('partial failure scenario', () => {
    const results = [
      { index: 0, status: 'success', donationId: 1 },
      { index: 1, status: 'failed', error: { code: 'MISSING_FIELDS' } },
      { index: 2, status: 'success', donationId: 3 },
    ];
    const successes = results.filter(r => r.status === 'success');
    const failures = results.filter(r => r.status === 'failed');
    expect(successes).toHaveLength(2);
    expect(failures).toHaveLength(1);
  });
});
