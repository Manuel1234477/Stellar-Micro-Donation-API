'use strict';

/**
 * Migration: Add execution metadata to recurring_donation_executions (#895)
 *
 * Adds retryCount and durationMs fields to track retry attempts and execution time.
 */

exports.name = '013_add_execution_metadata';

exports.up = async (db) => {
  // Add retryCount column (default 0)
  await db.run(`
    ALTER TABLE recurring_donation_executions
    ADD COLUMN retryCount INTEGER DEFAULT 0
  `).catch(err => {
    // Ignore if column already exists
    if (!err.message.includes('duplicate column')) throw err;
  });

  // Add durationMs column (execution time in milliseconds)
  await db.run(`
    ALTER TABLE recurring_donation_executions
    ADD COLUMN durationMs INTEGER DEFAULT 0
  `).catch(err => {
    // Ignore if column already exists
    if (!err.message.includes('duplicate column')) throw err;
  });
};

exports.down = async (db) => {
  // SQLite doesn't support DROP COLUMN easily, so we skip it
  // In a real scenario, you'd recreate the table without these columns
};
