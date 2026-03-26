'use strict';

/**
 * @fileoverview Stellar Transaction Sequence Number Manager
 *
 * Manages per-account sequence numbers for Stellar blockchain transactions.
 * Solves the concurrency problem where multiple simultaneous transactions from
 * the same account fail because each requires a strictly incrementing sequence number.
 *
 * Key features:
 * - Per-account async mutex (lock) to serialize concurrent transactions
 * - In-memory sequence number cache to reduce Horizon API calls
 * - Optimistic retry on `tx_bad_seq` errors with automatic cache invalidation
 * - Prometheus-style metrics (conflict count, retry count, cache hits/misses)
 *
 * @module sequenceManager
 */

/**
 * Default configuration values for the sequence manager.
 * @type {Object}
 */
const DEFAULT_CONFIG = {
  /** Maximum number of times to retry a transaction after a sequence conflict */
  maxRetries: 5,
  /** Base delay (ms) between retries — actual delay uses exponential back-off */
  retryDelayMs: 100,
  /** How long (ms) a cached sequence number is considered fresh */
  cacheTtlMs: 30_000,
  /** Multiplier applied to retryDelayMs on each successive attempt */
  backoffMultiplier: 2,
};

/**
 * @typedef {Object} SequenceCache
 * @property {string} sequenceNumber - The cached sequence number (BigInt-safe string)
 * @property {number} cachedAt       - Unix timestamp (ms) when the value was stored
 */

/**
 * @typedef {Object} SequenceMetrics
 * @property {number} conflicts   - Total sequence-number conflicts encountered
 * @property {number} retries     - Total retry attempts made
 * @property {number} cacheHits   - Times a valid cached value was used
 * @property {number} cacheMisses - Times the cache was cold or stale
 * @property {number} lockWaits   - Times a transaction had to wait for an account lock
 */

/**
 * Creates and returns a new SequenceManager instance.
 *
 * @param {Object} [config={}] - Optional configuration overrides
 * @param {number} [config.maxRetries]        - Max retries on sequence conflict
 * @param {number} [config.retryDelayMs]      - Base retry delay in ms
 * @param {number} [config.cacheTtlMs]        - Cache TTL in ms
 * @param {number} [config.backoffMultiplier] - Exponential back-off multiplier
 * @returns {SequenceManager} A new sequence manager instance
 *
 * @example
 * const manager = createSequenceManager({ maxRetries: 3, retryDelayMs: 50 });
 */
