'use strict';

exports.name = '012_refresh_token_revocation';

exports.up = async (db) => {
  // Add revoked_at and revoke_reason columns to refresh_tokens table.
  // The table may not exist yet (created lazily by JwtService), so we
  // create it first with the full schema, then add columns if it already exists.
  await db.run(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      api_key_id INTEGER NOT NULL,
      family_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at INTEGER,
      revoked INTEGER NOT NULL DEFAULT 0,
      revoked_at INTEGER,
      revoke_reason TEXT,
      created_at INTEGER NOT NULL
    )
  `);

  // If the table already existed without these columns, add them.
  // SQLite does not support IF NOT EXISTS for ALTER TABLE ADD COLUMN,
  // so we catch the error if the column already exists.
  try {
    await db.run(`ALTER TABLE refresh_tokens ADD COLUMN revoked_at INTEGER`);
  } catch (_) { /* column already exists */ }

  try {
    await db.run(`ALTER TABLE refresh_tokens ADD COLUMN revoke_reason TEXT`);
  } catch (_) { /* column already exists */ }

  await db.run(`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family_id ON refresh_tokens(family_id)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_api_key_id ON refresh_tokens(api_key_id)`);
};
