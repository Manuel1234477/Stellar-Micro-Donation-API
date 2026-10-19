/**
 * Migration: Add list-donations composite indexes (#1796)
 *
 * The default list-donations query filters by status and sorts by
 * created_at DESC, id DESC (keyset pagination). Without a composite index
 * SQLite falls back to a full scan + temp B-tree sort, which pushed p95
 * latency from ~50ms to ~73ms.
 *
 * - donations_store(status, created_at DESC, id DESC) — default list query
 * - donations_store(donor_id, created_at DESC, id DESC) — donor-scoped lists
 * - donations_store(recipient_id, created_at DESC, id DESC) — recipient-scoped lists
 *
 * Verify with:
 *   EXPLAIN QUERY PLAN
 *   SELECT * FROM donations_store
 *   WHERE status = 'completed'
 *   ORDER BY created_at DESC, id DESC
 *   LIMIT 20;
 * Expected: SEARCH donations_store USING INDEX idx_donations_store_status_created_id
 */
exports.name = '045_add_list_donations_indexes';

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
