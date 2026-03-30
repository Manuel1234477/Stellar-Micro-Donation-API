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
 * Increase CONFIRMATION_LEDGER_THRESHOLD for higher-value transactions that
 * warrant extra certainty before being marked confirmed.
 *
 * Environment variables:
 *   CONFIRMATION_LEDGER_THRESHOLD  Number of ledgers to wait (default: 1, min: 1)
 */

const log = require('../utils/log');

const DEFAULT_THRESHOLD = 1;
const MIN_THRESHOLD = 1;

/**
 * Load and validate the confirmation threshold from environment.
 * @returns {number} Validated ledger confirmation threshold
 */
function loadConfirmationThreshold() {
  const raw = process.env.CONFIRMATION_LEDGER_THRESHOLD;

  if (raw === undefined || raw === null || raw === '') {
    return DEFAULT_THRESHOLD;
  }

  const parsed = parseInt(raw, 10);

  if (isNaN(parsed) || parsed < MIN_THRESHOLD) {
    log.warn('CONFIRMATION_THRESHOLD', `Invalid CONFIRMATION_LEDGER_THRESHOLD "${raw}", using default ${DEFAULT_THRESHOLD}`);
    return DEFAULT_THRESHOLD;
  }

  return parsed;
}

const CONFIRMATION_LEDGER_THRESHOLD = loadConfirmationThreshold();

module.exports = {
  CONFIRMATION_LEDGER_THRESHOLD,
  DEFAULT_THRESHOLD,
  MIN_THRESHOLD,
  loadConfirmationThreshold,
};
