'use strict';

const log = require('../utils/log');

class RateLimitStore {
  incrementAndCheck(_key, _limit, _windowSeconds) {
    throw new Error('RateLimitStore.incrementAndCheck() must be implemented');
  }
  close() {}
}

class MemoryRateLimitStore extends RateLimitStore {
  constructor() {
    super();
    this._windows = new Map();
  }

  incrementAndCheck(key, limit, windowSeconds) {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const cutoff = now - windowMs;

    let ts = this._windows.get(key) || [];
    ts = ts.filter(t => t > cutoff);

    const resetAt = ts.length > 0 ? ts[0] + windowMs : now + windowMs;

    if (ts.length >= limit) {
      this._windows.set(key, ts);
      return { allowed: false, count: ts.length, remaining: 0, resetAt };
    }

    ts.push(now);
    this._windows.set(key, ts);
    return { allowed: true, count: ts.length, remaining: limit - ts.length, resetAt };
  }

  clear() { this._windows.clear(); }
}

/**
 * Redis-backed store — atomic INCR+EXPIRE via Lua so no double-allow across replicas.
 * failOpen (default true): allow requests when Redis is unavailable.
 * failOpen false: deny requests when Redis is unavailable.
 */
class RedisRateLimitStore extends RateLimitStore {
  constructor(redisClient, options = {}) {
    super();
    this._client = redisClient;
    this._failOpen = options.failOpen !== undefined
      ? Boolean(options.failOpen)
      : process.env.RATE_LIMIT_FAIL_OPEN !== 'false';
  }

  async incrementAndCheck(key, limit, windowSeconds) {
    try {
      const lua = `
        local c = redis.call("INCR", KEYS[1])
        if c == 1 then redis.call("EXPIRE", KEYS[1], ARGV[1]) end
        local ttl = redis.call("PTTL", KEYS[1])
        return {c, ttl}
      `;
      let res;
      try {
        res = await this._client.eval(lua, 1, key, String(windowSeconds));
      } catch (_) {
        res = await this._client.eval(lua, { keys: [key], arguments: [String(windowSeconds)] });
      }
      const count = Array.isArray(res) ? Number(res[0]) : Number(res);
      const ttlMs = Array.isArray(res) ? Math.max(Number(res[1]), 0) : windowSeconds * 1000;
      const resetAt = Date.now() + ttlMs;
      return { allowed: count <= limit, count, remaining: Math.max(0, limit - count), resetAt };
    } catch (err) {
      log.error('RATE_LIMIT_STORE', 'Redis error', { key, error: err.message, policy: this._failOpen ? 'fail-open' : 'fail-closed' });
      if (this._failOpen) return { allowed: true, count: 0, remaining: limit, resetAt: Date.now() + windowSeconds * 1000 };
      return { allowed: false, count: limit, remaining: 0, resetAt: Date.now() + windowSeconds * 1000 };
    }
  }

  close() { try { this._client.quit && this._client.quit(); } catch (_) {} }
}

const _defaultMemoryStore = new MemoryRateLimitStore();

function getRateLimitStore(redisClient = null) {
  const type = (process.env.RATE_LIMIT_STORE || 'memory').toLowerCase();
  if (type === 'redis') {
    const client = redisClient || _tryGetRedisClient();
    if (!client) {
      log.warn('RATE_LIMIT_STORE', 'Redis requested but unavailable; using memory store');
      return _defaultMemoryStore;
    }
    return new RedisRateLimitStore(client);
  }
  return _defaultMemoryStore;
}

function _tryGetRedisClient() {
  try {
    const Redis = require('ioredis');
    const url = process.env.REDIS_URL;
    return url ? new Redis(url) : null;
  } catch (_) { return null; }
}

module.exports = { RateLimitStore, MemoryRateLimitStore, RedisRateLimitStore, getRateLimitStore, _defaultMemoryStore };
