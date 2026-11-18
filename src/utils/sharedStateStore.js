'use strict';

/**
 * SharedStateStore (#1786)
 *
 * RESPONSIBILITY: Small key/value + expiring-set store for state that must be
 *   consistent across every replica: body-hash deduplication, request-signing
 *   nonces and SSE per-key connection limits.
 * OWNER: Platform Team
 * DEPENDENCIES: ioredis (optional, only when SHARED_STATE_BACKEND=redis)
 *
 * Backends:
 *   memory (default) — per-process. Correct for a single replica only.
 *   redis            — shared by every replica pointing at the same Redis.
 *
 * Every method is async so callers do not depend on the backend.
 * Values are JSON-serialised. TTLs are in milliseconds.
 *
 * See docs/architecture/multi-instance-state.md for which features need the
 * redis backend when running more than one replica.
 */

const log = require('./log');
const { readEnv } = require('../config/env');

/**
 * Interface. Implementations must provide every method.
 * @abstract
 */
class SharedStateStore {
  /** True when state is visible to other processes. */
  get isDistributed() { return false; }
  /** @returns {Promise<*|null>} */
  async get(_key) { throw new Error('not implemented'); }
  /** @returns {Promise<void>} */
  async set(_key, _value, _ttlMs) { throw new Error('not implemented'); }
  /** Store only if the key does not exist. @returns {Promise<boolean>} true if stored */
  async setIfAbsent(_key, _value, _ttlMs) { throw new Error('not implemented'); }
  /** @returns {Promise<void>} */
  async delete(_key) { throw new Error('not implemented'); }
  /**
   * Add (or refresh) `member` in the expiring set `setKey`.
   * @returns {Promise<number>} live member count after the add
   */
  async addMember(_setKey, _member, _ttlMs) { throw new Error('not implemented'); }
  /** @returns {Promise<void>} */
  async removeMember(_setKey, _member) { throw new Error('not implemented'); }
  /** @returns {Promise<number>} live member count */
  async countMembers(_setKey) { throw new Error('not implemented'); }
  async close() {}
}

/** Per-process implementation. */
class MemorySharedStateStore extends SharedStateStore {
  constructor() {
    super();
    /** @type {Map<string, {value: *, expiresAt: number}>} */
    this._values = new Map();
    /** @type {Map<string, Map<string, number>>} setKey -> member -> expiresAt */
    this._sets = new Map();
  }

  _live(key) {
    const entry = this._values.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this._values.delete(key);
      return null;
    }
    return entry;
  }

  _members(setKey) {
    const members = this._sets.get(setKey);
    if (!members) return null;
    const now = Date.now();
    for (const [m, exp] of members) if (exp <= now) members.delete(m);
    if (members.size === 0) {
      this._sets.delete(setKey);
      return null;
    }
    return members;
  }

  async get(key) {
    const entry = this._live(key);
    return entry ? entry.value : null;
  }

  async set(key, value, ttlMs) {
    this._values.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  async setIfAbsent(key, value, ttlMs) {
    if (this._live(key)) return false;
    this._values.set(key, { value, expiresAt: Date.now() + ttlMs });
    return true;
  }

  async delete(key) {
    this._values.delete(key);
  }

  async addMember(setKey, member, ttlMs) {
    let members = this._members(setKey);
    if (!members) {
      members = new Map();
      this._sets.set(setKey, members);
    }
    members.set(String(member), Date.now() + ttlMs);
    return members.size;
  }

  async removeMember(setKey, member) {
    const members = this._sets.get(setKey);
    if (members) {
      members.delete(String(member));
      if (members.size === 0) this._sets.delete(setKey);
    }
  }

  async countMembers(setKey) {
    const members = this._members(setKey);
    return members ? members.size : 0;
  }

  /** Drop everything (tests). */
  clear() {
    this._values.clear();
    this._sets.clear();
  }
}

/**
 * Redis implementation (ioredis client API).
 * Expiring sets are sorted sets scored by expiry time.
 */
class RedisSharedStateStore extends SharedStateStore {
  /**
   * @param {object} client - ioredis client
   * @param {object} [options]
   * @param {string} [options.prefix]
   * @param {boolean} [options.failOpen] - fall back to per-process state on Redis errors
   */
  constructor(client, { prefix = 'smd:', failOpen = true } = {}) {
    super();
    this._client = client;
    this._prefix = prefix;
    this._failOpen = failOpen;
    this._fallback = new MemorySharedStateStore();
  }

