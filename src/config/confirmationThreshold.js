/**
 * Confirmation Threshold Configuration
 *
 * RESPONSIBILITY: Define how many ledgers must close after a transaction's
 *   ledger before it is considered final.
 * OWNER: Platform Team
 *
 * Stellar closes a ledger roughly every 5 seconds. The default threshold of 1
 * means the transaction's ledger plus at least one subsequent ledger must have
 * closed — confirming the transaction is irreversibly included in the chain.
 *
 * Increase CONFIRMATION_THRESHOLD for higher-value transactions that
 * warrant extra certainty before being marked confirmed.
 *
 * Environment variables:
 *   CONFIRMATION_THRESHOLD  Number of ledgers to wait (default: 1, min: 1, max: 10)
 *   CONFIRMATION_LEDGER_THRESHOLD  (deprecated alias, falls back to CONFIRMATION_THRESHOLD)
 */

const log = require('../utils/log');

const DEFAULT_THRESHOLD = 1;
const MIN_THRESHOLD = 1;
const MAX_THRESHOLD = 10;

/**
 * Load and validate the confirmation threshold from environment.
 * Tries CONFIRMATION_THRESHOLD first, then CONFIRMATION_LEDGER_THRESHOLD for backwards compatibility.
 * @returns {number} Validated ledger confirmation threshold, clamped to [MIN_THRESHOLD, MAX_THRESHOLD]
 */
function loadConfirmationThreshold() {
  // Try new env var first, fall back to deprecated name
  let raw = process.env.CONFIRMATION_THRESHOLD || process.env.CONFIRMATION_LEDGER_THRESHOLD;

  if (raw === undefined || raw === null || raw === '') {
    return DEFAULT_THRESHOLD;
  }

  const parsed = parseInt(raw, 10);

  if (isNaN(parsed)) {
    log.warn('CONFIRMATION_THRESHOLD', `Invalid CONFIRMATION_THRESHOLD "${raw}", using default ${DEFAULT_THRESHOLD}`);
    return DEFAULT_THRESHOLD;
  }

  // Clamp to valid range
  if (parsed < MIN_THRESHOLD) {
    log.warn('CONFIRMATION_THRESHOLD', `CONFIRMATION_THRESHOLD "${parsed}" is below minimum ${MIN_THRESHOLD}, using ${MIN_THRESHOLD}`);
    return MIN_THRESHOLD;
  }

  if (parsed > MAX_THRESHOLD) {
    log.warn('CONFIRMATION_THRESHOLD', `CONFIRMATION_THRESHOLD "${parsed}" exceeds maximum ${MAX_THRESHOLD}, using ${MAX_THRESHOLD}`);
    return MAX_THRESHOLD;
  }

  return parsed;
}

const CONFIRMATION_THRESHOLD = loadConfirmationThreshold();

// Backwards compatibility alias
const CONFIRMATION_LEDGER_THRESHOLD = CONFIRMATION_THRESHOLD;

module.exports = {
  CONFIRMATION_THRESHOLD,
  CONFIRMATION_LEDGER_THRESHOLD,
  DEFAULT_THRESHOLD,
  MIN_THRESHOLD,
  MAX_THRESHOLD,
  loadConfirmationThreshold,
};
