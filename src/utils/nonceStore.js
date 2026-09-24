/**
 * Nonce Store - Request Replay Protection
 *
 * Tracks used nonces to ensure each signed request can only be used once.
 * Nonces are held in an in-memory, size-bounded (LRU-evicting) store. Each
 * entry expires after the signing window so the store stays small and old
 * nonces can be reused once they can no longer form a valid signature.
 *
 * Security assumptions:
 * - Nonces must have sufficient entropy (>= 16 random bytes / 32 hex chars).
 * - Clock skew between client and server should be < 30 seconds (enforced by
 *   the request signer's timestamp check).
 * - The nonce window matches the signature validity window (SIGNATURE_MAX_AGE_MS).
 */

const { SIGNATURE_MAX_AGE_MS } = require('./requestSigner');

/** How often the cleanup sweep runs (ms). Defaults to 5 minutes. */
const CLEANUP_INTERVAL_MS = parseInt(process.env.NONCE_CLEANUP_INTERVAL_MS, 10) || 300000;

/** Default upper bound on the number of nonces retained in memory. */
const DEFAULT_MAX_SIZE = parseInt(process.env.NONCE_MAX_SIZE, 10) || 100000;

/**
 * NonceStore - synchronous, in-memory, size-bounded store for used nonces.
 *
 * Entries map a nonce string to its expiry timestamp (ms since epoch). When the
 * store exceeds `maxSize`, the oldest entries are evicted first (insertion-order
 * eviction via the underlying Map).
 */
class NonceStore {
  constructor({ windowMs = SIGNATURE_MAX_AGE_MS, maxSize = DEFAULT_MAX_SIZE } = {}) {
    this._windowMs = windowMs;
    this._maxSize = maxSize;
    this._cleanupTimer = null;

    /** nonce -> expiry timestamp (ms epoch) */
    this._store = new Map();

    // Metrics
    this._hits = 0;
    this._misses = 0;
    this._evictions = 0;
  }

  /**
   * Check whether a nonce has already been used, then record it.
   *
   * @param {string} nonce - The nonce value from the X-Nonce header.
   * @returns {{ seen: boolean }} `seen: true` means the nonce was already used (replay).
   */
  check(nonce) {
    const now = Date.now();
    const expiry = this._store.get(nonce);

    if (expiry !== undefined && expiry > now) {
      this._hits++;
      return { seen: true };
    }

    // Miss: either a brand-new nonce, or a previously seen one that has expired.
    // Delete any stale entry so the re-inserted nonce moves to the most-recent
    // position for insertion-order eviction.
    if (expiry !== undefined) {
      this._store.delete(nonce);
    }
    this._store.set(nonce, now + this._windowMs);
    this._misses++;

    // Evict oldest entries until we are within the size bound.
    while (this._store.size > this._maxSize) {
      const oldest = this._store.keys().next().value;
      this._store.delete(oldest);
      this._evictions++;
    }

    return { seen: false };
  }

  /**
   * Remove all nonces whose expiry has passed.
   *
   * @returns {{ removed: number }} Number of entries removed.
   */
  cleanup() {
    const now = Date.now();
    let removed = 0;
    for (const [nonce, expiry] of this._store) {
      if (expiry <= now) {
        this._store.delete(nonce);
        removed++;
      }
    }
    return { removed };
  }

  /**
   * Start the background cleanup timer.
   * Safe to call multiple times — only one timer runs at a time.
   *
   * @returns {this}
   */
  startCleanup() {
    if (this._cleanupTimer) return this;
    const timerRegistry = require('./timerRegistry');
    this._cleanupTimer = timerRegistry.createInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS, 'nonce-store-cleanup');
    this._cleanupTimer.unref();
    return this;
  }

  /**
   * Stop the background cleanup timer.
   *
   * @returns {this}
   */
  stopCleanup() {
    if (this._cleanupTimer) {
      this._cleanupTimer.clear();
      this._cleanupTimer = null;
    }
    return this;
  }

  /**
   * Remove all entries and reset metrics (used to isolate tests).
   */
  clear() {
    this._store.clear();
    this._hits = 0;
    this._misses = 0;
    this._evictions = 0;
  }

  /**
   * Return store metrics.
   *
   * @returns {{ hits: number, misses: number, hitRate: number, size: number,
   *   maxSize: number, evictions: number }}
   */
  getMetrics() {
    const total = this._hits + this._misses;
    return {
      hits: this._hits,
      misses: this._misses,
      hitRate: total === 0 ? 0 : this._hits / total,
      size: this._store.size,
      maxSize: this._maxSize,
      evictions: this._evictions,
    };
  }
}

/** Singleton instance shared by the middleware. */
const defaultStore = new NonceStore();

/**
 * Initialize the shared store. The `db` argument is accepted for backwards
 * compatibility with earlier (database-backed) call sites but is unused — the
 * store is purely in-memory. Starts the background cleanup sweep.
 */
function initializeDefaultStore(/* db */) {
  defaultStore.startCleanup();
  return defaultStore;
}

function getDefaultStore() {
  return defaultStore;
}

module.exports = {
  NonceStore,
  defaultStore,
  initializeDefaultStore,
  getDefaultStore,
  CLEANUP_INTERVAL_MS,
};
