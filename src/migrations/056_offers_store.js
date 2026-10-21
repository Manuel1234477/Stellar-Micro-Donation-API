'use strict';

exports.name = '056_offers_store';

exports.up = async (db) => {
  await db.run(`
    CREATE TABLE IF NOT EXISTS offers (
      id           TEXT    PRIMARY KEY,
      selling_asset TEXT   NOT NULL,
      buying_asset  TEXT   NOT NULL,
      amount        TEXT   NOT NULL,
      price         TEXT   NOT NULL,
      transaction_id TEXT,
      ledger        TEXT,
      status        TEXT   NOT NULL DEFAULT 'active',
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_offers_status ON offers(status)
  `);
};

exports.down = async (db) => {
  await db.run('DROP INDEX IF EXISTS idx_offers_status');
  await db.run('DROP TABLE IF EXISTS offers');
};
