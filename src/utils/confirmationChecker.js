/**
 * Confirmation Checker Utility
 *
 * RESPONSIBILITY: Determine whether a Stellar transaction has accumulated
 *   enough ledger confirmations to be considered final, and provide polling
 *   mechanisms for background confirmation monitoring.
 * OWNER: Platform Team
 * DEPENDENCIES: confirmationThreshold config, StellarService, DonationService
 *
 * Stellar transactions are included in a specific ledger. Once that ledger
 * closes, subsequent ledgers build on top of it. The number of ledgers that
 * have closed *after* the transaction's ledger is the confirmation depth.
 *
 * A transaction is considered confirmed when:
 *   currentLedger - transactionLedger >= threshold
 */

const { CONFIRMATION_THRESHOLD } = require('../config/confirmationThreshold');
const log = require('./log');

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
    : CONFIRMATION_THRESHOLD;

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

/**
 * Fetch the current ledger sequence from Stellar Horizon API.
 * This is called periodically by background workers to check transaction confirmation depth.
 *
 * @param {Object} stellarService - Instance of StellarService with Horizon connection
 * @returns {Promise<number>} Current ledger sequence
 * @throws {Error} If unable to fetch ledger from Horizon
 */
async function getCurrentLedger(stellarService) {
  if (!stellarService || typeof stellarService.server !== 'object') {
    throw new Error('stellarService with server property is required');
  }

  try {
    const ledgers = await stellarService.server
      .ledgers()
      .order('desc')
      .limit(1)
      .call();

    if (!ledgers || !ledgers.records || ledgers.records.length === 0) {
      throw new Error('No ledger records returned from Horizon');
    }

    const currentLedger = ledgers.records[0].sequence;
    if (!Number.isInteger(currentLedger) || currentLedger < 1) {
      throw new Error(`Invalid ledger sequence: ${currentLedger}`);
    }

    return currentLedger;
  } catch (err) {
    log.error('CONFIRMATION_CHECKER', 'Failed to fetch current ledger from Horizon', {
      error: err.message,
      code: err.code,
    });
    throw err;
  }
}

/**
 * Check and update a single transaction's confirmation status.
 * Used by background workers to advance pending_confirmation transactions to confirmed.
 *
 * @param {Object} transaction - Transaction object with id, stellarLedger, status, confirmationThreshold
 * @param {Object} stellarService - Instance of StellarService
 * @param {Object} donationService - Instance of DonationService
 * @returns {Promise<{
 *   transactionId: string,
 *   updated: boolean,
 *   confirmed: boolean,
 *   confirmations: number,
 *   required: number,
 *   error?: string
 * }>}
 */
async function checkAndUpdateTransaction(transaction, stellarService, donationService) {
  if (!transaction || !transaction.id) {
    return {
      transactionId: null,
      updated: false,
      confirmed: false,
      error: 'Invalid transaction object',
    };
  }

  try {
    // Fetch current ledger
    const currentLedger = await getCurrentLedger(stellarService);

    // Use DonationService.confirmTransaction() which handles state transitions
    const result = donationService.confirmTransaction(
      transaction.id,
      currentLedger,
      transaction.confirmationThreshold
    );

    return {
      transactionId: transaction.id,
      updated: result.confirmed && transaction.status !== 'confirmed',
      confirmed: result.confirmed,
      confirmations: result.confirmations,
      required: result.required,
    };
  } catch (err) {
    log.error('CONFIRMATION_CHECKER', 'Error checking transaction confirmation', {
      transactionId: transaction.id,
      error: err.message,
    });
    return {
      transactionId: transaction.id,
      updated: false,
      confirmed: false,
      error: err.message,
    };
  }
}

/**
 * Check and update all transactions in pending_confirmation state.
 * Meant to be called periodically by background workers.
 *
 * @param {Object} stellarService - Instance of StellarService
 * @param {Object} donationService - Instance of DonationService
 * @returns {Promise<{
 *   checked: number,
 *   updated: number,
 *   errors: number,
 *   details: Array
 * }>}
 */
async function checkAllPendingConfirmations(stellarService, donationService) {
  if (!stellarService || !donationService) {
    throw new Error('stellarService and donationService are required');
  }

  try {
    // Get all transactions in pending_confirmation state
    const Transaction = require('../models/transaction');
    const { TRANSACTION_STATES } = require('./transactionStateMachine');
    
    const pendingTransactions = Transaction.getByStatus(TRANSACTION_STATES.PENDING_CONFIRMATION);
    log.debug('CONFIRMATION_CHECKER', `Found ${pendingTransactions.length} transactions awaiting confirmation`);

    let updated = 0;
    let errors = 0;
    const details = [];

    for (const tx of pendingTransactions) {
      const result = await checkAndUpdateTransaction(tx, stellarService, donationService);
      details.push(result);

      if (result.updated) {
        updated++;
        log.info('CONFIRMATION_CHECKER', 'Transaction confirmed and updated', {
          transactionId: result.transactionId,
          confirmations: result.confirmations,
          required: result.required,
        });
      }

      if (result.error) {
        errors++;
      }
    }

    return {
      checked: pendingTransactions.length,
      updated,
      errors,
      details,
    };
  } catch (err) {
    log.error('CONFIRMATION_CHECKER', 'Error during batch confirmation check', {
      error: err.message,
    });
    throw err;
  }
}

module.exports = {
  checkConfirmations,
  assertConfirmed,
  getCurrentLedger,
  checkAndUpdateTransaction,
  checkAllPendingConfirmations,
};
