'use strict';

/**
 * Migration: Add performance indexes (#755)
 *
 * - transactions(timestamp)                        — time-range queries
 * - recurring_donations(status, nextExecutionDate) — scheduler queries
 * - idempotency_keys(idempotencyKey)               — idempotency lookups
 * - api_keys(key_hash)                             — API key validation (idempotent, may already exist)
 */

exports.name = '010_add_performance_indexes';

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
