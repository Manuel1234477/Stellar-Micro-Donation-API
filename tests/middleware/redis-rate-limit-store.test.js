'use strict';

/**
 * Tests for RedisRateLimitStore — issue #1381
 *
 * Uses a fully in-memory mocked Redis client. Does not require a live Redis instance.
 *
 * Covers:
 *   - Normal increment-and-expire: semantics match MemoryRateLimitStore
 *   - Legacy eval() signature fallback (positional args vs. {keys, arguments} object)
 *   - fail-open  behavior when Redis throws
 *   - fail-closed behavior when Redis throws
 *   - close() delegates to client.quit()
 */

const { RedisRateLimitStore, MemoryRateLimitStore } = require('../../src/services/rateLimitStores');

// ── Shared in-memory counter backing for the mock Redis ───────────────────────

function buildMockRedisClient({ alwaysError = false } = {}) {
  const store = new Map(); // key → { count, expireAt }

  const evalImpl = async (lua, ...args) => {
    if (alwaysError) throw new Error('Redis connection refused');

    // Resolve (key, windowSeconds) regardless of whether the positional or
    // object-style signature is used:
    //   Positional (legacy):  eval(lua, numKeys, key, windowSeconds)
    //   Object  (new):        eval(lua, { keys: [key], arguments: [windowSeconds] })
    let key, windowSeconds;

    const secondArg = args[0];
    if (typeof secondArg === 'object' && secondArg !== null && 'keys' in secondArg) {
      // New signature: { keys: [key], arguments: [windowSeconds] }
      key = secondArg.keys[0];
      windowSeconds = parseInt(secondArg.arguments[0], 10);
    } else {
      // Legacy positional: (numKeys, key, windowSeconds)
      // args = [numKeys, key, windowSecondsStr]
      key = args[1];
      windowSeconds = parseInt(args[2], 10);
    }

    const now = Date.now();
    let entry = store.get(key);

    if (!entry || now > entry.expireAt) {
      entry = { count: 0, expireAt: now + windowSeconds * 1000 };
    }

    entry.count += 1;
    store.set(key, entry);

    const ttlMs = Math.max(0, entry.expireAt - now);
    return [entry.count, ttlMs];
  };

  return {
    eval: jest.fn(evalImpl),
    quit: jest.fn(),
    _store: store, // expose for assertions
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Normal increment-and-expire semantics
// ─────────────────────────────────────────────────────────────────────────────

describe('RedisRateLimitStore — normal increment-and-expire', () => {
  let redisClient;
  let store;

  beforeEach(() => {
    redisClient = buildMockRedisClient();
    store = new RedisRateLimitStore(redisClient);
  });

  it('allows the first request and returns count = 1', async () => {
    const result = await store.incrementAndCheck('key1', 5, 60);
    expect(result.allowed).toBe(true);
    expect(result.count).toBe(1);
    expect(result.remaining).toBe(4);
  });

  it('increments on successive requests for the same key', async () => {
    for (let i = 1; i <= 4; i++) {
      const result = await store.incrementAndCheck('key2', 5, 60);
      expect(result.count).toBe(i);
      expect(result.remaining).toBe(5 - i);
    }
  });

  it('blocks when the count reaches the limit', async () => {
    for (let i = 0; i < 3; i++) {
      await store.incrementAndCheck('key3', 3, 60);
    }
    const result = await store.incrementAndCheck('key3', 3, 60);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.count).toBe(4);
  });

  it('tracks different keys independently', async () => {
    await store.incrementAndCheck('keyA', 2, 60);
    await store.incrementAndCheck('keyA', 2, 60);
    const blockedA = await store.incrementAndCheck('keyA', 2, 60);
    const allowedB = await store.incrementAndCheck('keyB', 2, 60);

    expect(blockedA.allowed).toBe(false);
    expect(allowedB.allowed).toBe(true);
  });

  it('returns a resetAt timestamp in the future', async () => {
    const before = Date.now();
    const result = await store.incrementAndCheck('key5', 10, 60);
    expect(result.resetAt).toBeGreaterThan(before);
  });

  it('remaining is never negative', async () => {
    for (let i = 0; i < 10; i++) {
      await store.incrementAndCheck('key6', 3, 60);
    }
    const result = await store.incrementAndCheck('key6', 3, 60);
    expect(result.remaining).toBe(0);
  });

  it('matches MemoryRateLimitStore semantics for allow/block decisions', async () => {
    const memStore = new MemoryRateLimitStore();
    const limit = 5;
    const windowSeconds = 60;
    const key = 'parity-key';

    for (let i = 0; i < 7; i++) {
      const redisResult = await store.incrementAndCheck(key, limit, windowSeconds);
      const memResult = memStore.incrementAndCheck(key, limit, windowSeconds);
      expect(redisResult.allowed).toBe(memResult.allowed);
    }
  });

  it('calls client.eval() on each request', async () => {
    await store.incrementAndCheck('key7', 10, 30);
    await store.incrementAndCheck('key7', 10, 30);
    expect(redisClient.eval).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Legacy eval() positional-argument signature fallback
// ─────────────────────────────────────────────────────────────────────────────

describe('RedisRateLimitStore — legacy eval() signature fallback', () => {
  it('retries with positional args when object-style eval() throws', async () => {
    // Simulate a Redis client that rejects the new object-style signature on the
    // first call but succeeds with the legacy positional signature on the retry.
    const legacyClient = {
      eval: jest.fn()
        .mockRejectedValueOnce(new Error('wrong number of arguments'))
        .mockResolvedValueOnce([1, 59000]),
      quit: jest.fn(),
    };

    const store = new RedisRateLimitStore(legacyClient, { failOpen: true });
    const result = await store.incrementAndCheck('legacy-key', 5, 60);

    // Should have been called twice (first attempt fails, second succeeds)
    expect(legacyClient.eval).toHaveBeenCalledTimes(2);
    // The result came from the successful second call
    expect(result.count).toBe(1);
    expect(result.allowed).toBe(true);
  });

  it('handles a client that only supports the legacy positional eval() signature', async () => {
    // Some older ioredis versions only support (lua, numKeys, ...keys, ...args)
    // The store first tries the new style → throws → falls back to positional
    const legacyClient = {
      eval: jest.fn()
        .mockImplementationOnce(() => { throw new Error('Unknown option'); }) // new style fails
        .mockImplementation(async (_lua, _numKeys, key, windowStr) => {
          // Legacy positional handler
          return [1, parseInt(windowStr, 10) * 1000];
        }),
      quit: jest.fn(),
    };

    const store = new RedisRateLimitStore(legacyClient, { failOpen: true });
    const result = await store.incrementAndCheck('legacy2', 5, 60);

    expect(result.allowed).toBe(true);
    expect(result.count).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Fail-open behavior (Redis unavailable)
// ─────────────────────────────────────────────────────────────────────────────

describe('RedisRateLimitStore — fail-open configuration', () => {
  let errorClient;

  beforeEach(() => {
    errorClient = buildMockRedisClient({ alwaysError: true });
  });

  it('allows the request when Redis throws and failOpen = true', async () => {
    const store = new RedisRateLimitStore(errorClient, { failOpen: true });
    const result = await store.incrementAndCheck('fo-key', 5, 60);

    expect(result.allowed).toBe(true);
  });

  it('returns remaining = limit when failing open', async () => {
    const limit = 10;
    const store = new RedisRateLimitStore(errorClient, { failOpen: true });
    const result = await store.incrementAndCheck('fo-key2', limit, 60);

    expect(result.remaining).toBe(limit);
  });

  it('returns count = 0 when failing open', async () => {
    const store = new RedisRateLimitStore(errorClient, { failOpen: true });
    const result = await store.incrementAndCheck('fo-key3', 5, 60);

    expect(result.count).toBe(0);
  });

  it('defaults to fail-open when RATE_LIMIT_FAIL_OPEN env var is not set', async () => {
    const saved = process.env.RATE_LIMIT_FAIL_OPEN;
    delete process.env.RATE_LIMIT_FAIL_OPEN;

    const store = new RedisRateLimitStore(errorClient); // no options
    const result = await store.incrementAndCheck('fo-default', 5, 60);

    expect(result.allowed).toBe(true);

    if (saved !== undefined) process.env.RATE_LIMIT_FAIL_OPEN = saved;
  });

  it('defaults to fail-closed when RATE_LIMIT_FAIL_OPEN=false', async () => {
    const saved = process.env.RATE_LIMIT_FAIL_OPEN;
    process.env.RATE_LIMIT_FAIL_OPEN = 'false';

    const store = new RedisRateLimitStore(errorClient); // reads env var
    const result = await store.incrementAndCheck('fo-env', 5, 60);

    expect(result.allowed).toBe(false);

    process.env.RATE_LIMIT_FAIL_OPEN = saved || '';
    if (saved === undefined) delete process.env.RATE_LIMIT_FAIL_OPEN;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Fail-closed behavior (Redis unavailable)
// ─────────────────────────────────────────────────────────────────────────────

describe('RedisRateLimitStore — fail-closed configuration', () => {
  let errorClient;

  beforeEach(() => {
    errorClient = buildMockRedisClient({ alwaysError: true });
  });

  it('blocks the request when Redis throws and failOpen = false', async () => {
    const store = new RedisRateLimitStore(errorClient, { failOpen: false });
    const result = await store.incrementAndCheck('fc-key', 5, 60);

    expect(result.allowed).toBe(false);
  });

  it('returns remaining = 0 when failing closed', async () => {
    const store = new RedisRateLimitStore(errorClient, { failOpen: false });
    const result = await store.incrementAndCheck('fc-key2', 5, 60);

    expect(result.remaining).toBe(0);
  });

  it('returns count = limit when failing closed', async () => {
    const limit = 5;
    const store = new RedisRateLimitStore(errorClient, { failOpen: false });
    const result = await store.incrementAndCheck('fc-key3', limit, 60);

    expect(result.count).toBe(limit);
  });

  it('returns a resetAt in the future even when failing closed', async () => {
    const before = Date.now();
    const store = new RedisRateLimitStore(errorClient, { failOpen: false });
    const result = await store.incrementAndCheck('fc-key4', 5, 60);

    expect(result.resetAt).toBeGreaterThan(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. close()
// ─────────────────────────────────────────────────────────────────────────────

describe('RedisRateLimitStore — close()', () => {
  it('calls quit() on the Redis client', () => {
    const client = buildMockRedisClient();
    const store = new RedisRateLimitStore(client);
    store.close();
    expect(client.quit).toHaveBeenCalledTimes(1);
  });

  it('does not throw when quit is not defined on the client', () => {
    const clientWithoutQuit = { eval: jest.fn() };
    const store = new RedisRateLimitStore(clientWithoutQuit);
    expect(() => store.close()).not.toThrow();
  });

  it('does not throw when quit throws', () => {
    const client = {
      eval: jest.fn(),
      quit: jest.fn(() => { throw new Error('already closed'); }),
    };
    const store = new RedisRateLimitStore(client);
    expect(() => store.close()).not.toThrow();
  });
});
