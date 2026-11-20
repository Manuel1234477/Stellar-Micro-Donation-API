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
const timerRegistry = require('../utils/timerRegistry');
const leaderElection = require('../utils/leaderElection');
const metrics = require('../utils/metrics');

const MAX_QUEUE_ATTEMPTS = 10;
const BATCH_SIZE = 50;
const DEFAULT_INTERVAL_MS = 30 * 1000; // 30 seconds
const LOCK_NAME = 'process_donation_queue_job';

/** Handle returned by timerRegistry.createInterval — used by stop(). */
let _timerHandle = null;

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

/**
 * Get the age (in seconds) of the oldest queued donation.
 * @returns {Promise<number>} 0 when the queue is empty.
 */
async function getOldestQueuedAgeSeconds() {
  const row = await Database.get(
    `SELECT MIN(queuedAt) as oldest FROM donations
     WHERE status = ? AND deletedAt IS NULL`,
    [TRANSACTION_STATES.QUEUED]
  );
  if (!row || !row.oldest) return 0;
  const oldest = new Date(row.oldest).getTime();
  if (Number.isNaN(oldest)) return 0;
  return Math.max(0, Math.floor((Date.now() - oldest) / 1000));
}

/**
 * Publish queue depth/age gauges and process one batch (leader-only).
 */
async function runOnce() {
  try {
    const depth = await getQueueDepth();
    const oldestAgeSeconds = await getOldestQueuedAgeSeconds();
    metrics.setDonationQueueDepth(depth);
    metrics.setDonationQueueOldestAgeSeconds(oldestAgeSeconds);
  } catch (err) {
    log.warn('QUEUE_PROCESSOR', 'Failed to collect queue metrics', { error: err.message });
  }

  const isLeader = await leaderElection.acquireLease(LOCK_NAME, DEFAULT_INTERVAL_MS * 2);
  if (!isLeader) {
    log.debug('QUEUE_PROCESSOR', 'Skipping queue tick — lease held by another instance');
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  try {
    const result = await processBatch();
    if (result.processed > 0) {
      log.info('QUEUE_PROCESSOR', 'Queue batch processed', result);
    }
    return result;
  } catch (err) {
    log.error('QUEUE_PROCESSOR', 'Queue processing tick failed', { error: err.message });
    return { processed: 0, succeeded: 0, failed: 0 };
  }
}

/**
 * Start the queued-donation processor.
 *
 * @param {number} [intervalMs=DEFAULT_INTERVAL_MS] - How often to process the queue.
 */
function start(intervalMs = DEFAULT_INTERVAL_MS) {
  if (_timerHandle) return;
  _timerHandle = timerRegistry.createInterval(runOnce, intervalMs, 'process-donation-queue-job');
  _timerHandle.unref();
  log.info('QUEUE_PROCESSOR', 'Queued donation processor started', { intervalMs });
}

/**
 * Stop the queued-donation processor and clear the timer from the registry.
 * Safe to call even if the job was never started.
 */
function stop() {
  if (_timerHandle) {
    _timerHandle.clear();
    _timerHandle = null;
  }
}

module.exports = {
  processBatch,
  getQueueDepth,
  getOldestQueuedAgeSeconds,
  runOnce,
  start,
  stop,
};
