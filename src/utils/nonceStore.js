/**
 * Nonce Store - Request Replay Protection
 *
 * Tracks used nonces to ensure each signed request can only be used once.
 * Nonces are persisted to the database to survive server restarts and work
 * across multiple instances in a distributed deployment.
 *
 * Security assumptions:
 * - Nonces must have sufficient entropy (>= 16 random bytes / 32 hex chars).
 * - Clock skew between client and server should be < 30 seconds (enforced by
 *   the request signer's timestamp check).
 * - The nonce window matches the signature validity window (SIGNATURE_MAX_AGE_MS).
 */

const { SIGNATURE_MAX_AGE_MS } = require('./requestSigner');
const log = require('./log');

/** How often the cleanup sweep runs (ms). Defaults to 5 minutes. */
const CLEANUP_INTERVAL_MS = parseInt(process.env.NONCE_CLEANUP_INTERVAL_MS, 10) || 300000;

/** Enable in-memory store for testing via environment variable. */
const USE_MEMORY_NONCE_STORE = process.env.USE_MEMORY_NONCE_STORE === 'true';

/**
 * NonceStore - database-backed store for used nonces with optional in-memory fallback.
 *
 * When USE_MEMORY_NONCE_STORE=true, uses in-memory Map for testing.
 * Otherwise, persists nonces to the database for durability and multi-instance support.
 */
class NonceStore {
  constructor({ db = null, windowMs = SIGNATURE_MAX_AGE_MS } = {}) {
    this._db = db;
    this._windowMs = windowMs;
    this._cleanupTimer = null;

    // In-memory store for testing
    this._memoryStore = USE_MEMORY_NONCE_STORE ? new Map() : null;

    // Metrics
    this._hits = 0;
    this._misses = 0;
  }

  /**
   * Check whether a nonce has already been used, then record it.
   *
   * @param {string} nonce - The nonce value from the X-Nonce header.
   * @returns {{ seen: boolean }} `seen: true` means the nonce was already used (replay).
   */
  async check(nonce) {
    if (this._memoryStore) {
      return this._checkMemory(nonce);
    }

    if (!this._db) {
      throw new Error('NonceStore: database not initialized');
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + this._windowMs);

    try {
      // Check if nonce exists and is not expired
      const existing = await this._db.get(
        'SELECT nonce FROM nonce_store WHERE nonce = ? AND expiresAt > ?',
        [nonce, now.toISOString()]
      );

      if (existing) {
        this._hits++;
        return { seen: true };
      }

      // Insert new nonce
      await this._db.run(
        'INSERT OR IGNORE INTO nonce_store (nonce, expiresAt) VALUES (?, ?)',
        [nonce, expiresAt.toISOString()]
      );

      this._misses++;
      return { seen: false };
    } catch (err) {
      // Log error but don't fail the request
      log.error('NONCE_STORE', 'check error', { error: err.message });
      return { seen: false };
    }
  }

  /**
   * In-memory check for testing.
   * @private
   */
  _checkMemory(nonce) {
    const now = Date.now();
    const existing = this._memoryStore.get(nonce);

    if (existing !== undefined && existing > now) {
      this._hits++;
      return { seen: true };
    }

    this._memoryStore.set(nonce, now + this._windowMs);
    this._misses++;
    return { seen: false };
  }

  /**
   * Remove all nonces whose expiry has passed.
   *
   * @returns {{ removed: number }} Number of entries removed.
   */
  async cleanup() {
    if (this._memoryStore) {
      return this._cleanupMemory();
    }

    if (!this._db) {
      return { removed: 0 };
    }

    try {
      const now = new Date().toISOString();
      const result = await this._db.run(
        'DELETE FROM nonce_store WHERE expiresAt <= ?',
        [now]
      );
      return { removed: result.changes || 0 };
    } catch (err) {
      log.error('NONCE_STORE', 'cleanup error', { error: err.message });
      return { removed: 0 };
    }
  }

  /**
   * In-memory cleanup for testing.
   * @private
   */
  _cleanupMemory() {
    const now = Date.now();
    let removed = 0;
    for (const [nonce, expiresAt] of this._memoryStore) {
      if (expiresAt <= now) {
        this._memoryStore.delete(nonce);
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
   * @returns {{ hits: number, misses: number, hitRate: number }}
   */
  getMetrics() {
    const total = this._hits + this._misses;
    return {
      hits: this._hits,
      misses: this._misses,
      hitRate: total === 0 ? 0 : this._hits / total,
    };
  }
}

/** Singleton instance - initialized with database in app startup. */
let defaultStore = null;

function initializeDefaultStore(db) {
  defaultStore = new NonceStore({ db }).startCleanup();
  return defaultStore;
}

function getDefaultStore() {
  if (!defaultStore) {
    defaultStore = new NonceStore().startCleanup();
  }
  return defaultStore;
}

module.exports = { NonceStore, initializeDefaultStore, getDefaultStore, CLEANUP_INTERVAL_MS };
