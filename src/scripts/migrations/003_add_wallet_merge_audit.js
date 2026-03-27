/**
 * Migration 003: Add wallet merge support
 *
 * - Adds `mergedAt` and `mergedInto` columns to the users table (soft-delete)
 * - Creates `wallet_merge_audit` table for merge operation audit trail
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '../../../data/stellar_donations.db');

function runMigration() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) return reject(new Error(`Failed to connect: ${err.message}`));

      db.serialize(() => {
        // Soft-delete columns on users table
        db.run(`ALTER TABLE users ADD COLUMN mergedAt DATETIME`, () => {});
        db.run(`ALTER TABLE users ADD COLUMN mergedInto TEXT`, () => {});

        // Audit trail table
        db.run(`
          CREATE TABLE IF NOT EXISTS wallet_merge_audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sourceWalletId INTEGER NOT NULL,
            sourcePublicKey TEXT NOT NULL,
            destinationPublicKey TEXT NOT NULL,
            mergedAmount TEXT NOT NULL,
            transactionHash TEXT NOT NULL,
            ledger INTEGER,
            performedBy TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (sourceWalletId) REFERENCES users(id)
          )
        `, (err) => {
          db.close();
          if (err) return reject(err);
          console.log('✓ Migration 003 complete');
          resolve();
        });
      });
    });
  });
}

if (require.main === module) {
  runMigration().catch(err => {
    console.error('Migration failed:', err.message);
    process.exit(1);
  });
}

module.exports = { runMigration };
