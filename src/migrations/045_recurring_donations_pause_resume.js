'use strict';

/**
 * Migration 045: Add pause/resume columns to recurring_donations
 *
 * Adds:
 * - pausedAt: timestamp when the schedule was last paused
 * - resumedAt: timestamp when the schedule was last resumed
 * - pauseReason: optional text explaining why the schedule was paused
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

  // Index for efficient lookups of paused schedules
  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_recurring_donations_status_pause
    ON recurring_donations(status, pausedAt)
  `);
};

exports.down = async (db) => {
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
