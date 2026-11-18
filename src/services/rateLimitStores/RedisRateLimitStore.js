'use strict';

/**
 * Redis Rate Limit Store (#1482, #1381, #1777)
 *
 * RESPONSIBILITY: Provide distributed rate limit counters backed by Redis
 * OWNER: Backend Team
 * DEPENDENCIES: ioredis or redis client, RateLimitStore base class
 *
 * Each hit runs one Lua script (INCR, then PEXPIRE only when the key is new,
 * then PTTL) so increment and expiry are atomic and a window is never extended
 * by later hits. Works with both ioredis (`eval(lua, numKeys, ...)`) and
 * node-redis v4 (`eval(lua, { keys, arguments })`); the working call style is
 * remembered after the first success.
 *
 * Errors are not swallowed: `hit()` rejects, and `incrementAndCheck()` (base
 * class) logs and applies the fail-open / fail-closed policy.
 */

const RateLimitStore = require('./RateLimitStore');
const log = require('../../utils/log');

const HIT_SCRIPT = `
local c = redis.call("INCR", KEYS[1])
if c == 1 then redis.call("PEXPIRE", KEYS[1], ARGV[1]) end
local ttl = redis.call("PTTL", KEYS[1])
return {c, ttl}
`;

const DECREMENT_SCRIPT = `
local c = tonumber(redis.call("GET", KEYS[1]) or "0")
if c > 0 then return redis.call("DECR", KEYS[1]) end
return 0
`;

const EVAL_STYLES = {
  POSITIONAL: 'positional', // ioredis: eval(script, numKeys, key, arg)
  OBJECT: 'object',         // node-redis v4: eval(script, { keys, arguments })
};

class RedisRateLimitStore extends RateLimitStore {
  /**
   * @param {Object} redisClient - Connected ioredis or node-redis client
   * @param {Object} [options]
   * @param {boolean} [options.failOpen] - Override RATE_LIMIT_FAIL_OPEN
   */
  constructor(redisClient, options = {}) {
    super(options);
    this.client = redisClient;
    this._evalStyle = null;
    this.healthCheckInProgress = false;
  }

  async _eval(script, key, args) {
    const strArgs = args.map(String);
    const call = (style) => (style === EVAL_STYLES.OBJECT
      ? this.client.eval(script, { keys: [key], arguments: strArgs })
      : this.client.eval(script, 1, key, ...strArgs));

    if (this._evalStyle) return call(this._evalStyle);

    try {
      const res = await call(EVAL_STYLES.POSITIONAL);
      this._evalStyle = EVAL_STYLES.POSITIONAL;
      return res;
    } catch (positionalErr) {
      log.debug('REDIS_RATE_LIMIT', 'Positional eval() failed; trying object-style signature', {
        error: positionalErr.message,
      });
      const res = await call(EVAL_STYLES.OBJECT);
      this._evalStyle = EVAL_STYLES.OBJECT;
      return res;
    }
  }

  /** @inheritdoc */
  async hit(key, windowMs) {
    const res = await this._eval(HIT_SCRIPT, key, [Math.max(1, Math.ceil(windowMs))]);
    const count = Array.isArray(res) ? Number(res[0]) : Number(res);
    const ttlMs = Array.isArray(res) ? Number(res[1]) : windowMs;
    const resetAt = Date.now() + (ttlMs > 0 ? ttlMs : windowMs);
    return { count, resetAt };
  }

  /** @inheritdoc */
  async decrement(key) {
    try {
      await this._eval(DECREMENT_SCRIPT, key, []);
    } catch (error) {
      log.error('REDIS_RATE_LIMIT', 'Failed to decrement rate limit counter', { key, error: error.message });
    }
  }

  /** @inheritdoc */
  async get(key) {
    try {
      const value = await this.client.get(key);
      return value ? parseInt(value, 10) : 0;
    } catch (error) {
      log.error('REDIS_RATE_LIMIT', 'Failed to get rate limit counter', { key, error: error.message });
      throw error;
    }
  }

  /** @inheritdoc */
  async reset(key) {
    try {
      await this.client.del(key);
    } catch (error) {
      log.error('REDIS_RATE_LIMIT', 'Failed to reset rate limit counter', { key, error: error.message });
      throw error;
    }
  }

  /** @inheritdoc */
  async isHealthy() {
    if (this.healthCheckInProgress) {
      return true; // Avoid concurrent health checks
    }

    this.healthCheckInProgress = true;
    try {
      const pong = await this.client.ping();
      return pong === 'PONG';
    } catch (error) {
      log.warn('REDIS_RATE_LIMIT', 'Redis health check failed', { error: error.message });
      return false;
    } finally {
      this.healthCheckInProgress = false;
    }
  }

  /** @inheritdoc */
  async shutdown() {
    try {
      if (this.client && typeof this.client.quit === 'function') {
        await this.client.quit();
      }
    } catch (error) {
      log.warn('REDIS_RATE_LIMIT', 'Error during Redis shutdown', { error: error.message });
    }
  }
}

module.exports = RedisRateLimitStore;
module.exports.HIT_SCRIPT = HIT_SCRIPT;
