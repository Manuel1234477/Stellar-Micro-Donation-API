'use strict';

/**
 * Migration 013 — Add cancelledAt column to recurring_donations
 *
 * Supports the soft-delete cancellation audit trail (#911).
 * The column is set to CURRENT_TIMESTAMP when a schedule is cancelled
 * via DELETE /stream/schedules/:id.
 */

exports.name = '013_add_cancelled_at_to_recurring_donations';

exports.up = async (db) => {
  const columns = await db.all('PRAGMA table_info(recurring_donations)');
  const columnNames = columns.map(col => col.name);

  if (!columnNames.includes('cancelledAt')) {
    await db.run('ALTER TABLE recurring_donations ADD COLUMN cancelledAt DATETIME DEFAULT NULL');
  }
};

exports.down = async (_db) => {
  // SQLite does not support DROP COLUMN in older versions; this migration is intentionally irreversible.
};