  get isDistributed() { return true; }

  _k(key) { return this._prefix + key; }

  async _run(op, key, fn, fallbackFn) {
    try {
      return await fn();
    } catch (err) {
      log.error('SHARED_STATE', 'Redis operation failed', {
        op,
        key,
        error: err.message,
        policy: this._failOpen ? 'fail-open' : 'fail-closed',
      });
      if (!this._failOpen) throw err;
      return fallbackFn();
    }
  }

  async get(key) {
    return this._run('get', key, async () => {
      const raw = await this._client.get(this._k(key));
      return raw === null || raw === undefined ? null : JSON.parse(raw);
    }, () => this._fallback.get(key));
  }

  async set(key, value, ttlMs) {
    return this._run('set', key, async () => {
      await this._client.set(this._k(key), JSON.stringify(value), 'PX', Math.max(1, Math.ceil(ttlMs)));
    }, () => this._fallback.set(key, value, ttlMs));
  }

  async setIfAbsent(key, value, ttlMs) {
    return this._run('setIfAbsent', key, async () => {
      const res = await this._client.set(
        this._k(key), JSON.stringify(value), 'PX', Math.max(1, Math.ceil(ttlMs)), 'NX'
      );
      return res === 'OK';
    }, () => this._fallback.setIfAbsent(key, value, ttlMs));
  }

  async delete(key) {
    return this._run('delete', key, async () => {
      await this._client.del(this._k(key));
    }, () => this._fallback.delete(key));
  }

  async addMember(setKey, member, ttlMs) {
    return this._run('addMember', setKey, async () => {
      const k = this._k(setKey);
      const now = Date.now();
      const results = await this._client
        .multi()
        .zremrangebyscore(k, '-inf', now)
        .zadd(k, now + ttlMs, String(member))
        .pexpire(k, Math.max(1, Math.ceil(ttlMs)))
        .zcard(k)
        .exec();
      const [err, count] = results[results.length - 1];
      if (err) throw err;
      return Number(count);
    }, () => this._fallback.addMember(setKey, member, ttlMs));
  }

  async removeMember(setKey, member) {
    return this._run('removeMember', setKey, async () => {
      await this._client.zrem(this._k(setKey), String(member));
    }, () => this._fallback.removeMember(setKey, member));
  }

  async countMembers(setKey) {
    return this._run('countMembers', setKey, async () => {
      return Number(await this._client.zcount(this._k(setKey), `(${Date.now()}`, '+inf'));
    }, () => this._fallback.countMembers(setKey));
  }

  async close() {
    try {
      if (this._client && typeof this._client.quit === 'function') await this._client.quit();
    } catch (_) { /* already closed */ }
  }
}

let _instance = null;

/**
 * Return the process-wide store selected by SHARED_STATE_BACKEND.
 * Falls back to the memory backend (with a warning) when Redis is requested
 * but no client can be created.
 *
 * @returns {SharedStateStore}
 */
function getSharedStateStore() {
  if (_instance) return _instance;

  const backend = readEnv('SHARED_STATE_BACKEND');
  if (backend === 'redis') {
    const url = readEnv('SHARED_STATE_REDIS_URL') || readEnv('REDIS_URL');
    try {
      if (!url) throw new Error('SHARED_STATE_REDIS_URL or REDIS_URL must be set');
      const Redis = require('ioredis');
      _instance = new RedisSharedStateStore(new Redis(url), {
        prefix: readEnv('SHARED_STATE_KEY_PREFIX'),
        failOpen: readEnv('SHARED_STATE_FAIL_OPEN'),
      });
      log.info('SHARED_STATE', 'Using Redis shared-state backend');
      return _instance;
    } catch (err) {
      log.warn('SHARED_STATE', 'Redis shared-state backend unavailable; using per-process memory. '
        + 'Deduplication, nonces and SSE limits will NOT be shared across replicas.', { error: err.message });
    }
  }

  _instance = new MemorySharedStateStore();
  return _instance;
}

/** Replace the process-wide store (tests, or custom wiring at boot). */
function setSharedStateStore(store) {
  _instance = store;
}

/** Forget the current store so the next call re-reads configuration (tests). */
function resetSharedStateStore() {
  _instance = null;
}

module.exports = {
  SharedStateStore,
  MemorySharedStateStore,
  RedisSharedStateStore,
  getSharedStateStore,
  setSharedStateStore,
  resetSharedStateStore,
};
