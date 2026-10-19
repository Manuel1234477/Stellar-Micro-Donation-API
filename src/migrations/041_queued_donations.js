/**
 * Migration 041: Add support for queued donations when Horizon is unavailable
 *
 * Adds:
 * - queuedAt: tracks when a donation was queued due to circuit breaker trip
 * - queueAttempts: count of retry attempts
 * - lastQueueError: description of the most recent queue processing error
 *
 * This allows donations to be accepted and persisted when Horizon API is
 * unreachable, with background processing to retry once the circuit breaker closes.
 */

exports.name = '041_queued_donations';

exports.up = async (db) => {
  // Add queued tracking columns
  await db.exec(`
    ALTER TABLE donations ADD COLUMN queuedAt TEXT;
    ALTER TABLE donations ADD COLUMN queueAttempts INTEGER DEFAULT 0;
    ALTER TABLE donations ADD COLUMN lastQueueError TEXT;
  `);

  // Create index for queued donation queries
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_donations_queued
    ON donations(status, queuedAt)
    WHERE status = 'queued' AND deletedAt IS NULL;
  `);
};

exports.down = async (db) => {
  await db.exec(`
    DROP INDEX IF EXISTS idx_donations_queued;
    ALTER TABLE donations DROP COLUMN queuedAt;
    ALTER TABLE donations DROP COLUMN queueAttempts;
    ALTER TABLE donations DROP COLUMN lastQueueError;
  `);
};
