'use strict';

exports.name = '024_scheduler_locks';

exports.up = async (db) => {
  await db.run(`
    CREATE TABLE IF NOT EXISTS scheduler_locks (
      name        TEXT    PRIMARY KEY,
      holder_id   TEXT    NOT NULL,
      acquired_at INTEGER NOT NULL,
      expires_at  INTEGER NOT NULL
    )
  `);
  console.log('✓ Created scheduler_locks table');
};

exports.down = async (db) => {
  await db.run('DROP TABLE IF EXISTS scheduler_locks');
};
