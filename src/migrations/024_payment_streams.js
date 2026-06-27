'use strict';

exports.name = '024_payment_streams';

exports.up = async (db) => {
  await db.run(`
    CREATE TABLE IF NOT EXISTS payment_streams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_key TEXT NOT NULL UNIQUE,
      webhook_url TEXT,
      cursor TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_payment_streams_public_key
    ON payment_streams(public_key)
  `);
};

exports.down = async (db) => {
  await db.run('DROP INDEX IF EXISTS idx_payment_streams_public_key');
  await db.run('DROP TABLE IF EXISTS payment_streams');
};
