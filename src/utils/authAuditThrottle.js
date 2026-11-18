/**
 * Authentication Audit Throttle
 *
 * RESPONSIBILITY: Bound how often a repeated authentication event (for example,
 * a missing or invalid key from the same IP) is written to the audit log.
 * OWNER: Platform Team
 * DEPENDENCIES: none
 *
 * Every rejected request is still counted in metrics. Only the first event per
 * key per window produces an audit row, so an unauthenticated client cannot
 * turn each request into a SQLite write (see issue #1887).
 */

const MAX_TRACKED_KEYS = 10000;
const lastAllowedAt = new Map();

/**
 * Returns true at most once per `windowMs` for a given key.
 * @param {string} key Identifier such as `missing:<ip>` or `legacy:<hash>`
 * @param {number} windowMs Minimum time between allowed events for this key
 * @param {number} [now=Date.now()] Current time in milliseconds
 * @returns {boolean} Whether the caller should write the audit row
 */
function allowAuditEvent(key, windowMs, now = Date.now()) {
  const last = lastAllowedAt.get(key);
  if (last !== undefined && now - last < windowMs) {
    return false;
  }

  // Re-insert so the Map's insertion order tracks recency for eviction
  lastAllowedAt.delete(key);
  lastAllowedAt.set(key, now);

  if (lastAllowedAt.size > MAX_TRACKED_KEYS) {
    const oldest = lastAllowedAt.keys().next().value;
    lastAllowedAt.delete(oldest);
  }
  return true;
}

/** Clears all tracked keys. Intended for tests. */
function resetAuditThrottle() {
  lastAllowedAt.clear();
}

module.exports = {
  allowAuditEvent,
  resetAuditThrottle,
  MAX_TRACKED_KEYS,
};
