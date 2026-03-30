/**
 * In-Memory Simple Cache with TTL Support
 */

const CACHE = new Map();

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
}

module.exports = Cache;
