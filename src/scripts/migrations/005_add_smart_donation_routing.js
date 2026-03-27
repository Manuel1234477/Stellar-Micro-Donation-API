/**
 * Migration 005: Smart donation routing support
 * Creates recipient_pools, recipient_pool_members, round_robin_state, and routing_decisions tables.
 */
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const DB_PATH = path.join(__dirname, '../../../data/stellar_donations.db');

function runMigration() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) return reject(new Error(`Failed to connect: ${err.message}`));
      db.serialize(() => {
        db.run(`
          CREATE TABLE IF NOT EXISTS recipient_pools (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            name      TEXT    NOT NULL UNIQUE,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        db.run(`
          CREATE TABLE IF NOT EXISTS recipient_pool_members (
            pool_name         TEXT NOT NULL REFERENCES recipient_pools(name) ON DELETE CASCADE,
            recipient_id      TEXT NOT NULL,
            latitude          REAL,
            longitude         REAL,
            campaign_deadline DATETIME,
            display_name      TEXT,
            PRIMARY KEY (pool_name, recipient_id)
          )
        `);

        db.run(`
          CREATE TABLE IF NOT EXISTS round_robin_state (
            pool_name  TEXT PRIMARY KEY,
            next_index INTEGER NOT NULL DEFAULT 0,
            updatedAt  DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        db.run(`
          CREATE TABLE IF NOT EXISTS routing_decisions (
            id          TEXT PRIMARY KEY,
            donation_id TEXT NOT NULL,
            pool_name   TEXT NOT NULL,
            strategy    TEXT NOT NULL,
            selected_id TEXT NOT NULL,
            candidates  TEXT NOT NULL,
            excluded    TEXT NOT NULL,
            decided_at  DATETIME NOT NULL,
            createdAt   DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        db.run(`CREATE INDEX IF NOT EXISTS idx_rd_donation ON routing_decisions(donation_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_rd_pool     ON routing_decisions(pool_name)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_rd_strategy ON routing_decisions(strategy)`, (err) => {
          db.close();
          if (err) return reject(err);
          console.log('✓ Migration 005 complete');
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
