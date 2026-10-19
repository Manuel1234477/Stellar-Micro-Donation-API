'use strict';

/**
 * Migration: Add performance indexes (#755)
 *
 * - transactions(timestamp)                        — time-range queries
 * - recurring_donations(status, nextExecutionDate) — scheduler queries
 * - idempotency_keys(idempotencyKey)               — idempotency lookups
 * - api_keys(key_hash)                             — API key validation (idempotent, may already exist)
 */

exports.name = '012_add_performance_indexes';

exports.up = async (db) => {
  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_transactions_timestamp
    ON transactions(timestamp)
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_recurring_donations_status_nextExecution
    ON recurring_donations(status, nextExecutionDate)
  `);

  // Ensure idempotency_keys table exists before indexing
  await db.run(`
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      idempotencyKey VARCHAR(255) NOT NULL UNIQUE,
      requestHash VARCHAR(64) NOT NULL,
      response TEXT NOT NULL,
      userId INTEGER,
      createdAt DATETIME NOT NULL,
      expiresAt DATETIME NOT NULL
    )
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_idempotency_keys_key
    ON idempotency_keys(idempotencyKey)
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash
    ON api_keys(key_hash)
  `);
};

exports.down = async (db) => {
  await db.run('DROP INDEX IF EXISTS idx_transactions_timestamp');
  await db.run('DROP INDEX IF EXISTS idx_recurring_donations_status_nextExecution');
  await db.run('DROP INDEX IF EXISTS idx_idempotency_keys_key');
  await db.run('DROP INDEX IF EXISTS idx_api_keys_key_hash');
};

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
  // donations_store is created by a later migration (033). On a fresh database
  // it does not exist yet, so skip these indexes; 033 is the table's owner.
  const table = await db.get(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'donations_store'"
  );
  if (!table) return;

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
