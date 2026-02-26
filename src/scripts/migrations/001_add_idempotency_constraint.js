const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DATA_DIR = './data';
const DB_PATH = path.join(DATA_DIR, 'stellar_donations.db');

/**
 * Migration: Add idempotency constraints to transactions table
 *
 * This migration adds:
 * 1. idempotencyKey column with UNIQUE constraint
 * 2. Index on idempotencyKey for fast lookups
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
      db.get("PRAGMA table_info(transactions)", (err, row) => {
        if (err) {
          db.close();
          reject(err);
          return;
        }

        db.all("PRAGMA table_info(transactions)", (err, columns) => {
          if (err) {
            db.close();
            reject(err);
            return;
          }

          const hasIdempotencyKey = columns.some(col => col.name === 'idempotencyKey');

          if (hasIdempotencyKey) {
            console.log('✓ idempotencyKey column already exists');
            db.close();
            resolve();
            return;
          }

          console.log('Adding idempotencyKey column with UNIQUE constraint...');

          // SQLite doesn't support adding UNIQUE constraint to existing table
          // We need to recreate the table
          db.serialize(() => {
            db.run('BEGIN TRANSACTION');

            // Create new table with idempotency constraint
            db.run(`
              CREATE TABLE transactions_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                senderId INTEGER NOT NULL,
                receiverId INTEGER NOT NULL,
                amount REAL NOT NULL,
                memo TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                idempotencyKey TEXT UNIQUE,
                FOREIGN KEY (senderId) REFERENCES users(id),
                FOREIGN KEY (receiverId) REFERENCES users(id)
              )
            `, (err) => {
              if (err) {
                db.run('ROLLBACK');
                db.close();
                reject(new Error(`Failed to create new table: ${err.message}`));
                return;
              }
              console.log('✓ Created new transactions table with idempotency constraint');
            });

            // Copy data from old table
            db.run(`
              INSERT INTO transactions_new (id, senderId, receiverId, amount, memo, timestamp)
              SELECT id, senderId, receiverId, amount, memo, timestamp
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

            // Create index on idempotencyKey
            db.run('CREATE INDEX IF NOT EXISTS idx_transactions_idempotency ON transactions(idempotencyKey)', (err) => {
              if (err) {
                db.run('ROLLBACK');
                db.close();
                reject(new Error(`Failed to create index: ${err.message}`));
                return;
              }
              console.log('✓ Created index on idempotencyKey');
            });

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
  });
}

async function main() {
  console.log('Running migration: Add idempotency constraints\n');

  try {
    await runMigration();
    console.log('\n✓ Migration completed successfully!');
  } catch (error) {
    console.error('\n✗ Migration failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { runMigration };
