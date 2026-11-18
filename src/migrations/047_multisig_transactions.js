'use strict';

exports.name = '047_multisig_transactions';

exports.up = async (db) => {
  await db.run(`
    CREATE TABLE IF NOT EXISTS multisig_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_xdr TEXT NOT NULL,
      network_passphrase TEXT NOT NULL,
      required_signers INTEGER NOT NULL CHECK (required_signers >= 2),
      signer_keys TEXT NOT NULL,
      collected_signatures TEXT NOT NULL DEFAULT '[]',
      metadata TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'complete', 'submitted', 'failed')),
      stellar_tx_hash TEXT UNIQUE,
      stellar_ledger INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_multisig_status ON multisig_transactions(status)
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_multisig_stellar_hash ON multisig_transactions(stellar_tx_hash)
  `);
};

exports.down = async (db) => {
  await db.run('DROP INDEX IF EXISTS idx_multisig_stellar_hash');
  await db.run('DROP INDEX IF EXISTS idx_multisig_status');
  await db.run('DROP TABLE IF EXISTS multisig_transactions');
};
