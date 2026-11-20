'use strict';

/**
 * Migration 062: Add anchor_day to recurring_donations (#2076)
 *
 * Monthly/quarterly schedules used to derive the next execution day from the
 * previous execution date, so a schedule anchored on the 31st drifted to the
 * 28th after passing through February. anchor_day stores the intended day of
 * month (1–31) and is backfilled from startDate/createdAt.
 */

exports.name = '062_recurring_donations_anchor_day';

exports.up = async (db) => {
  await db.run(`
    ALTER TABLE recurring_donations ADD COLUMN anchor_day INTEGER DEFAULT NULL
  `);

  // Backfill from the schedule's start date, falling back to creation time.
  const rows = await db.query(
    `SELECT id, nextExecutionDate, createdAt FROM recurring_donations WHERE anchor_day IS NULL`,
    []
  );

  for (const row of rows) {
    const source = row.nextExecutionDate || row.createdAt;
    const parsed = source ? new Date(source) : null;
    const day = parsed && !isNaN(parsed.getTime()) ? parsed.getUTCDate() : 1;
    await db.run('UPDATE recurring_donations SET anchor_day = ? WHERE id = ?', [day, row.id]);
  }
};

exports.down = async (db) => {
  // SQLite does not support DROP COLUMN on older versions; this migration is
  // intentionally irreversible.
};
