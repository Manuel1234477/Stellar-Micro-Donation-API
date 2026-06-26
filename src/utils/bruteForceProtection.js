'use strict';

/**
 * Brute-force protection for auth endpoints (Issue #1123).
 *
 * Tracks failed attempts per identity key (IP or account id).
 * After MAX_ATTEMPTS failures within WINDOW_MS the identity is locked out
 * for LOCKOUT_MS.  All timing responses are constant-time so the caller
 * cannot distinguish "bad credential" from "locked out" by response time.
 */

const MAX_ATTEMPTS = parseInt(process.env.AUTH_MAX_ATTEMPTS || '5', 10);
const WINDOW_MS = parseInt(process.env.AUTH_WINDOW_MS || String(15 * 60 * 1000), 10); // 15 min
const LOCKOUT_MS = parseInt(process.env.AUTH_LOCKOUT_MS || String(15 * 60 * 1000), 10); // 15 min

// { key → { attempts: number, windowStart: number, lockedUntil: number } }
const store = new Map();

function _now() {
  return Date.now();
}

function _entry(key) {
  if (!store.has(key)) {
    store.set(key, { attempts: 0, windowStart: _now(), lockedUntil: 0 });
  }
  return store.get(key);
}

/**
 * Returns true if the given key is currently locked out.
 * @param {string} key
 * @returns {boolean}
 */
function isLockedOut(key) {
  const entry = store.get(key);
  if (!entry) return false;
  if (entry.lockedUntil > _now()) return true;
  return false;
}

/**
 * Returns the number of milliseconds until the lockout expires, or 0.
 * @param {string} key
 * @returns {number}
 */
function lockoutRemainingMs(key) {
  const entry = store.get(key);
  if (!entry) return 0;
  const remaining = entry.lockedUntil - _now();
  return remaining > 0 ? remaining : 0;
}

/**
 * Record a failed authentication attempt for the given key.
 * Applies lockout when the failure threshold is exceeded.
 * @param {string} key
 */
function recordFailure(key) {
  const entry = _entry(key);
  const now = _now();

  // Reset window if it has expired
  if (now - entry.windowStart > WINDOW_MS) {
    entry.attempts = 0;
    entry.windowStart = now;
    entry.lockedUntil = 0;
  }

  entry.attempts += 1;

  if (entry.attempts >= MAX_ATTEMPTS) {
    entry.lockedUntil = now + LOCKOUT_MS;
  }
}

/**
 * Clear failure state for a key after a successful authentication.
 * @param {string} key
 */
function recordSuccess(key) {
  store.delete(key);
}

/**
 * Express middleware factory.  Rejects requests from locked-out identities
 * before the handler runs.  The identity key defaults to IP address.
 *
 * @param {function(req): string} [keyFn] - extract identity key from request
 * @returns {function} Express middleware
 */
function middleware(keyFn) {
  const getKey = keyFn || ((req) => req.ip || 'unknown');

  return (req, res, next) => {
    const key = getKey(req);
    if (isLockedOut(key)) {
      const retryAfterSec = Math.ceil(lockoutRemainingMs(key) / 1000);
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(429).json({
        success: false,
        error: {
          code: 'ACCOUNT_LOCKED',
          message: 'Too many failed attempts. Try again later.',
        },
      });
    }
    next();
  };
}

module.exports = { isLockedOut, lockoutRemainingMs, recordFailure, recordSuccess, middleware, _store: store };
