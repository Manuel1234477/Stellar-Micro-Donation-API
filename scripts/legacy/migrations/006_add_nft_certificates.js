/**
 * Migration 006: NFT donation certificates
 * Adds NFT certificate columns to the transactions table.
 */
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const DB_PATH = path.join(__dirname, '../../../data/stellar_donations.db');

function runMigration() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) return reject(new Error(`Failed to connect: ${err.message}`));
      db.serialize(() => {
        // Add NFT certificate columns to transactions table
        const columns = [
          'ALTER TABLE transactions ADD COLUMN nft_asset_code TEXT',
          'ALTER TABLE transactions ADD COLUMN nft_issuer TEXT',
          'ALTER TABLE transactions ADD COLUMN nft_tx_hash TEXT',
          'ALTER TABLE transactions ADD COLUMN nft_minted_at DATETIME',
          'ALTER TABLE transactions ADD COLUMN nft_mint_error TEXT',
        ];

        let pending = columns.length;
        let failed = false;

        columns.forEach((sql) => {
          db.run(sql, (err) => {
            if (err && !err.message.includes('duplicate column name')) {
              if (!failed) {
                failed = true;
                db.close();
                return reject(err);
              }
            }
            pending -= 1;
            if (pending === 0 && !failed) {
              db.close();
              console.log('✓ Migration 006 complete');
              resolve();
            }
          });
        });
      });
    });
  });
}

if (require.main === module) {
  runMigration().catch(err => { console.error(err.message); process.exit(1); });
}
module.exports = { runMigration };
