/**
 * Confirmation Checker Utility
 *
 * RESPONSIBILITY: Determine whether a Stellar transaction has accumulated
 *   enough ledger confirmations to be considered final.
 * OWNER: Platform Team
 * DEPENDENCIES: confirmationThreshold config
 *
 * Stellar transactions are included in a specific ledger. Once that ledger
 * closes, subsequent ledgers build on top of it. The number of ledgers that
 * have closed *after* the transaction's ledger is the confirmation depth.
 *
 * A transaction is considered confirmed when:
 *   currentLedger - transactionLedger >= threshold
 */

const { CONFIRMATION_LEDGER_THRESHOLD } = require('../config/confirmationThreshold');

/**
 * Check whether a transaction has met the confirmation threshold.
 *
 * @param {number} transactionLedger - The ledger sequence the transaction was included in
 * @param {number} currentLedger     - The latest known ledger sequence on the network
 * @param {number} [threshold]       - Override the configured threshold (useful in tests)
 * @returns {{
 *   confirmed: boolean,
 *   confirmations: number,
 *   required: number,
 *   transactionLedger: number,
 *   currentLedger: number
 * }}
 */
function checkConfirmations(transactionLedger, currentLedger, threshold) {
  if (typeof transactionLedger !== 'number' || !Number.isFinite(transactionLedger) || transactionLedger < 1) {
    throw new Error('transactionLedger must be a positive finite number');
  }
  if (typeof currentLedger !== 'number' || !Number.isFinite(currentLedger) || currentLedger < 1) {
    throw new Error('currentLedger must be a positive finite number');
  }

  const required = (threshold !== undefined && Number.isFinite(threshold) && threshold >= 1)
    ? threshold
    : CONFIRMATION_LEDGER_THRESHOLD;

  const confirmations = Math.max(0, currentLedger - transactionLedger);
  const confirmed = confirmations >= required;

  return {
    confirmed,
    confirmations,
    required,
    transactionLedger,
    currentLedger,
  };
}

/**
 * Assert that a transaction is sufficiently confirmed.
 * Throws if the threshold has not been met.
 *
 * @param {number} transactionLedger
 * @param {number} currentLedger
 * @param {number} [threshold]
 * @throws {Error} When confirmation threshold is not met
 */
function assertConfirmed(transactionLedger, currentLedger, threshold) {
  const result = checkConfirmations(transactionLedger, currentLedger, threshold);
  if (!result.confirmed) {
    const err = new Error(
      `Transaction not yet sufficiently confirmed. ` +
      `Confirmations: ${result.confirmations}/${result.required} ` +
      `(tx ledger: ${transactionLedger}, current ledger: ${currentLedger})`
    );
    err.code = 'INSUFFICIENT_CONFIRMATIONS';
    err.details = result;
    throw err;
  }
  return result;
}

module.exports = {
  checkConfirmations,
  assertConfirmed,
};
