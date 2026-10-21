'use strict';

exports.name = '058_federation_records';

exports.up = async (db) => {
  await db.run(`
    CREATE TABLE IF NOT EXISTS federation_records (
      name       TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      memo_type  TEXT,
      memo       TEXT
    )
  `);
};

exports.down = async (db) => {
  await db.run('DROP TABLE IF EXISTS federation_records');
};
