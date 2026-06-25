'use strict';

// This table backs the Transaction model (previously data/donations.json).
// It stores the full donation record as a JSON blob alongside indexed columns
// for efficient querying, avoiding any float coercion of stroop amounts.

exports.name = '019_donations_store';

exports.up = async (db) => {
  await db.run(`
    CREATE TABLE IF NOT EXISTS donations_store (
      id TEXT PRIMARY KEY,
      donor TEXT,
      recipient TEXT,
      amount_stroops INTEGER,
      amount_text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      idempotency_key TEXT UNIQUE,
      stellar_tx_id TEXT UNIQUE,
      timestamp TEXT NOT NULL,
      status_updated_at TEXT,
      deleted_at TEXT,
      data TEXT NOT NULL
    )
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_donations_store_donor ON donations_store(donor)
  `);
  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_donations_store_recipient ON donations_store(recipient)
  `);
  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_donations_store_status ON donations_store(status)
  `);
  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_donations_store_stellar_tx ON donations_store(stellar_tx_id)
  `);
  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_donations_store_idempotency ON donations_store(idempotency_key)
  `);
};

exports.down = async (db) => {
  await db.run('DROP INDEX IF EXISTS idx_donations_store_idempotency');
  await db.run('DROP INDEX IF EXISTS idx_donations_store_stellar_tx');
  await db.run('DROP INDEX IF EXISTS idx_donations_store_status');
  await db.run('DROP INDEX IF EXISTS idx_donations_store_recipient');
  await db.run('DROP INDEX IF EXISTS idx_donations_store_donor');
  await db.run('DROP TABLE IF EXISTS donations_store');
};
