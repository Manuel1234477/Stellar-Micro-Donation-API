/**
 * Best-effort side effects (#1946).
 *
 * Audit writes, webhook deliveries, lease releases and cleanup are allowed to
 * fail without failing the request, but a failure must never be silent. These
 * helpers log the failure at `warn` with the call site and bump
 * `best_effort_failures_total{site}`.
 *
 * Do NOT use these for writes that are part of a business outcome (for example
 * a refund ledger row). Those must propagate the error.
 *
 * @module bestEffort
 */

'use strict';

const log = require('./log');
const { recordBestEffortFailure } = require('./metrics');

/**
 * Report a failed best-effort operation. Never throws.
 *
 * @param {string} site - Call-site label, e.g. "routes/tiers.js:62"
 * @param {unknown} err - The caught error
 * @param {Object} [context={}] - Extra structured context (no secrets)
 */
function reportBestEffortFailure(site, err, context = {}) {
  try {
    log.warn('BEST_EFFORT', 'Best-effort operation failed', {
      site,
      error: err && err.message ? err.message : String(err),
      ...context,
    });
    recordBestEffortFailure(site);
  } catch (_) {
    // Reporting must not throw back into the request path.
  }
}

/**
 * Build a `.catch()` handler for a best-effort promise.
 *
 * @example
 * AuditLogService.log({ ... }).catch(bestEffort('routes/tiers.js:62'));
 *
 * @param {string} site - Call-site label
 * @param {Object} [context={}] - Extra structured context
 * @returns {(err: unknown) => void}
 */
function bestEffort(site, context = {}) {
  return (err) => reportBestEffortFailure(site, err, context);
}

module.exports = { bestEffort, reportBestEffortFailure };
