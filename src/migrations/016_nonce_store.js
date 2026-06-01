'use strict';

exports.name = '016_nonce_store';

exports.up = async (db) => {
  await db.run(`
    CREATE TABLE IF NOT EXISTS nonce_store (
      nonce TEXT PRIMARY KEY,
      usedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      expiresAt DATETIME NOT NULL
    )
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_nonce_store_expiresAt ON nonce_store(expiresAt)
  `);
};

exports.down = async (db) => {
  await db.run('DROP TABLE IF EXISTS nonce_store');
};
