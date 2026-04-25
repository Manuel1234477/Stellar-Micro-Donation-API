'use strict';

/**
 * Migration: Add recurring_donation_executions table (#771)
 *
 * Stores per-execution history for recurring donation schedules so that
 * owners and admins can audit past runs (success/failure, tx hash, error).
 */

exports.name = '011_recurring_donation_executions';

exports.up = async (db) => {
  await db.run(`
    CREATE TABLE IF NOT EXISTS recurring_donation_executions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      scheduleId      INTEGER NOT NULL REFERENCES recurring_donations(id) ON DELETE CASCADE,
      executedAt      TEXT    NOT NULL,
      status          TEXT    NOT NULL CHECK(status IN ('success', 'failure')),
      transactionHash TEXT,
      errorMessage    TEXT,
      createdAt       TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_rde_scheduleId
    ON recurring_donation_executions(scheduleId, executedAt DESC)
  `);
};

exports.down = async (db) => {
  await db.run('DROP INDEX IF EXISTS idx_rde_scheduleId');
  await db.run('DROP TABLE IF EXISTS recurring_donation_executions');
};
