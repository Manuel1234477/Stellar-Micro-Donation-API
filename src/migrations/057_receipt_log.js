'use strict';

exports.name = '057_receipt_log';

exports.up = async (db) => {
  await db.run(`
    CREATE TABLE IF NOT EXISTS receipt_log (
      donation_id  TEXT     PRIMARY KEY,
      generated_at DATETIME NOT NULL,
      emailed_to   TEXT
    )
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS receipt_sequence (
      id  INTEGER PRIMARY KEY CHECK (id = 1),
      seq INTEGER NOT NULL DEFAULT 0
    )
  `);

  await db.run(`
    INSERT OR IGNORE INTO receipt_sequence (id, seq) VALUES (1, 0)
  `);
};

exports.down = async (db) => {
  await db.run('DROP TABLE IF EXISTS receipt_log');
  await db.run('DROP TABLE IF EXISTS receipt_sequence');
};
