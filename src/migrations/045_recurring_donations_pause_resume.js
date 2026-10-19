'use strict';

/**
 * Migration 045: Add pause/resume columns to recurring_donations
 *
 * Adds:
 * - pausedAt: timestamp when the schedule was last paused
 * - resumedAt: timestamp when the schedule was last resumed
 * - pauseReason: optional text explaining why the schedule was paused
 *
 * Also adds the columns the scheduler relies on for retry backoff and
 * execution bookkeeping (issue #1714):
 * - retryCount: number of consecutive failed attempts for the current run
 * - nextRetryAt: timestamp of the next retry attempt (NULL when not retrying)
 * - lastAttemptAt: timestamp of the most recent execution attempt
 */

exports.name = '045_recurring_donations_pause_resume';

exports.up = async (db) => {
  await db.run(`
    ALTER TABLE recurring_donations ADD COLUMN pausedAt DATETIME DEFAULT NULL
  `);

  await db.run(`
    ALTER TABLE recurring_donations ADD COLUMN resumedAt DATETIME DEFAULT NULL
  `);

  await db.run(`
    ALTER TABLE recurring_donations ADD COLUMN pauseReason TEXT DEFAULT NULL
  `);

  // Retry/backoff bookkeeping used by RecurringDonationScheduler (#1714)
  await db.run(`
    ALTER TABLE recurring_donations ADD COLUMN retryCount INTEGER DEFAULT 0
  `);

  await db.run(`
    ALTER TABLE recurring_donations ADD COLUMN nextRetryAt DATETIME DEFAULT NULL
  `);

  await db.run(`
    ALTER TABLE recurring_donations ADD COLUMN lastAttemptAt DATETIME DEFAULT NULL
  `);

  // Index for efficient lookups of paused schedules
  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_recurring_donations_status_pause
    ON recurring_donations(status, pausedAt)
  `);

  // Index supporting the "due now" query: active, non-paused schedules
  // whose nextExecutionDate (or nextRetryAt) is at or before now.
  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_recurring_donations_due
    ON recurring_donations(status, pausedAt, nextExecutionDate)
  `);
};

exports.down = async (db) => {
  await db.run('DROP INDEX IF EXISTS idx_recurring_donations_due');
  await db.run('DROP INDEX IF EXISTS idx_recurring_donations_status_pause');

  // SQLite does not support DROP COLUMN on older versions;
  // recreate the table without the new columns
  await db.run(`
    CREATE TABLE IF NOT EXISTS recurring_donations_backup AS
    SELECT id, donorId, recipientId, amount, frequency, nextExecutionDate,
           status, executionCount, cancelledAt, startDate, lastExecutedAt,
           failureCount, lastFailureReason, maxExecutions, intervalDays
    FROM recurring_donations
  `);

  await db.run('DROP TABLE recurring_donations');

  await db.run(`
    ALTER TABLE recurring_donations_backup RENAME TO recurring_donations
  `);
};
