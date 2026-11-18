'use strict';

/**
 * In-Memory Rate Limit Store (#1482, #1777)
 *
 * RESPONSIBILITY: Provide in-process rate limit counters (single-instance deployments)
 * OWNER: Backend Team
 * DEPENDENCIES: RateLimitStore base class
 *
 * Fixed-window counters held in a Map. Operations are synchronous so callers
 * that cannot await (the legacy-key path in rbac.js) still get a real answer.
 * Expired windows are dropped lazily on access and by a periodic sweep, so no
 * per-key timers are kept alive.
 *
 * Counters are per process: with N instances a client can make up to N times
 * the limit. Use RATE_LIMIT_STORE=redis for shared limits.
 */

const RateLimitStore = require('./RateLimitStore');

const SWEEP_EVERY_N_HITS = 1000;

class MemoryRateLimitStore extends RateLimitStore {
  constructor(options = {}) {
    super(options);
    /** @type {Map<string, {count: number, resetAt: number}>} */
    this.windows = new Map();
    this._hitsSinceSweep = 0;
  }

  _current(key, now) {
    const entry = this.windows.get(key);
    if (entry && entry.resetAt <= now) {
      this.windows.delete(key);
      return undefined;
    }
    return entry;
  }

  _sweep(now) {
    for (const [key, entry] of this.windows) {
      if (entry.resetAt <= now) this.windows.delete(key);
    }
  }

  /** @inheritdoc */
  hit(key, windowMs) {
    const now = Date.now();
    if (++this._hitsSinceSweep >= SWEEP_EVERY_N_HITS) {
      this._hitsSinceSweep = 0;
      this._sweep(now);
    }

    let entry = this._current(key, now);
    if (!entry) {
      entry = { count: 0, resetAt: now + windowMs };
      this.windows.set(key, entry);
    }
    entry.count += 1;
    return { count: entry.count, resetAt: entry.resetAt };
  }

  /** @inheritdoc */
  decrement(key) {
    const entry = this._current(key, Date.now());
    if (entry && entry.count > 0) entry.count -= 1;
  }

  /** @inheritdoc */
  async get(key) {
    const entry = this._current(key, Date.now());
    return entry ? entry.count : 0;
  }

  /** @inheritdoc */
  async reset(key) {
    this.windows.delete(key);
  }

  /** @inheritdoc */
  async isHealthy() {
    return true;
  }

  /** @inheritdoc */
  async shutdown() {
    this.windows.clear();
  }

  /**
   * Clear all counters (tests). Synchronous on purpose.
   */
  clear() {
    this.windows.clear();
    this._hitsSinceSweep = 0;
  }
}

module.exports = MemoryRateLimitStore;
