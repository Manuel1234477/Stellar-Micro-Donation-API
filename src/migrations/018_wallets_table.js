'use strict';

exports.name = '018_wallets_table';

exports.up = async (db) => {
  await db.run(`
    CREATE TABLE IF NOT EXISTS wallets (
      id TEXT PRIMARY KEY,
      address TEXT NOT NULL UNIQUE,
      label TEXT,
      ownerName TEXT,
      notes TEXT,
      leaderboard_visibility INTEGER DEFAULT 1,
      last_synced_at TEXT,
      last_cursor TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT,
      deletedAt TEXT
    )
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_wallets_address ON wallets(address)
  `);
};

exports.down = async (db) => {
  await db.run('DROP INDEX IF EXISTS idx_wallets_address');
  await db.run('DROP TABLE IF EXISTS wallets');
};
