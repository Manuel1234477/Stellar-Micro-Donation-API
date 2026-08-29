'use strict';

exports.name = '042_refresh_token_session_limits';

exports.up = async (db) => {
  // Absolute expiry is anchored on the moment the token family was created, so
  // rotation cannot extend a session indefinitely. Device identity is stored on
  // the family so a user can recognise and revoke an individual session.
  await db.run(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jti TEXT NOT NULL UNIQUE,
      token_hash TEXT NOT NULL UNIQUE,
      api_key_id INTEGER NOT NULL,
      family_id TEXT NOT NULL,
      device_id TEXT,
      family_started_at INTEGER,
      expires_at INTEGER NOT NULL,
      used_at INTEGER,
      revoked INTEGER NOT NULL DEFAULT 0,
      revoked_at INTEGER,
      revoke_reason TEXT,
      created_at INTEGER NOT NULL
    )
  `);

  // SQLite has no ALTER TABLE ... ADD COLUMN IF NOT EXISTS, so adding a column
  // that is already present throws and is ignored.
  try {
    await db.run(`ALTER TABLE refresh_tokens ADD COLUMN device_id TEXT`);
  } catch (_) { /* column already exists */ }

  try {
    await db.run(`ALTER TABLE refresh_tokens ADD COLUMN family_started_at INTEGER`);
  } catch (_) { /* column already exists */ }

  // Backfill families that predate this migration: the earliest row in a family
  // is when that family began.
  await db.run(`
    UPDATE refresh_tokens
       SET family_started_at = (
         SELECT MIN(created_at) FROM refresh_tokens AS f
          WHERE f.family_id = refresh_tokens.family_id
       )
     WHERE family_started_at IS NULL
  `);

  await db.run(
    `CREATE INDEX IF NOT EXISTS idx_refresh_tokens_device ON refresh_tokens(api_key_id, device_id)`
  );
};

exports.down = async (db) => {
  await db.run('DROP INDEX IF EXISTS idx_refresh_tokens_device');
  // device_id and family_started_at are left in place: SQLite cannot drop a
  // column without rebuilding the table, and both are nullable.
};
