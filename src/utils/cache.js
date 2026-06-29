/**
 * In-Memory Simple Cache with TTL Support
 */

const CACHE = new Map();

const DEFAULT_MAX_SIZE = parseInt(process.env.CACHE_MAX_SIZE, 10) || 10000;
const CLEANUP_INTERVAL_MS = parseInt(process.env.CACHE_CLEANUP_INTERVAL_MS, 10) || 60000;

let _cleanupTimer = null;

class Cache {
  /**
   * Set a value in the cache with a specific TTL
   * @param {string} key 
   * @param {any} value 
   * @param {number} ttlMs - TTL in milliseconds
   */
  static set(key, value, ttlMs) {
    const expiresAt = Date.now() + ttlMs;
    CACHE.set(key, { value, expiresAt });

    if (CACHE.size > DEFAULT_MAX_SIZE) {
      const oldest = CACHE.keys().next().value;
      CACHE.delete(oldest);
    }
  }

  /**
   * Get a value from the cache if it exists and hasn't expired
   * @param {string} key 
   * @returns {any|null} The cached value or null if expired/missing
   */
  static get(key) {
    const item = CACHE.get(key);
    if (!item) return null;

    if (Date.now() > item.expiresAt) {
      CACHE.delete(key);
      return null;
    }

    return item.value;
  }

  /**
   * Delete a key from the cache
   * @param {string} key 
   */
  static delete(key) {
    CACHE.delete(key);
  }

  /**
   * Delete all keys starting with a prefix
   * @param {string} prefix 
   */
  static clearPrefix(prefix) {
    for (const [key] of CACHE) {
      if (key.startsWith(prefix)) {
        CACHE.delete(key);
      }
    }
  }

  /**
   * Clear entire cache
   */
  static clear() {
    CACHE.clear();
  }

  /**
   * Remove all expired entries from the cache.
   * @returns {number} Number of entries removed
   */
  static cleanup() {
    const now = Date.now();
    let removed = 0;
    for (const [key, item] of CACHE) {
      if (now > item.expiresAt) {
        CACHE.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Start periodic background cleanup of expired entries.
   * Safe to call multiple times — only one timer runs.
   */
  static startCleanup() {
    if (_cleanupTimer) return;
    _cleanupTimer = setInterval(() => Cache.cleanup(), CLEANUP_INTERVAL_MS);
    if (_cleanupTimer.unref) _cleanupTimer.unref();
  }

  /**
   * Stop the background cleanup timer.
   */
  static stopCleanup() {
    if (_cleanupTimer) {
      clearInterval(_cleanupTimer);
      _cleanupTimer = null;
    }
  }

  /**
   * Return the current cache size.
   * @returns {number}
   */
  static getSize() {
    return CACHE.size;
  }
}

module.exports = Cache;
