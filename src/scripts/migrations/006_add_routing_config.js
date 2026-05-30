/**
 * Migration 006: Smart donation routing — strategy configuration
 * Adds routing_config table and weight/priority columns to recipient_pool_members.
 */
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const DB_PATH = path.join(__dirname, '../../../data/stellar_donations.db');

function runMigration() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) return reject(new Error(`Failed to connect: ${err.message}`));
      db.serialize(() => {
        // Per-pool active strategy configuration
        db.run(`
          CREATE TABLE IF NOT EXISTS routing_config (
            pool_name TEXT PRIMARY KEY,
            strategy  TEXT NOT NULL,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Add weight column for WeightedStrategy (default 1)
        db.run(`ALTER TABLE recipient_pool_members ADD COLUMN weight REAL DEFAULT 1`, () => {});

        // Add priority column for PriorityStrategy (default 0)
        db.run(`ALTER TABLE recipient_pool_members ADD COLUMN priority REAL DEFAULT 0`, (err) => {
          db.close();
          if (err && !err.message.includes('duplicate column')) return reject(err);
          console.log('✓ Migration 006 complete');
          resolve();
        });
      });
    });
  });
}

if (require.main === module) {
  runMigration().catch(err => { console.error(err.message); process.exit(1); });
}
module.exports = { runMigration };
