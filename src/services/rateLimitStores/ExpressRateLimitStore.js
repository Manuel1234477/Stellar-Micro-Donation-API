'use strict';

/**
 * express-rate-limit adapter (#1777)
 *
 * RESPONSIBILITY: Let express-rate-limit limiters count through the shared rate limit store
 * OWNER: Backend Team
 * DEPENDENCIES: rateLimitStores factory
 *
 * Implements the express-rate-limit Store interface (init/increment/decrement/
 * resetKey/get) on top of whatever backend `getRateLimitStore()` returns, so
 * the named limiters in src/middleware/rateLimiter.js share counters across
 * instances whenever Redis is configured.
 *
 * Create one adapter per limiter (express-rate-limit rejects a reused store);
 * the `prefix` keeps each limiter's keys separate in the shared backend.
 */

let adapterSeq = 0;

class ExpressRateLimitStore {
  /**
   * @param {Object} [options]
   * @param {string} [options.prefix] - Key namespace for this limiter
   * @param {Function} [options.getStore] - Backend resolver (defaults to the shared factory)
   */
  constructor(options = {}) {
    adapterSeq += 1;
    this.prefix = `rl:${options.prefix || `limiter${adapterSeq}`}:`;
    this.windowMs = 60 * 1000;
    // Counters live in the shared backend, not in this process (when Redis is used).
    this.localKeys = false;
    this._getStore = options.getStore || (() => require('./index').getRateLimitStore());
  }

  /**
   * Called by express-rate-limit with the limiter options.
   * @param {{ windowMs: number }} options
   */
  init(options) {
    if (options && options.windowMs) this.windowMs = options.windowMs;
  }

  _key(key) {
    return this.prefix + key;
  }

  /**
   * @param {string} key
   * @returns {Promise<{ totalHits: number, resetTime: Date }>}
   */
  async increment(key) {
    const store = this._getStore();
    const max = Number.MAX_SAFE_INTEGER;
    const result = await store.incrementAndCheck(this._key(key), max, this.windowMs / 1000);

    // Fail-closed: report the hit count as over any limit so the limiter rejects.
    const totalHits = result.storeError && !result.allowed ? max : result.count;
    return { totalHits, resetTime: new Date(result.resetAt) };
  }

  async decrement(key) {
    await this._getStore().decrement(this._key(key));
  }

  async resetKey(key) {
    await this._getStore().reset(this._key(key));
  }

  async get(key) {
    const totalHits = await this._getStore().get(this._key(key));
    return { totalHits, resetTime: undefined };
  }
}

module.exports = ExpressRateLimitStore;
