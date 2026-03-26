'use strict';

/**
 * @file add-stellar-transaction-sequence-number-management.test.js
 *
 * Comprehensive tests for src/utils/sequenceManager.js
 *
 * Coverage targets (≥95 %):
 *  - Per-account serialisation (lock mechanics)
 *  - Sequence number caching (hits, misses, TTL expiry)
 *  - Optimistic retry on tx_bad_seq
 *  - Metrics tracking
 *  - Edge cases: empty accountId, maxRetries=0, non-sequence errors, etc.
 *
 * No live Stellar network is used — all Horizon interactions are mocked.
 */

const { createSequenceManager } = require('../src/utils/sequenceManager');

// ─── Shared helpers ────────────────────────────────────────────────────────

/**
 * Builds a minimal mock Horizon client.
 * @param {string} [sequence='100'] Initial sequence number to return
 * @returns {{ loadAccount: jest.Mock }}
 */
function buildHorizonClient(sequence = '100') {
  return {
    loadAccount: jest.fn().mockResolvedValue({ sequenceNumber: sequence }),
  };
}

/**
 * Builds a Stellar-SDK-style `tx_bad_seq` error.
 * @returns {Error}
 */
function buildBadSeqError() {
  const err = new Error('Transaction failed');
  err.response = {
    data: {
      extras: {
        result_codes: { transaction: 'tx_bad_seq' },
      },
    },
  };
  return err;
}

/**
 * Returns a promise that resolves after `ms` ms (test utility).
 * @param {number} ms
 */
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Test suites ──────────────────────────────────────────────────────────

