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
 *
 * Each statement is issued through db.run(): the Database facade has no exec()
 * method, and every other migration uses run/all/get.
 */

exports.name = '041_queued_donations';

exports.up = async (db) => {
  // Add queued tracking columns
  await db.run('ALTER TABLE donations ADD COLUMN queuedAt TEXT');
  await db.run('ALTER TABLE donations ADD COLUMN queueAttempts INTEGER DEFAULT 0');
  await db.run('ALTER TABLE donations ADD COLUMN lastQueueError TEXT');

  // Create index for queued donation queries
  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_donations_queued
    ON donations(status, queuedAt)
    WHERE status = 'queued' AND deletedAt IS NULL
  `);
};

exports.down = async (db) => {
  await db.run('DROP INDEX IF EXISTS idx_donations_queued');
  await db.run('ALTER TABLE donations DROP COLUMN queuedAt');
  await db.run('ALTER TABLE donations DROP COLUMN queueAttempts');
  await db.run('ALTER TABLE donations DROP COLUMN lastQueueError');
};
