'use strict';

/**
 * #1947: allow at most one in-flight ('processing') refund per donation.
 *
 * Concurrent refund attempts for the same donation would otherwise both
 * submit a reverse transaction. The partial index makes the database reject
 * the second attempt. If duplicate 'processing' rows already exist, index
 * creation fails and must be reconciled manually before re-running migrations.
 */
exports.name = '061_refunds_single_processing_index';

exports.up = async (db) => {
  await db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_refunds_one_processing_per_donation
    ON refunds(original_donation_id)
    WHERE status = 'processing'
  `);
};

exports.down = async (db) => {
  await db.run('DROP INDEX IF EXISTS idx_refunds_one_processing_per_donation');
};
