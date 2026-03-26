/**
 * Nonce Store - Request Replay Protection
 *
 * Tracks used nonces to ensure each signed request can only be used once.
 * Nonces are automatically expired after the signing window (default: 5 minutes).
 * Store size is bounded to prevent memory exhaustion.
 *
 * Security assumptions:
 * - Nonces must have sufficient entropy (>= 16 random bytes / 32 hex chars).
 * - Clock skew between client and server should be < 30 seconds (enforced by
 *   the request signer's timestamp check).
 * - The nonce window matches the signature validity window (SIGNATURE_MAX_AGE_MS).
 */

const { SIGNATURE_MAX_AGE_MS } = require('./requestSigner');

/** Maximum number of nonces retained in memory at any time. */
const MAX_STORE_SIZE = parseInt(process.env.NONCE_STORE_MAX_SIZE, 10) || 10000;

/** How often the cleanup sweep runs (ms). Defaults to half the signing window. */
const CLEANUP_INTERVAL_MS = Math.floor(SIGNATURE_MAX_AGE_MS / 2);

/**
 * @typedef {Object} NonceEntry
 * @property {number} expiresAt - Unix ms timestamp after which the nonce is expired.
 */

/**
 * NonceStore - bounded in-memory store for used nonces.
 *
 * Internally uses a Map (nonce -> expiresAt) plus a FIFO insertion-order queue
 * so that when the store is full the oldest entry is evicted first.
 */
class NonceStore {
  constructor({ windowMs = SIGNATURE_MAX_AGE_MS, maxSize = MAX_STORE_SIZE } = {}) {
    /** @type {Map<string, number>} nonce -> expiresAt (ms) */
    this._store = new Map();
    this._windowMs = windowMs;
    this._maxSize = maxSize;

    // Metrics
    this._hits = 0;   // replay attempts blocked
    this._misses = 0; // new (valid) nonces accepted
    this._evictions = 0;

    this._cleanupTimer = null;
  }

  /**
   * Check whether a nonce has already been used, then record it.
   *
   * @param {string} nonce - The nonce value from the X-Nonce header.
   * @returns {{ seen: boolean }} `seen: true` means the nonce was already used (replay).
   */
  check(nonce) {
    const now = Date.now();

    // Treat an expired entry as unseen (it's past the signing window anyway).
    const existing = this._store.get(nonce);
    if (existing !== undefined && existing > now) {
      this._hits++;
      return { seen: true };
    }

    // Enforce size bound before inserting.
    if (this._store.size >= this._maxSize) {
      this._evictOldest();
    }

    this._store.set(nonce, now + this._windowMs);
    this._misses++;
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
    for (const [nonce, expiresAt] of this._store) {
      if (expiresAt <= now) {
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
    this._cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    /* istanbul ignore next */
    if (this._cleanupTimer.unref) this._cleanupTimer.unref();
    return this;
  }

  /**
   * Stop the background cleanup timer.
   *
   * @returns {this}
   */
  stopCleanup() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
    return this;
  }

  /**
   * Return store metrics.
   *
   * @returns {{ size: number, maxSize: number, hits: number, misses: number, hitRate: number, evictions: number }}
   */
  getMetrics() {
    const total = this._hits + this._misses;
    return {
      size: this._store.size,
      maxSize: this._maxSize,
      hits: this._hits,
      misses: this._misses,
      hitRate: total === 0 ? 0 : this._hits / total,
      evictions: this._evictions,
    };
  }

  /**
   * Evict the oldest (first-inserted) entry from the store.
   * Map iteration order is insertion order in V8.
   *
   * @private
   */
  _evictOldest() {
    const firstKey = this._store.keys().next().value;
    if (firstKey !== undefined) {
      this._store.delete(firstKey);
      this._evictions++;
    }
  }
}

/** Singleton instance used by the middleware. */
const defaultStore = new NonceStore().startCleanup();

module.exports = { NonceStore, defaultStore, CLEANUP_INTERVAL_MS };
