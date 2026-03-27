const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DATA_DIR = './data';
const DB_PATH = path.join(DATA_DIR, 'stellar_donations.db');

/**
 * Migration: Add time-bound columns to transactions table
 *
 * This migration adds:
 * 1. validAfter column - Unix timestamp for transaction minimum valid time
 * 2. validBefore column - Unix timestamp for transaction maximum valid time
 *
 * These columns store Stellar time-bounds for clock-based transaction validation.
 * Values of 0 represent infinite (no bound).
 */

function runMigration() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        reject(new Error(`Failed to connect to database: ${err.message}`));
        return;
      }

      console.log('✓ Connected to database');

      // Check if column already exists
      db.all("PRAGMA table_info(transactions)", (err, columns) => {
        if (err) {
          db.close();
          reject(err);
          return;
        }

        const hasValidAfter = columns.some(col => col.name === 'validAfter');
        const hasValidBefore = columns.some(col => col.name === 'validBefore');

        if (hasValidAfter && hasValidBefore) {
          console.log('✓ validAfter and validBefore columns already exist');
          db.close();
          resolve();
          return;
        }

        console.log('Adding time-bound columns to transactions table...');

        db.serialize(() => {
          db.run('BEGIN TRANSACTION');

          // Create new table with time-bound columns
          const newTableSQL = `
            CREATE TABLE transactions_new (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              senderId INTEGER NOT NULL,
              receiverId INTEGER NOT NULL,
              amount REAL NOT NULL,
              memo TEXT,
              notes TEXT,
              tags TEXT,
              timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
              deleted_at DATETIME DEFAULT NULL,
              idempotencyKey TEXT UNIQUE,
              stellar_tx_id TEXT UNIQUE,
              is_orphan INTEGER NOT NULL DEFAULT 0,
              campaign_id INTEGER,
              validAfter INTEGER DEFAULT 0,
              validBefore INTEGER DEFAULT 0,
              FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
              FOREIGN KEY (senderId) REFERENCES users(id),
              FOREIGN KEY (receiverId) REFERENCES users(id)
            )
          `;

          db.run(newTableSQL, (err) => {
            if (err) {
              db.run('ROLLBACK');
              db.close();
              reject(new Error(`Failed to create new table: ${err.message}`));
              return;
            }
            console.log('✓ Created new transactions table with time-bound columns');
          });

          // Copy data from old table
          db.run(`
            INSERT INTO transactions_new (
              id, senderId, receiverId, amount, memo, notes, tags,
              timestamp, deleted_at, idempotencyKey, stellar_tx_id,
              is_orphan, campaign_id, validAfter, validBefore
            )
            SELECT
              id, senderId, receiverId, amount, memo, notes, tags,
              timestamp, deleted_at, idempotencyKey, stellar_tx_id,
              is_orphan, campaign_id, 0, 0
            FROM transactions
          `, (err) => {
            if (err) {
              db.run('ROLLBACK');
              db.close();
              reject(new Error(`Failed to copy data: ${err.message}`));
              return;
            }
            console.log('✓ Copied existing data');
          });

          // Drop old table
          db.run('DROP TABLE transactions', (err) => {
            if (err) {
              db.run('ROLLBACK');
              db.close();
              reject(new Error(`Failed to drop old table: ${err.message}`));
              return;
            }
            console.log('✓ Dropped old table');
          });

          // Rename new table
          db.run('ALTER TABLE transactions_new RENAME TO transactions', (err) => {
            if (err) {
              db.run('ROLLBACK');
              db.close();
              reject(new Error(`Failed to rename table: ${err.message}`));
              return;
            }
            console.log('✓ Renamed new table');
          });

          // Create index on time-bound columns for querying expired transactions
          db.run(
            'CREATE INDEX IF NOT EXISTS idx_transactions_timebounds ON transactions(validAfter, validBefore)',
            (err) => {
              if (err) {
                db.run('ROLLBACK');
                db.close();
                reject(new Error(`Failed to create index: ${err.message}`));
                return;
              }
              console.log('✓ Created index on time-bound columns');
            }
          );

          // Commit transaction
          db.run('COMMIT', (err) => {
            if (err) {
              db.run('ROLLBACK');
              db.close();
              reject(new Error(`Failed to commit: ${err.message}`));
              return;
            }
            console.log('✓ Migration completed successfully');
            db.close();
            resolve();
          });
        });
      });
    });
  });
}

async function main() {
  console.log('Running migration: Add time-bounds to transactions table\n');

  try {
    await runMigration();
    process.exit(0);
  } catch (error) {
    console.error('✗ Migration failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { runMigration };
