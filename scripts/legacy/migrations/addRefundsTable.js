/**
 * Migration: Add Refunds Table
 * 
 * Creates the refunds table to track donation refunds with:
 * - Original donation reference
 * - Reverse transaction details
 * - Refund metadata (reason, timestamp, status)
 * - Audit trail for compliance
 */

const Database = require('../../utils/database');
const log = require('../../utils/log');

async function addRefundsTable() {
  try {
    log.info('MIGRATION', 'Adding refunds table...');

    // Create refunds table
    await Database.run(`
      CREATE TABLE IF NOT EXISTS refunds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        original_donation_id TEXT NOT NULL,
        reverse_transaction_id TEXT NOT NULL UNIQUE,
        amount REAL NOT NULL,
        reason TEXT,
        refunded_at DATETIME NOT NULL,
        stellar_ledger INTEGER,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (original_donation_id) REFERENCES transactions(id)
      )
    `);

    // Create indexes for fast lookups
    await Database.run(`
      CREATE INDEX IF NOT EXISTS idx_refunds_original_donation_id 
      ON refunds(original_donation_id)
    `);

    await Database.run(`
      CREATE INDEX IF NOT EXISTS idx_refunds_reverse_transaction_id 
      ON refunds(reverse_transaction_id)
    `);

    await Database.run(`
      CREATE INDEX IF NOT EXISTS idx_refunds_status 
      ON refunds(status)
    `);

    log.info('MIGRATION', 'Refunds table created successfully');
    return true;
  } catch (error) {
    log.error('MIGRATION', 'Failed to add refunds table', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

// Run migration if executed directly
if (require.main === module) {
  addRefundsTable()
    .then(() => {
      console.log('✓ Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('✗ Migration failed:', error.message);
      process.exit(1);
    });
}

module.exports = addRefundsTable;
