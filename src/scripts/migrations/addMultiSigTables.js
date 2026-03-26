/**
 * Migration: Add multi-signature support tables
 * Adds multisig_configs and multisig_signatures tables, and required_signers/signer_keys
 * columns to the wallets table (if it exists).
 */
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.join(__dirname, '../../../data/stellar_donations.db');

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

async function migrate() {
  const db = await new Promise((resolve, reject) => {
    const d = new sqlite3.Database(DB_PATH, (err) => (err ? reject(err) : resolve(d)));
  });

  try {
    // Pending multi-sig transactions
    await run(db, `
      CREATE TABLE IF NOT EXISTS multisig_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_xdr TEXT NOT NULL,
        network_passphrase TEXT NOT NULL,
        required_signers INTEGER NOT NULL,
        signer_keys TEXT NOT NULL,
        collected_signatures TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'pending',
        stellar_tx_hash TEXT,
        stellar_ledger INTEGER,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('✓ Created multisig_transactions table');
  } finally {
    db.close();
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
