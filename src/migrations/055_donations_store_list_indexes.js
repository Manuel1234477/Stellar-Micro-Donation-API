'use strict';

/**
 * Migration 055: List-query indexes on donations_store
 *
 * These indexes were originally created by 012_add_performance_indexes, which
 * runs before donations_store exists (033_donations_store). On a fresh database
 * 012 now skips them, so they are created here, after the table is in place.
 * IF NOT EXISTS keeps this a no-op on databases where 012 already created them.
 *
 * - donations_store(status, created_at DESC, id DESC) — default list query
 * - donations_store(donor_id, created_at DESC, id DESC) — donor-scoped lists
 * - donations_store(recipient_id, created_at DESC, id DESC) — recipient-scoped lists
 */
exports.name = '055_donations_store_list_indexes';

exports.up = async (db) => {
  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_donations_store_status_created_id
    ON donations_store(status, created_at DESC, id DESC)
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_donations_store_donor_created_id
    ON donations_store(donor_id, created_at DESC, id DESC)
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_donations_store_recipient_created_id
    ON donations_store(recipient_id, created_at DESC, id DESC)
  `);
};

exports.down = async (db) => {
  await db.run('DROP INDEX IF EXISTS idx_donations_store_status_created_id');
  await db.run('DROP INDEX IF EXISTS idx_donations_store_donor_created_id');
  await db.run('DROP INDEX IF EXISTS idx_donations_store_recipient_created_id');
};
