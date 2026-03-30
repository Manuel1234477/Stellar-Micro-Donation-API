/**
 * Migration 004: Asset issuance support
 * Creates issued_assets and asset_holdings tables.
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
          CREATE TABLE IF NOT EXISTS issued_assets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            assetCode TEXT NOT NULL,
            issuerPublicKey TEXT NOT NULL,
            name TEXT,
            description TEXT,
            iconUrl TEXT,
            totalIssued TEXT NOT NULL DEFAULT '0',
            totalBurned TEXT NOT NULL DEFAULT '0',
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(assetCode, issuerPublicKey)
          )
        `);
        db.run(`
          CREATE TABLE IF NOT EXISTS asset_holdings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            assetCode TEXT NOT NULL,
            issuerPublicKey TEXT NOT NULL,
            holderPublicKey TEXT NOT NULL,
            balance TEXT NOT NULL DEFAULT '0',
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(assetCode, issuerPublicKey, holderPublicKey)
          )
        `, (err) => {
          db.close();
          if (err) return reject(err);
          console.log('✓ Migration 004 complete');
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