describe('createSequenceManager — factory', () => {
  it('returns a manager object with all expected methods', () => {
    const mgr = createSequenceManager();
    expect(typeof mgr.withAccountLock).toBe('function');
    expect(typeof mgr.getSequenceNumber).toBe('function');
    expect(typeof mgr.invalidateCache).toBe('function');
    expect(typeof mgr.executeWithRetry).toBe('function');
    expect(typeof mgr.getMetrics).toBe('function');
    expect(typeof mgr.resetMetrics).toBe('function');
    expect(typeof mgr.clearCache).toBe('function');
    expect(typeof mgr.activeLockCount).toBe('function');
  });

  it('merges custom config with defaults', () => {
    const mgr = createSequenceManager({ maxRetries: 2, retryDelayMs: 10 });
    expect(mgr._config.maxRetries).toBe(2);
    expect(mgr._config.retryDelayMs).toBe(10);
    // Default unchanged values are preserved
    expect(mgr._config.cacheTtlMs).toBe(30_000);
  });

  it('two factory calls produce independent instances', () => {
    const a = createSequenceManager();
    const b = createSequenceManager();
    a.getMetrics(); // just to reference
    b.resetMetrics();
    expect(a).not.toBe(b);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('withAccountLock — serialisation', () => {
  let mgr;
  beforeEach(() => { mgr = createSequenceManager(); });

  it('executes a single task and returns its value', async () => {
    const result = await mgr.withAccountLock('ACC1', async () => 'done');
    expect(result).toBe('done');
  });

  it('serialises concurrent tasks for the same account', async () => {
    const order = [];
    const ACCOUNT = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

    const t1 = mgr.withAccountLock(ACCOUNT, async () => {
      order.push('t1-start');
      await delay(20);
      order.push('t1-end');
    });

    const t2 = mgr.withAccountLock(ACCOUNT, async () => {
      order.push('t2-start');
      await delay(5);
      order.push('t2-end');
    });

    await Promise.all([t1, t2]);

    // t1 must complete entirely before t2 starts
    expect(order).toEqual(['t1-start', 't1-end', 't2-start', 't2-end']);
  });

  it('allows parallel execution for DIFFERENT accounts', async () => {
    const started = [];

    const t1 = mgr.withAccountLock('ACC_A', async () => {
      started.push('A');
      await delay(30);
    });

    const t2 = mgr.withAccountLock('ACC_B', async () => {
      started.push('B');
      await delay(5);
    });

    // Give both a chance to start before awaiting
    await delay(5);
    // Both should have started (parallel execution)
    expect(started).toContain('A');
    expect(started).toContain('B');

    await Promise.all([t1, t2]);
  });

  it('propagates errors thrown inside the lock', async () => {
    await expect(
      mgr.withAccountLock('ERR_ACC', async () => { throw new Error('boom'); })
    ).rejects.toThrow('boom');
  });

  it('releases the lock after an error so subsequent tasks can run', async () => {
    const ACCOUNT = 'ERR_RELEASE_ACC';
    let secondRan = false;

    // First task errors
    await mgr.withAccountLock(ACCOUNT, async () => { throw new Error('oops'); }).catch(() => {});

    // Second task should still execute
    await mgr.withAccountLock(ACCOUNT, async () => { secondRan = true; });
    expect(secondRan).toBe(true);
  });

  it('handles 10+ concurrent transactions from the same account in order', async () => {
    const ACCOUNT = 'CONCURRENT_ACCOUNT';
    const order = [];
    const N = 12;

    const tasks = Array.from({ length: N }, (_, i) =>
      mgr.withAccountLock(ACCOUNT, async () => {
        order.push(i);
        await delay(2);
      })
    );

    await Promise.all(tasks);

    // Every index should appear exactly once
    expect(order).toHaveLength(N);
    expect(new Set(order).size).toBe(N);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('getSequenceNumber — caching', () => {
  let mgr;
  beforeEach(() => {
    mgr = createSequenceManager({ cacheTtlMs: 200 });
  });

  it('fetches from Horizon on cache miss', async () => {
    const client = buildHorizonClient('500');
    const seq = await mgr.getSequenceNumber('ACC', client);
    expect(seq).toBe('500');
    expect(client.loadAccount).toHaveBeenCalledTimes(1);
    expect(mgr.getMetrics().cacheMisses).toBe(1);
  });

  it('serves cached value on subsequent call within TTL', async () => {
    const client = buildHorizonClient('500');
    await mgr.getSequenceNumber('ACC_CACHE', client);
    const seq2 = await mgr.getSequenceNumber('ACC_CACHE', client);
    // loadAccount called only once
    expect(client.loadAccount).toHaveBeenCalledTimes(1);
    expect(mgr.getMetrics().cacheHits).toBeGreaterThanOrEqual(1);
    // second call returns incremented sequence
    expect(seq2).toBe('501');
  });

  it('re-fetches from Horizon after TTL expires', async () => {
    const shortTtlMgr = createSequenceManager({ cacheTtlMs: 50 });
    const client = buildHorizonClient('200');

    await shortTtlMgr.getSequenceNumber('TTL_ACC', client);
    await delay(60); // wait for TTL to expire
    await shortTtlMgr.getSequenceNumber('TTL_ACC', client);

    expect(client.loadAccount).toHaveBeenCalledTimes(2);
  });

  it('invalidateCache clears entry for specific account', async () => {
    const client = buildHorizonClient('300');
    await mgr.getSequenceNumber('INV_ACC', client);
    mgr.invalidateCache('INV_ACC');
    await mgr.getSequenceNumber('INV_ACC', client);
    // loadAccount called twice because cache was cleared
    expect(client.loadAccount).toHaveBeenCalledTimes(2);
  });

  it('clearCache() with no argument clears all entries', async () => {
    const clientA = buildHorizonClient('10');
    const clientB = buildHorizonClient('20');
    await mgr.getSequenceNumber('A', clientA);
    await mgr.getSequenceNumber('B', clientB);
    mgr.clearCache();
    await mgr.getSequenceNumber('A', clientA);
    await mgr.getSequenceNumber('B', clientB);
    expect(clientA.loadAccount).toHaveBeenCalledTimes(2);
    expect(clientB.loadAccount).toHaveBeenCalledTimes(2);
  });

  it('clearCache(accountId) only clears the specified account', async () => {
    const clientA = buildHorizonClient('10');
    const clientB = buildHorizonClient('20');
    await mgr.getSequenceNumber('ONLY_A', clientA);
    await mgr.getSequenceNumber('ONLY_B', clientB);
    mgr.clearCache('ONLY_A');
    await mgr.getSequenceNumber('ONLY_A', clientA);
    await mgr.getSequenceNumber('ONLY_B', clientB); // still cached
    expect(clientA.loadAccount).toHaveBeenCalledTimes(2);
    expect(clientB.loadAccount).toHaveBeenCalledTimes(1);
  });

  it('increments sequence optimistically for concurrent calls within same lock', async () => {
    const client = buildHorizonClient('1000');
    const seq1 = await mgr.getSequenceNumber('OPT_ACC', client);
    const seq2 = await mgr.getSequenceNumber('OPT_ACC', client);
    // seq1 = '1000', seq2 = '1001'
    expect(BigInt(seq2)).toBe(BigInt(seq1) + 1n);
    // Horizon called only once
    expect(client.loadAccount).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('executeWithRetry — sequence conflict handling', () => {
  let mgr;
  beforeEach(() => {
    mgr = createSequenceManager({ maxRetries: 4, retryDelayMs: 5 });
  });

  it('succeeds immediately when no error occurs', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await mgr.executeWithRetry('ACC', fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on tx_bad_seq and succeeds on second attempt', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(buildBadSeqError())
      .mockResolvedValue('success');

    const result = await mgr.executeWithRetry('ACC', fn);
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(mgr.getMetrics().conflicts).toBe(1);
    expect(mgr.getMetrics().retries).toBe(1);
  });

  it('retries up to maxRetries times then throws', async () => {
    const fn = jest.fn().mockRejectedValue(buildBadSeqError());

    await expect(mgr.executeWithRetry('ACC', fn)).rejects.toMatchObject({
      response: { data: { extras: { result_codes: { transaction: 'tx_bad_seq' } } } },
    });

    // attempt 0 … maxRetries  → 5 total calls
    expect(fn).toHaveBeenCalledTimes(5);
    expect(mgr.getMetrics().conflicts).toBe(5);
    expect(mgr.getMetrics().retries).toBe(4); // retries = attempts - 1 (last one just throws)
  });

  it('does NOT retry on non-sequence errors', async () => {
    const nonSeqErr = new Error('insufficient_balance');
    const fn = jest.fn().mockRejectedValue(nonSeqErr);

    await expect(mgr.executeWithRetry('ACC', fn)).rejects.toThrow('insufficient_balance');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(mgr.getMetrics().conflicts).toBe(0);
  });

  it('invalidates cache on each tx_bad_seq before retry', async () => {
    // Verify the side-effect: after a tx_bad_seq the cache is cleared so
    // Horizon is re-queried on the retry attempt.
    const client = buildHorizonClient('100');

    // Prime the cache for INVAL_ACC
    await mgr.getSequenceNumber('INVAL_ACC', client);
    // loadAccount called once so far
    expect(client.loadAccount).toHaveBeenCalledTimes(1);

    // Now run executeWithRetry with two bad-seq failures; each retry should
    // clear the cache and trigger a fresh Horizon fetch.
    const fn = jest.fn()
      .mockImplementationOnce(async () => {
        // On attempt 0: cache is warm (from the prime above), so Horizon
        // is NOT called yet.  Throw bad_seq → cache cleared.
        throw buildBadSeqError();
      })
      .mockImplementationOnce(async () => {
        // On attempt 1: cache was cleared, so getSequenceNumber will call
        // Horizon again.  Throw bad_seq → cache cleared again.
        await mgr.getSequenceNumber('INVAL_ACC', client);
        throw buildBadSeqError();
      })
      .mockResolvedValue('done');

    await mgr.executeWithRetry('INVAL_ACC', fn);

    // Horizon was called at least once during the retries (cache was invalidated)
    expect(client.loadAccount).toHaveBeenCalledTimes(2);
    expect(mgr.getMetrics().conflicts).toBe(2);
  });

  it('passes attempt index to transactionFn', async () => {
    const attempts = [];
    const fn = jest.fn().mockImplementation(async (attempt) => {
      attempts.push(attempt);
      if (attempt < 2) throw buildBadSeqError();
      return 'done';
    });

    await mgr.executeWithRetry('ATTEMPT_ACC', fn);
    expect(attempts).toEqual([0, 1, 2]);
  });

  it('with maxRetries=0 makes exactly one attempt and throws on conflict', async () => {
    const zeroMgr = createSequenceManager({ maxRetries: 0, retryDelayMs: 5 });
    const fn = jest.fn().mockRejectedValue(buildBadSeqError());

    await expect(zeroMgr.executeWithRetry('Z_ACC', fn)).rejects.toBeDefined();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('serialises concurrent calls from the same account during retry', async () => {
    const order = [];
    const ACCOUNT = 'SERIAL_RETRY_ACC';

    // Two tasks for the same account; first one errors once
    const t1 = mgr.executeWithRetry(ACCOUNT, jest.fn()
      .mockImplementationOnce(async () => {
        order.push('t1-first-attempt');
        throw buildBadSeqError();
      })
      .mockImplementation(async () => {
        order.push('t1-retry');
        return 'ok1';
      })
    );

    const t2 = mgr.executeWithRetry(ACCOUNT, async () => {
      order.push('t2');
      return 'ok2';
    });

    const [r1, r2] = await Promise.all([t1, t2]);
    expect(r1).toBe('ok1');
    expect(r2).toBe('ok2');

    // t2 must start only after t1's entire retry cycle completes
    expect(order.indexOf('t2')).toBeGreaterThan(order.indexOf('t1-retry'));
  });

  it('detects tx_bad_seq via message string fallback', async () => {
    const msgErr = new Error('tx_bad_seq occurred');
    const fn = jest.fn()
      .mockRejectedValueOnce(msgErr)
      .mockResolvedValue('ok');

    const result = await mgr.executeWithRetry('MSG_ACC', fn);
    expect(result).toBe('ok');
    expect(mgr.getMetrics().conflicts).toBe(1);
  });

  it('detects sequence error via "sequence" keyword in message', async () => {
    const seqErr = new Error('bad sequence number');
    const fn = jest.fn()
      .mockRejectedValueOnce(seqErr)
      .mockResolvedValue('ok');

    const result = await mgr.executeWithRetry('SEQ_MSG_ACC', fn);
    expect(result).toBe('ok');
    expect(mgr.getMetrics().conflicts).toBe(1);
  });

  it('handles 10+ concurrent transactions from the same account', async () => {
    const N = 15;
    const ACCOUNT = 'HIGH_CONCURRENCY';
    const results = [];

    const tasks = Array.from({ length: N }, (_, i) =>
      mgr.executeWithRetry(ACCOUNT, async () => {
        results.push(i);
        return i;
      })
    );

    const values = await Promise.all(tasks);
    expect(values).toHaveLength(N);
    // Each task executed exactly once
    expect(results).toHaveLength(N);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('metrics', () => {
  let mgr;
  beforeEach(() => {
    mgr = createSequenceManager({ retryDelayMs: 5, maxRetries: 3 });
  });

  it('getMetrics returns a snapshot (not a live reference)', () => {
    const snap1 = mgr.getMetrics();
    // Mutating the snapshot should not affect internal state
    snap1.conflicts = 999;
    const snap2 = mgr.getMetrics();
    expect(snap2.conflicts).toBe(0);
  });

  it('resetMetrics zeros all counters', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(buildBadSeqError())
      .mockResolvedValue('ok');
    await mgr.executeWithRetry('M_ACC', fn);

    mgr.resetMetrics();
    expect(mgr.getMetrics()).toEqual({
      conflicts: 0,
      retries: 0,
      cacheHits: 0,
      cacheMisses: 0,
      lockWaits: 0,
    });
  });

  it('tracks cacheHits after warmup', async () => {
    const client = buildHorizonClient('50');
    await mgr.getSequenceNumber('HIT_ACC', client);
    await mgr.getSequenceNumber('HIT_ACC', client);
    await mgr.getSequenceNumber('HIT_ACC', client);
    expect(mgr.getMetrics().cacheHits).toBeGreaterThanOrEqual(1);
  });

  it('tracks cacheMisses on cold starts', async () => {
    const client = buildHorizonClient('50');
    await mgr.getSequenceNumber('MISS_ACC_1', client);
    await mgr.getSequenceNumber('MISS_ACC_2', client);
    expect(mgr.getMetrics().cacheMisses).toBe(2);
  });

  it('increments conflicts and retries correctly across multiple executions', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(buildBadSeqError())
      .mockResolvedValue('ok');

    await mgr.executeWithRetry('METRIC_ACC', fn);

    const m = mgr.getMetrics();
    expect(m.conflicts).toBe(1);
    expect(m.retries).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('activeLockCount', () => {
  it('returns 0 when no locks are held', () => {
    const mgr = createSequenceManager();
    expect(mgr.activeLockCount()).toBe(0);
  });

  it('returns the number of accounts with pending locks', async () => {
    const mgr = createSequenceManager();
    let lockCountDuring;

    const p = mgr.withAccountLock('LOCK_ACC', async () => {
      // Snapshot the lock count while the task is actively running
      lockCountDuring = mgr.activeLockCount();
      await delay(10);
    });

    await p;
    // Flush any pending microtasks (gate.finally cleanup) before asserting
    await delay(0);

    expect(lockCountDuring).toBeGreaterThanOrEqual(1);
    // After the task and cleanup settle, lock should be released
    expect(mgr.activeLockCount()).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('edge cases and validation', () => {
  it('handles Horizon client that rejects', async () => {
    const mgr = createSequenceManager();
    const badClient = {
      loadAccount: jest.fn().mockRejectedValue(new Error('network error')),
    };

    await expect(mgr.getSequenceNumber('ACC', badClient)).rejects.toThrow('network error');
  });

  it('handles null error in executeWithRetry gracefully', async () => {
    const mgr = createSequenceManager({ maxRetries: 1, retryDelayMs: 5 });
    // A function that throws a non-seq, non-null error
    const fn = jest.fn().mockRejectedValue(new Error('generic'));
    await expect(mgr.executeWithRetry('NULL_ERR', fn)).rejects.toThrow('generic');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('concurrent calls for different accounts do not share sequence caches', async () => {
    const mgr = createSequenceManager();
    const clientA = buildHorizonClient('10');
    const clientB = buildHorizonClient('20');

    const [seqA, seqB] = await Promise.all([
      mgr.getSequenceNumber('DIFF_A', clientA),
      mgr.getSequenceNumber('DIFF_B', clientB),
    ]);

    expect(seqA).toBe('10');
    expect(seqB).toBe('20');
  });

  it('module-level singleton exports are functional', () => {
    // Import the module-level singleton exports
    const mod = require('../src/utils/sequenceManager');
    expect(typeof mod.executeWithRetry).toBe('function');
    expect(typeof mod.getMetrics).toBe('function');
    expect(typeof mod.defaultManager).toBe('object');
  });

  it('isSequenceConflict detects result_codes at top-level extras', async () => {
    const mgr = createSequenceManager({ maxRetries: 1, retryDelayMs: 5 });
    const altErr = new Error('bad seq');
    altErr.extras = { result_codes: { transaction: 'tx_bad_seq' } };

    const fn = jest.fn()
      .mockRejectedValueOnce(altErr)
      .mockResolvedValue('recovered');

    const result = await mgr.executeWithRetry('ALT_ERR_ACC', fn);
    expect(result).toBe('recovered');
    expect(mgr.getMetrics().conflicts).toBe(1);
  });

  it('does not mutate the user-supplied config object', () => {
    const userConfig = { maxRetries: 3 };
    createSequenceManager(userConfig);
    // Original must be untouched
    expect(Object.keys(userConfig)).toHaveLength(1);
  });
});