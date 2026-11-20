'use strict';

/**
 * Migration: Enhance refunds table — #797
 * - Ensures refunds table exists with all required columns
 * - Adds notes, idempotency_key columns (idempotent)
 * - Adds index on idempotency_key for fast duplicate detection
 */

exports.name = '015_refunds_table_enhancements';

exports.up = async (db) => {
  // Ensure refunds table exists
  await db.run(`
    CREATE TABLE IF NOT EXISTS refunds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_donation_id TEXT NOT NULL,
      reverse_transaction_id TEXT NOT NULL UNIQUE,
      amount_stroops INTEGER NOT NULL,
      reason TEXT,
      notes TEXT,
      idempotency_key TEXT,
      refunded_at DATETIME NOT NULL,
      stellar_ledger INTEGER,
      status TEXT DEFAULT 'completed',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (original_donation_id) REFERENCES transactions(id)
    )
  `);

  // Add notes column if missing
  try {
    await db.run(`ALTER TABLE refunds ADD COLUMN notes TEXT`);
  } catch (_) { /* column already exists */ }

  // ADR-004: monetary values are stored as integer stroops.
  // Add amount_stroops for databases created before this migration and
  // backfill from the legacy REAL amount column when it is present.
  const columns = await db.all(`PRAGMA table_info(refunds)`);
  const columnNames = columns.map((c) => c.name);

  if (!columnNames.includes('amount_stroops')) {
    try {
      await db.run(`ALTER TABLE refunds ADD COLUMN amount_stroops INTEGER`);
    } catch (_) { /* column already exists */ }
  }

  if (columnNames.includes('amount')) {
    await db.run(`
      UPDATE refunds
      SET amount_stroops = CAST(ROUND(amount * 10000000) AS INTEGER)
      WHERE amount_stroops IS NULL AND amount IS NOT NULL
    `);
  }

  // Add idempotency_key column if missing
  try {
    await db.run(`ALTER TABLE refunds ADD COLUMN idempotency_key TEXT`);
  } catch (_) { /* column already exists */ }

  await db.run(`CREATE INDEX IF NOT EXISTS idx_refunds_original_donation_id ON refunds(original_donation_id)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_refunds_idempotency_key ON refunds(idempotency_key)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_refunds_status ON refunds(status)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_refunds_amount_stroops ON refunds(amount_stroops)`);
};

exports.down = async () => {
  // SQLite does not support DROP COLUMN — skip rollback
};
