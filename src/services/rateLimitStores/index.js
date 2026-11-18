'use strict';

/**
 * Rate Limit Store Factory (#1482, #1777)
 *
 * RESPONSIBILITY: Create and own the single rate limit store used by every limiter
 * OWNER: Backend Team
 * DEPENDENCIES: MemoryRateLimitStore, RedisRateLimitStore
 *
 * RATE_LIMIT_STORE=memory (default) → per-process MemoryRateLimitStore
 * RATE_LIMIT_STORE=redis + REDIS_URL → shared RedisRateLimitStore
 *
 * `getRateLimitStore()` is synchronous so limiters built at module load can
 * use it. If Redis is requested but cannot be created (no REDIS_URL, client
 * package missing) the factory logs a warning and uses the memory store.
 * `initializeRateLimitStore()` (called at startup) additionally pings Redis
 * and falls back to memory if it is unreachable. Errors during normal
 * operation follow the fail-open / fail-closed policy in RateLimitStore.
 */

const log = require('../../utils/log');
const RateLimitStore = require('./RateLimitStore');
const MemoryRateLimitStore = require('./MemoryRateLimitStore');
const RedisRateLimitStore = require('./RedisRateLimitStore');
const ExpressRateLimitStore = require('./ExpressRateLimitStore');

let storeInstance = null;

/**
 * Create a Redis client using ioredis, or node-redis v4 as a fallback.
 *
 * @param {string} url
 * @returns {Object|null} client, or null if neither package is installed
 */
function createRedisClient(url) {
  try {
    const IORedis = require('ioredis');
    const client = new IORedis(url, { maxRetriesPerRequest: 1 });
    client.on('error', (err) => log.error('RATE_LIMIT', 'Redis client error', { error: err.message }));
    return client;
  } catch (ioredisErr) {
    log.debug('RATE_LIMIT', 'ioredis not available; trying redis package', { error: ioredisErr.message });
  }

  try {
    const redis = require('redis');
    const client = redis.createClient({ url });
    client.on('error', (err) => log.error('RATE_LIMIT', 'Redis client error', { error: err.message }));
    client.connect().catch((err) => {
      log.error('RATE_LIMIT', 'Redis connect failed', { error: err.message });
    });
    return client;
  } catch (redisErr) {
    log.warn('RATE_LIMIT', 'No Redis client package installed', { error: redisErr.message });
    return null;
  }
}

function createStore() {
  const storeType = (process.env.RATE_LIMIT_STORE || 'memory').toLowerCase();

  if (storeType === 'redis') {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      log.warn('RATE_LIMIT', 'RATE_LIMIT_STORE=redis but REDIS_URL is not set; using in-memory store');
      return new MemoryRateLimitStore();
    }
    const client = createRedisClient(redisUrl);
    if (!client) {
      log.warn('RATE_LIMIT', 'Redis requested but unavailable; using in-memory store');
      return new MemoryRateLimitStore();
    }
    log.info('RATE_LIMIT', 'Using Redis rate limit store');
    return new RedisRateLimitStore(client);
  }

  return new MemoryRateLimitStore();
}

/**
 * Return the shared store, creating it on first use.
 *
 * @returns {RateLimitStore}
 */
function getRateLimitStore() {
  if (!storeInstance) storeInstance = createStore();
  return storeInstance;
}

/**
 * Startup check: verify the configured store is reachable. If Redis does not
 * answer, switch to the in-memory store and log it, so the process does not
 * run every request through the store-error path.
 *
 * @returns {Promise<RateLimitStore>}
 */
async function initializeRateLimitStore() {
  const store = getRateLimitStore();
  let healthy = false;
  try {
    healthy = await store.isHealthy();
  } catch (err) {
    log.error('RATE_LIMIT', 'Rate limit store health check threw', { error: err.message });
  }

  if (!healthy && store instanceof RedisRateLimitStore) {
    log.warn('RATE_LIMIT', 'Redis rate limit store unhealthy at startup; falling back to in-memory store');
    await store.shutdown();
    storeInstance = new MemoryRateLimitStore();
  }
  return storeInstance;
}

/**
 * Shutdown the current store. Called during application shutdown.
 *
 * @returns {Promise<void>}
 */
async function shutdownRateLimitStore() {
  if (!storeInstance) return;
  try {
    await storeInstance.shutdown();
  } catch (error) {
    log.warn('RATE_LIMIT', 'Error shutting down rate limit store', { error: error.message });
  }
  storeInstance = null;
}

/**
 * Replace (or with no argument, drop) the singleton. Tests only.
 *
 * @param {RateLimitStore} [store]
 */
function resetStore(store = null) {
  storeInstance = store;
}

module.exports = {
  getRateLimitStore,
  initializeRateLimitStore,
  shutdownRateLimitStore,
  resetStore,
  RateLimitStore,
  MemoryRateLimitStore,
  RedisRateLimitStore,
  ExpressRateLimitStore,
};
