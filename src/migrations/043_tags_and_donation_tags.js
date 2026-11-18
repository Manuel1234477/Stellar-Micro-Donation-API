'use strict';

/**
 * Migration 043: Create tags and donation_tags tables (#1530)
 *
 * Adds:
 * - `tags`: stores unique tag names
 * - `donation_tags`: many-to-many association table linking donations to tags
 */

exports.name = '043_tags_and_donation_tags';

exports.up = async (db) => {
  await db.run(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_tags_name
    ON tags(name)
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS donation_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      donation_id TEXT NOT NULL,
      tag_id INTEGER NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(donation_id, tag_id),
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    )
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_donation_tags_donation_id
    ON donation_tags(donation_id)
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_donation_tags_tag_id
    ON donation_tags(tag_id)
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_donation_tags_tag_donation
    ON donation_tags(tag_id, donation_id)
  `);
};

exports.down = async (db) => {
  await db.run('DROP TABLE IF EXISTS donation_tags');
  await db.run('DROP TABLE IF EXISTS tags');
};
