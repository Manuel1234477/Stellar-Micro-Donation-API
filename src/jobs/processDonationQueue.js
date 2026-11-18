/**
 * Process queued donations when Horizon API becomes available
 *
 * This job runs periodically (every 30 seconds) to process donations that were
 * queued due to circuit breaker trip. Donations are retried and transitioned
 * from `queued` to `submitted` or `failed`.
 *
 * Respects the circuit breaker state and backs off if it's still open.
 */

'use strict';

const Database = require('../utils/database');
const log = require('../utils/log');
const { getStellarService } = require('../config/stellar');
const { circuitBreaker } = require('../utils/circuitBreaker');
const { TRANSACTION_STATES } = require('../utils/transactionStateMachine');

const MAX_QUEUE_ATTEMPTS = 10;
const BATCH_SIZE = 50;

/**
 * Process one batch of queued donations
 * @param {number} batchSize - How many to process at once
 * @returns {Promise<{processed: number, succeeded: number, failed: number}>}
 */
async function processBatch(batchSize = BATCH_SIZE) {
  // Check if circuit breaker is still open
  if (circuitBreaker.isOpen()) {
    log.debug('QUEUE_PROCESSOR', 'Circuit breaker is open, skipping queue processing');
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  // Fetch queued donations that haven't exceeded max retries
  const queuedDonations = await Database.query(
    `SELECT id, data, queueAttempts, memo
     FROM donations
     WHERE status = ? AND queueAttempts < ? AND deletedAt IS NULL
     ORDER BY queuedAt ASC
     LIMIT ?`,
    [TRANSACTION_STATES.QUEUED, MAX_QUEUE_ATTEMPTS, batchSize]
  );

  if (queuedDonations.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  const stellarService = getStellarService();
  let succeeded = 0;
  let failed = 0;

  for (const donation of queuedDonations) {
    try {
      const donationData = typeof donation.data === 'string' ? JSON.parse(donation.data) : donation.data;

      // Submit the queued donation to Stellar
      const txResult = await stellarService.submitTransaction({
        sourceAccount: donationData.sourceAccount,
        amount: donationData.amount,
        destination: donationData.destination,
        asset: donationData.asset,
        memo: donation.memo,
        fee: donationData.fee,
      });

      // Update donation status to submitted
      await Database.run(
        `UPDATE donations
         SET status = ?, stellarTxId = ?, queueAttempts = queueAttempts + 1, lastQueueError = NULL, updatedAt = ?
         WHERE id = ?`,
        [TRANSACTION_STATES.SUBMITTED, txResult.hash, new Date().toISOString(), donation.id]
      );

      log.info('QUEUE_PROCESSOR', 'Successfully processed queued donation', {
        donationId: donation.id,
        stellarTxId: txResult.hash,
      });

      succeeded++;
    } catch (err) {
      // Update error count and message, but don't fail immediately
      await Database.run(
        `UPDATE donations
         SET queueAttempts = queueAttempts + 1, lastQueueError = ?, updatedAt = ?
         WHERE id = ?`,
        [err.message, new Date().toISOString(), donation.id]
      );

      // If max attempts exceeded, fail the donation
      if (donation.queueAttempts + 1 >= MAX_QUEUE_ATTEMPTS) {
        await Database.run(
          `UPDATE donations
           SET status = ?, lastQueueError = ?, updatedAt = ?
           WHERE id = ?`,
          [TRANSACTION_STATES.FAILED, `Queue processing failed after ${MAX_QUEUE_ATTEMPTS} attempts: ${err.message}`, new Date().toISOString(), donation.id]
        );

        log.error('QUEUE_PROCESSOR', 'Donation exceeded max queue attempts', {
          donationId: donation.id,
          attempts: donation.queueAttempts + 1,
          error: err.message,
        });
      } else {
        log.warn('QUEUE_PROCESSOR', 'Failed to process queued donation, will retry', {
          donationId: donation.id,
          attempt: donation.queueAttempts + 1,
          maxAttempts: MAX_QUEUE_ATTEMPTS,
          error: err.message,
        });
      }

      failed++;
    }
  }

  return { processed: queuedDonations.length, succeeded, failed };
}

/**
 * Get count of currently queued donations
 * @returns {Promise<number>}
 */
async function getQueueDepth() {
  const row = await Database.get(
    'SELECT COUNT(*) as count FROM donations WHERE status = ? AND deletedAt IS NULL',
    [TRANSACTION_STATES.QUEUED]
  );
  return row?.count || 0;
}

module.exports = {
  processBatch,
  getQueueDepth,
};
