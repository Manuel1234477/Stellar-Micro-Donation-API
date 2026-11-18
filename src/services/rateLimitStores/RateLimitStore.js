'use strict';

/**
 * Rate Limit Store base class (#1482, #1777)
 *
 * RESPONSIBILITY: Single storage abstraction used by every rate limiter
 * OWNER: Backend Team
 * DEPENDENCIES: logging
 *
 * Every limiter in the app (perKeyRateLimit, the express-rate-limit limiters in
 * rateLimiter.js via ExpressRateLimitStore) counts requests through a subclass
 * of this class, so limits are shared across instances whenever a shared
 * backend (Redis) is configured.
 *
 * Algorithm: fixed window. The first hit for a key opens a window of
 * `windowMs`; later hits in the same window increment the counter without
 * extending it.
 *
 * Subclasses implement `hit(key, windowMs)` and may return either a plain
 * value (in-memory) or a Promise (Redis). `incrementAndCheck()` preserves that:
 * a synchronous store gives a synchronous result.
 *
 * Failure policy (see docs/RATE_LIMITING.md):
 * - fail-open (default): a store error allows the request
 * - fail-closed (RATE_LIMIT_FAIL_OPEN=false): a store error rejects the request
 * Either way the error is logged with the policy that was applied.
 */

const log = require('../../utils/log');

/**
 * Resolve the failure policy from an explicit option or the environment.
 *
 * @param {boolean} [failOpen]
 * @returns {boolean} true for fail-open
 */
function resolveFailOpen(failOpen) {
  if (failOpen !== undefined) return Boolean(failOpen);
  return process.env.RATE_LIMIT_FAIL_OPEN !== 'false';
}

function isThenable(value) {
  return Boolean(value) && typeof value.then === 'function';
}

class RateLimitStore {
  /**
   * @param {Object} [options]
   * @param {boolean} [options.failOpen] - Override RATE_LIMIT_FAIL_OPEN
   */
  constructor(options = {}) {
    this._failOpen = resolveFailOpen(options.failOpen);
  }

  /** @returns {boolean} true when store errors allow requests */
  get failOpen() {
    return this._failOpen;
  }

  /**
   * Record one hit for `key` in the current window.
   *
   * @param {string} key - Rate limit key
   * @param {number} windowMs - Window length in milliseconds
   * @returns {{count: number, resetAt: number}|Promise<{count: number, resetAt: number}>}
   *   count after this hit and the window end (epoch ms)
   */
  hit(_key, _windowMs) {
    throw new Error('hit() must be implemented by subclass');
  }

  /**
   * Remove one hit from `key` (used when a limiter skips a request after counting it).
   *
   * @param {string} key
   * @returns {void|Promise<void>}
   */
  decrement(_key) {
    throw new Error('decrement() must be implemented by subclass');
  }

  /**
   * Increment a counter and return the new count.
   *
   * @param {string} key
   * @param {number} windowMs
   * @returns {Promise<number>}
   */
  async increment(key, windowMs) {
    const result = await this.hit(key, windowMs);
    return result.count;
  }

  /**
   * Record a hit and decide whether it is within `limit`.
   * Store errors are logged and resolved with the configured failure policy.
   *
   * @param {string} key
   * @param {number} limit - Max requests per window
   * @param {number} windowSeconds - Window length in seconds
   * @returns {{allowed: boolean, count: number, remaining: number, resetAt: number, storeError?: boolean}
   *   |Promise<{allowed: boolean, count: number, remaining: number, resetAt: number, storeError?: boolean}>}
   */
  incrementAndCheck(key, limit, windowSeconds) {
    const windowMs = windowSeconds * 1000;
    const toResult = ({ count, resetAt }) => ({
      allowed: count <= limit,
      count,
      remaining: Math.max(0, limit - count),
      resetAt,
    });

    let hit;
    try {
      hit = this.hit(key, windowMs);
    } catch (err) {
      return this.handleStoreError(err, key, limit, windowMs);
    }

    if (isThenable(hit)) {
      return hit.then(toResult, (err) => this.handleStoreError(err, key, limit, windowMs));
    }
    return toResult(hit);
  }

  /**
   * Apply the failure policy to a store error. Always logs.
   *
   * @param {Error} err
   * @param {string} key
   * @param {number} limit
   * @param {number} windowMs
   * @returns {{allowed: boolean, count: number, remaining: number, resetAt: number, storeError: true}}
   */
  handleStoreError(err, key, limit, windowMs) {
    const policy = this._failOpen ? 'fail-open' : 'fail-closed';
    log.error('RATE_LIMIT_STORE', 'Rate limit store error', {
      store: this.constructor.name,
      key,
      error: err && err.message,
      policy,
    });
    const resetAt = Date.now() + windowMs;
    if (this._failOpen) {
      return { allowed: true, count: 0, remaining: limit, resetAt, storeError: true };
    }
    return { allowed: false, count: limit, remaining: 0, resetAt, storeError: true };
  }

  /**
   * Get the current counter value for a key.
   *
   * @param {string} key
   * @returns {Promise<number>} 0 if the key does not exist
   */
  async get(_key) {
    throw new Error('get() must be implemented by subclass');
  }

  /**
   * Reset a counter.
   *
   * @param {string} key
   * @returns {Promise<void>}
   */
  async reset(_key) {
    throw new Error('reset() must be implemented by subclass');
  }

  /**
   * @returns {Promise<boolean>} true if the store is usable
   */
  async isHealthy() {
    throw new Error('isHealthy() must be implemented by subclass');
  }

  /**
   * Release resources (timers, connections).
   *
   * @returns {Promise<void>}
   */
  async shutdown() {}

  /** Alias kept for callers of the former middleware/RateLimitStore API. */
  close() {
    return this.shutdown();
  }
}

module.exports = RateLimitStore;
module.exports.resolveFailOpen = resolveFailOpen;