function createSequenceManager(config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  /**
   * Per-account mutex queue.
   * Key  : Stellar public key (string)
   * Value: Promise chain acting as a serialization lock
   * @type {Map<string, Promise<void>>}
   */
  const lockMap = new Map();

  /**
   * In-memory sequence number cache.
   * Key  : Stellar public key (string)
   * Value: SequenceCache object
   * @type {Map<string, SequenceCache>}
   */
  const sequenceCache = new Map();

  /**
   * Live metrics counters.
   * @type {SequenceMetrics}
   */
  const metrics = {
    conflicts: 0,
    retries: 0,
    cacheHits: 0,
    cacheMisses: 0,
    lockWaits: 0,
  };

  // ─── Private helpers ───────────────────────────────────────────────────────

  /**
   * Returns a promise that resolves after `ms` milliseconds.
   * @param {number} ms
   * @returns {Promise<void>}
   */
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Computes the retry delay for a given attempt using exponential back-off
   * with ±10 % jitter to avoid thundering-herd problems.
   *
   * @param {number} attempt - Zero-based attempt index
   * @returns {number} Delay in milliseconds
   */
  function computeDelay(attempt) {
    const base = cfg.retryDelayMs * Math.pow(cfg.backoffMultiplier, attempt);
    const jitter = base * 0.1 * (Math.random() * 2 - 1); // ±10 %
    return Math.round(base + jitter);
  }

  /**
   * Determines whether a Stellar error represents a sequence number conflict.
   * Stellar SDK wraps these as `tx_bad_seq` result codes.
   *
   * @param {Error|Object} error - The error thrown by the Stellar SDK
   * @returns {boolean}
   */
  function isSequenceConflict(error) {
    if (!error) return false;
    // Stellar SDK error shape: error.response.data.extras.result_codes.transaction
    const txCode =
      error?.response?.data?.extras?.result_codes?.transaction ||
      error?.extras?.result_codes?.transaction ||
      error?.result_codes?.transaction ||
      '';
    if (txCode === 'tx_bad_seq') return true;
    // Some mock/test environments surface this via message
    const msg = (error.message || '').toLowerCase();
    return msg.includes('tx_bad_seq') || msg.includes('sequence');
  }

  /**
   * Returns true when a cached entry is still within its TTL window.
   *
   * @param {SequenceCache} entry
   * @returns {boolean}
   */
  function isCacheValid(entry) {
    return Date.now() - entry.cachedAt < cfg.cacheTtlMs;
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Acquires an exclusive lock for the given account and runs `fn` within it.
   * All callers for the same `accountId` are queued and executed serially.
   *
   * @template T
   * @param {string}            accountId - Stellar public key of the sender
   * @param {function(): Promise<T>} fn   - Async work to execute under the lock
   * @returns {Promise<T>} Resolves with the return value of `fn`
   *
   * @example
   * const result = await manager.withAccountLock(senderKey, async () => {
   *   const seq = await manager.getSequenceNumber(senderKey, horizonClient);
   *   return stellarService.submitTransaction(senderKey, seq);
   * });
   */
  function withAccountLock(accountId, fn) {
    const current = lockMap.get(accountId) || Promise.resolve();

    // `gate` is what the next waiter queues behind — it never rejects so the
    // chain is never broken by one task's error.
    // `result` is what the caller awaits — it resolves/rejects with fn's value.
    let resolveGate;
    const gate = new Promise((res) => { resolveGate = res; });

    const result = current.then(() => {
      if (lockMap.get(accountId) !== gate) metrics.lockWaits++;
      return fn();
    });

    // Release the gate (and clean up the map) once fn settles
    result.then(resolveGate, resolveGate);
    gate.finally(() => {
      if (lockMap.get(accountId) === gate) {
        lockMap.delete(accountId);
      }
    });

    lockMap.set(accountId, gate);
    return result; // callers see fn's actual resolution / rejection
  }

  /**
   * Returns the current sequence number for `accountId`.
   * Serves from cache when the entry is fresh; otherwise fetches from Horizon.
   *
   * After a successful fetch the value is stored in the cache and incremented
   * by 1 so the *next* call within the same lock window gets an already-
   * incremented value (optimistic increment pattern).
   *
   * @param {string} accountId      - Stellar public key
   * @param {Object} horizonClient  - Object with `loadAccount(publicKey)` method
   * @returns {Promise<string>} The sequence number to use for the next transaction
   */
  async function getSequenceNumber(accountId, horizonClient) {
    const cached = sequenceCache.get(accountId);

    if (cached && isCacheValid(cached)) {
      metrics.cacheHits++;
      // Return cached value; pre-advance cache so the next call in the same
      // lock window receives an already-incremented, unique sequence number.
      const toReturn = cached.sequenceNumber;
      const next = (BigInt(toReturn) + 1n).toString();
      sequenceCache.set(accountId, { sequenceNumber: next, cachedAt: Date.now() });
      return toReturn;
    }

    // Cache cold or expired — fetch from Horizon
    metrics.cacheMisses++;
    const account = await horizonClient.loadAccount(accountId);
    const sequenceNumber = account.sequenceNumber || account.sequence_number || '0';
    // Pre-load cache with the next value so the very first cache hit returns
    // an incremented sequence without another Horizon round-trip.
    const nextAfterFetch = (BigInt(sequenceNumber) + 1n).toString();
    sequenceCache.set(accountId, { sequenceNumber: nextAfterFetch, cachedAt: Date.now() });
    return sequenceNumber;
  }

  /**
   * Invalidates the cached sequence number for `accountId`.
   * Called automatically when a `tx_bad_seq` error is detected so the next
   * attempt fetches a fresh value from Horizon.
   *
   * @param {string} accountId - Stellar public key
   * @returns {void}
   */
  function invalidateCache(accountId) {
    sequenceCache.delete(accountId);
  }

  /**
   * Executes `transactionFn` inside an account lock, retrying automatically on
   * sequence-number conflicts up to `cfg.maxRetries` times.
   *
   * On each `tx_bad_seq` error the cache is invalidated so the next attempt
   * fetches a fresh sequence number from Horizon.
   *
   * @template T
   * @param {string}   accountId       - Stellar public key of the sending account
   * @param {function(attempt: number): Promise<T>} transactionFn
   *   Function that builds and submits the transaction.
   *   Receives the current attempt number (0-based) as its argument.
   * @returns {Promise<T>} Resolves with the result of a successful `transactionFn` call
   * @throws {Error} Re-throws the last error after all retries are exhausted
   *
   * @example
   * const result = await manager.executeWithRetry(senderPublicKey, async (attempt) => {
   *   const seq = await manager.getSequenceNumber(senderPublicKey, server);
   *   return stellarService.buildAndSubmit(senderPublicKey, recipientPublicKey, amount, seq);
   * });
   */
  async function executeWithRetry(accountId, transactionFn) {
    return withAccountLock(accountId, async () => {
      let lastError;

      for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
        try {
          const result = await transactionFn(attempt);
          return result;
        } catch (err) {
          lastError = err;

          if (!isSequenceConflict(err)) {
            // Non-sequence error — propagate immediately
            throw err;
          }

          metrics.conflicts++;

          if (attempt < cfg.maxRetries) {
            metrics.retries++;
            invalidateCache(accountId);
            const delay = computeDelay(attempt);
            await sleep(delay);
          }
        }
      }

      throw lastError;
    });
  }

  /**
   * Returns a snapshot of the current metrics.
   * Values are monotonically increasing counters; reset with `resetMetrics()`.
   *
   * @returns {SequenceMetrics}
   */
  function getMetrics() {
    return { ...metrics };
  }

  /**
   * Resets all metrics counters to zero.
   * Useful between test runs or monitoring intervals.
   *
   * @returns {void}
   */
  function resetMetrics() {
    metrics.conflicts = 0;
    metrics.retries = 0;
    metrics.cacheHits = 0;
    metrics.cacheMisses = 0;
    metrics.lockWaits = 0;
  }

  /**
   * Clears the sequence number cache for all accounts (or a single account).
   *
   * @param {string} [accountId] - If provided, only clear cache for this account
   * @returns {void}
   */
  function clearCache(accountId) {
    if (accountId) {
      sequenceCache.delete(accountId);
    } else {
      sequenceCache.clear();
    }
  }

  /**
   * Returns the number of accounts currently holding an active lock.
   * Useful for diagnostics and tests.
   *
   * @returns {number}
   */
  function activeLockCount() {
    return lockMap.size;
  }

  return {
    withAccountLock,
    getSequenceNumber,
    invalidateCache,
    executeWithRetry,
    getMetrics,
    resetMetrics,
    clearCache,
    activeLockCount,
    // Expose config for introspection/testing
    _config: cfg,
  };
}

/**
 * Singleton instance with default configuration.
 * Import this directly in production code; use `createSequenceManager` in tests.
 */
const defaultManager = createSequenceManager();

module.exports = {
  createSequenceManager,
  defaultManager,
  // Re-export for convenience
  withAccountLock: defaultManager.withAccountLock,
  getSequenceNumber: defaultManager.getSequenceNumber,
  invalidateCache: defaultManager.invalidateCache,
  executeWithRetry: defaultManager.executeWithRetry,
  getMetrics: defaultManager.getMetrics,
  resetMetrics: defaultManager.resetMetrics,
  clearCache: defaultManager.clearCache,
  activeLockCount: defaultManager.activeLockCount,
};