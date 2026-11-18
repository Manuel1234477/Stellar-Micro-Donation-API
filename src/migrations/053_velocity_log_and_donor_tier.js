'use strict';

/**
 * Migration 044 — Sliding-window velocity log + donor tier
 *
 * Adds:
 *   - velocity_log: timestamp-based sliding-window log per donor
 *   - users.tier: 'free' | 'standard' | 'premium' (default 'free')
 */

exports.name = '044_velocity_log_and_donor_tier';

exports.up = async (db) => {
  // Sliding-window log table
  await db.run(`
    CREATE TABLE IF NOT EXISTS velocity_log (
      id         INTEGER  PRIMARY KEY AUTOINCREMENT,
      donor_id   INTEGER  NOT NULL,
      api_key    TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_velocity_log_donor_created
    ON velocity_log(donor_id, created_at)
  `);

  // Add tier column to users if it doesn't already exist
  try {
    await db.run(`ALTER TABLE users ADD COLUMN tier TEXT NOT NULL DEFAULT 'free'`);
  } catch (err) {
    // Column already exists — safe to ignore
    if (!err.message.includes('duplicate column')) throw err;
  }
};

exports.down = async (db) => {
  await db.run('DROP INDEX IF EXISTS idx_velocity_log_donor_created');
  await db.run('DROP TABLE IF EXISTS velocity_log');
  // SQLite does not support DROP COLUMN — tier column is left in place on rollback
};
