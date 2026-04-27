'use strict';

/**
 * Migration: Enhance refunds table — #797
 * - Ensures refunds table exists with all required columns
 * - Adds notes, idempotency_key columns (idempotent)
 * - Adds index on idempotency_key for fast duplicate detection
 */

exports.name = '012_refunds_table_enhancements';

exports.up = async (db) => {
  // Ensure refunds table exists
  await db.run(`
    CREATE TABLE IF NOT EXISTS refunds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_donation_id TEXT NOT NULL,
      reverse_transaction_id TEXT NOT NULL UNIQUE,
      amount REAL NOT NULL,
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
  } catch (err) {
    if (!err.message.includes('duplicate column name')) throw err;
  }

  // Add idempotency_key column if missing
  try {
    await db.run(`ALTER TABLE refunds ADD COLUMN idempotency_key TEXT`);
  } catch (err) {
    if (!err.message.includes('duplicate column name')) throw err;
  }

  await db.run(`CREATE INDEX IF NOT EXISTS idx_refunds_original_donation_id ON refunds(original_donation_id)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_refunds_idempotency_key ON refunds(idempotency_key)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_refunds_status ON refunds(status)`);
};

exports.down = async () => {
  // SQLite does not support DROP COLUMN — skip rollback
};
