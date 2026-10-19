'use strict';

exports.name = '032_refund_transactions';
exports.up = async function up(db) {
  await db.run(`CREATE TABLE IF NOT EXISTS refund_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_donation_id INTEGER NOT NULL,
    reverse_transaction_id TEXT,
    amount REAL NOT NULL,
    reason TEXT,
    notes TEXT,
    idempotency_key TEXT UNIQUE,
    stellar_ledger INTEGER,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
  )`);
  await db.run('CREATE INDEX IF NOT EXISTS idx_refund_transactions_donation ON refund_transactions(original_donation_id)');
  await db.run('CREATE INDEX IF NOT EXISTS idx_refund_transactions_status ON refund_transactions(status)');
};
exports.down = async function down(db) {
  await db.run('DROP TABLE IF EXISTS refund_transactions');
};
