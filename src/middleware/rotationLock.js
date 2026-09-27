/**
 * Rotation Lock Middleware
 *
 * Checks if a key rotation is in progress and returns HTTP 503 if so.
 * Used to prevent donations from being created with inconsistent encryption keys
 * during a key rotation operation.
 *
 * Caching (#1697): the lock is read from the rotation_locks table at most once
 * per ROTATION_LOCK_CACHE_TTL_MS (default 5s) per key, not on every request.
 * setRotationStatus() invalidates the cache in-process; rotations started from
 * another process (src/scripts/rotateKEK.js) are observed within one TTL, and
 * that script waits getCacheTtlMs() after taking the lock before writing.
 *
 * Failure policy — FAIL-OPEN: if the lock cannot be read (e.g. the
 * rotation_locks table does not exist yet, or the query fails), requests are
 * allowed through. The lock only guards against mixed-key writes while a
 * rotation is running; a rotation cannot be started without a readable
 * rotation_locks table, and a genuinely unavailable database will fail the
 * request downstream anyway. The failure is cached for one TTL and logged as a
 * single WARN per ROTATION_LOCK_WARN_INTERVAL_MS (default 60s) per key rather
 * than once per request.
 */

'use strict';

const Database = require('../utils/database');
const log = require('../utils/log');

const RETRY_AFTER_SECONDS = 5;
const DEFAULT_CACHE_TTL_MS = 5000;
const DEFAULT_WARN_INTERVAL_MS = 60000;

/** @type {Map<string, {inProgress: boolean, startedAt: string|null, fetchedAt: number}>} */
const _cache = new Map();
/** @type {Map<string, Promise<object>>} in-flight lookups, so concurrent requests share one query */
const _pending = new Map();
/** @type {Map<string, {lastWarnAt: number, suppressed: number}>} */
const _warnState = new Map();

function parseNonNegativeInt(raw, fallback) {
  const value = parseInt(raw, 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * Cache TTL for the rotation lock status, in milliseconds.
 * @returns {number}
 */
function getCacheTtlMs() {
  return parseNonNegativeInt(process.env.ROTATION_LOCK_CACHE_TTL_MS, DEFAULT_CACHE_TTL_MS);
}

function warnLockUnreadable(keyName, err) {
  const now = Date.now();
  const interval = parseNonNegativeInt(process.env.ROTATION_LOCK_WARN_INTERVAL_MS, DEFAULT_WARN_INTERVAL_MS);
  const state = _warnState.get(keyName) || { lastWarnAt: -Infinity, suppressed: 0 };

  if (now - state.lastWarnAt < interval) {
    state.suppressed++;
    _warnState.set(keyName, state);
    return;
  }

  log.warn('ROTATION_LOCK', 'Cannot read rotation status; allowing requests (fail-open)', {
    error: err.message,
    keyName,
    suppressedSinceLastWarning: state.suppressed,
  });
  _warnState.set(keyName, { lastWarnAt: now, suppressed: 0 });
}

async function fetchLockState(keyName) {
  try {
    const row = await Database.get(
      'SELECT status, startedAt FROM rotation_locks WHERE name = ?',
      [keyName]
    );
    return { inProgress: Boolean(row && row.status === 'in_progress'), startedAt: row ? row.startedAt : null };
  } catch (err) {
    warnLockUnreadable(keyName, err);
    return { inProgress: false, startedAt: null };
  }
}

/**
 * Resolve the (possibly cached) lock state for a key.
 * @param {string} keyName
 * @returns {Promise<{inProgress: boolean, startedAt: string|null}>}
 */
async function getLockState(keyName) {
  const cached = _cache.get(keyName);
  if (cached && Date.now() - cached.fetchedAt < getCacheTtlMs()) {
    return cached;
  }

  if (!_pending.has(keyName)) {
    const lookup = fetchLockState(keyName).then((state) => {
      const entry = { ...state, fetchedAt: Date.now() };
      // Only cache if the lookup was not invalidated while it was in flight
      if (_pending.get(keyName) === lookup) {
        _cache.set(keyName, entry);
        _pending.delete(keyName);
      }
      return entry;
    });
    _pending.set(keyName, lookup);
  }
  return _pending.get(keyName);
}

/**
 * Drop cached lock state so the next request re-reads the table.
 * @param {string} [keyName] - Key to invalidate; all keys when omitted.
 */
function invalidateRotationLockCache(keyName) {
  if (keyName === undefined) {
    _cache.clear();
    _pending.clear();
    _warnState.clear();
  } else {
    _cache.delete(keyName);
    _pending.delete(keyName);
    _warnState.delete(keyName);
  }
}

/**
 * Middleware that checks rotation status before allowing write operations
 * @param {string} keyName - The key being rotated (e.g., 'memoEncryption')
 * @returns {Function} Express middleware
 */
function rotationLockMiddleware(keyName = 'memoEncryption') {
  return async (req, res, next) => {
    const lock = await getLockState(keyName);

    if (lock.inProgress) {
      log.warn('ROTATION_LOCK', `Key rotation in progress for ${keyName}`, {
        requestId: req.id,
        startedAt: lock.startedAt,
        keyName,
      });

      return res
        .status(503)
        .set('Retry-After', String(RETRY_AFTER_SECONDS))
        .json({
          success: false,
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Service temporarily unavailable due to key rotation',
          },
        });
    }

    return next();
  };
}

/**
 * Get current rotation status for a key
 * @param {string} keyName
 * @returns {Promise<{status: string, startedAt: string|null, completedAt: string|null, error: string|null}>}
 */
async function getRotationStatus(keyName = 'memoEncryption') {
  const row = await Database.get(
    'SELECT status, startedAt, completedAt, error FROM rotation_locks WHERE name = ?',
    [keyName]
  );

  if (!row) {
    return { status: 'unknown', startedAt: null, completedAt: null, error: null };
  }

  return {
    status: row.status,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    error: row.error,
  };
}

/**
 * Set rotation status
 * @param {string} keyName
 * @param {string} status - 'idle', 'in_progress', or 'failed'
 * @param {Object} options
 * @param {string} [options.error] - Error message if status is 'failed'
 */
async function setRotationStatus(keyName = 'memoEncryption', status, options = {}) {
  const { error } = options;

  const updates = {
    status,
    updatedAt: new Date().toISOString(),
  };

  if (status === 'in_progress') {
    updates.startedAt = new Date().toISOString();
    updates.completedAt = null;
    updates.error = null;
  } else if (status === 'idle') {
    updates.completedAt = new Date().toISOString();
    updates.error = null;
  } else if (status === 'failed') {
    updates.completedAt = new Date().toISOString();
    updates.error = error || 'Unknown error';
  }

  const setClauses = Object.keys(updates).map(key => `${key} = ?`).join(', ');
  const values = Object.values(updates);

  try {
    await Database.run(
      `UPDATE rotation_locks SET ${setClauses} WHERE name = ?`,
      [...values, keyName]
    );
  } finally {
    invalidateRotationLockCache(keyName);
  }
}

module.exports = {
  rotationLockMiddleware,
  getRotationStatus,
  setRotationStatus,
  invalidateRotationLockCache,
  getCacheTtlMs,
};
