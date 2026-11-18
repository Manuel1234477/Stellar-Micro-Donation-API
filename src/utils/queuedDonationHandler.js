/**
 * Queued Donation Handler
 *
 * Handles graceful degradation when Horizon API is unreachable.
 * When the circuit breaker is open, donations are persisted as "queued" and
 * can be processed later when the API becomes available.
 */

'use strict';

const Database = require('./database');
const log = require('./log');
const { TRANSACTION_STATES } = require('./transactionStateMachine');

/**
 * Create a queued donation when Horizon is unavailable
 *
 * @param {Object} donation - Partially completed donation record
 * @param {string} reason - Why the donation was queued
 * @returns {Promise<Object>} The queued donation record
 */
async function createQueuedDonation(donation, reason = 'Horizon API unreachable') {
  const now = new Date().toISOString();

  const queuedDonation = {
    ...donation,
    status: TRANSACTION_STATES.QUEUED,
    queuedAt: now,
    queueAttempts: 0,
    lastQueueError: reason,
    updatedAt: now,
  };

  // Insert as queued donation
  const result = await Database.run(
    `INSERT INTO donations (
      status, amount, currency, donor, recipient, memo, sourceAsset,
      sourceAmount, notes, tags, anonymous, encryptMemo, campaign_id,
      queuedAt, queueAttempts, lastQueueError, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      queuedDonation.status,
      queuedDonation.amount,
      queuedDonation.currency || 'XLM',
      queuedDonation.donor || null,
      queuedDonation.recipient,
      queuedDonation.memo || null,
      queuedDonation.sourceAsset ? JSON.stringify(queuedDonation.sourceAsset) : null,
      queuedDonation.sourceAmount || null,
      queuedDonation.notes || null,
      queuedDonation.tags ? JSON.stringify(queuedDonation.tags) : null,
      queuedDonation.anonymous ? 1 : 0,
      queuedDonation.encryptMemo ? 1 : 0,
      queuedDonation.campaign_id || null,
      queuedDonation.queuedAt,
      queuedDonation.queueAttempts,
      queuedDonation.lastQueueError,
      queuedDonation.createdAt || now,
      queuedDonation.updatedAt,
    ]
  );

  log.info('QUEUED_DONATION', 'Donation queued for later processing', {
    donationId: result.id,
    reason,
    recipient: queuedDonation.recipient,
    amount: queuedDonation.amount,
  });

  return {
    id: result.id,
    status: TRANSACTION_STATES.QUEUED,
    amount: queuedDonation.amount,
    recipient: queuedDonation.recipient,
  };
}

/**
 * Get count of currently queued donations
 *
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
  createQueuedDonation,
  getQueueDepth,
};
