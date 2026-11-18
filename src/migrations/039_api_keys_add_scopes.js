'use strict';

/**
 * Migration 039: Add missing `scopes` column to api_keys table (#1351)
 *
 * The authoritative api_keys CREATE TABLE in migration 003_api_keys.js does not
 * include a `scopes` column, but src/models/apiKeys.js unconditionally references
 * it in createApiKey(), validateApiKey(), listApiKeys(), and rotateApiKey().
 *
 * Because initializeApiKeysTable() uses CREATE TABLE IF NOT EXISTS, its own
 * CREATE_TABLE_SQL (which includes scopes TEXT) is a no-op once the real
 * migration has already created the table — the column is never added, and
 * every call to the above functions fails with:
 *
 *   SQLITE_ERROR: table api_keys has no column named scopes
 *
 * This migration adds the column via ALTER TABLE (idempotent — silently skips
 * if the column already exists, e.g. on databases bootstrapped from the model's
 * own fallback schema rather than the migration runner).
 */

exports.name = '039_api_keys_add_scopes';

exports.up = async (db) => {
  // Check the schema instead of matching the error text: the database wrapper
  // replaces SQLite's "duplicate column" message, so a text match never fires.
  const columns = await db.all('PRAGMA table_info(api_keys)');
  if (columns.some((c) => c.name === 'scopes')) return;
  await db.run(`ALTER TABLE api_keys ADD COLUMN scopes TEXT`);
};

exports.down = async (db) => {
  // SQLite does not support DROP COLUMN before version 3.35.0.
  // Recreate the table without the scopes column to support rollback on older
  // SQLite versions while faithfully preserving all constraints and indexes.
  await db.run(`
    CREATE TABLE IF NOT EXISTS api_keys_no_scopes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'active',
      created_by TEXT,
      metadata TEXT,
      expires_at INTEGER,
      last_used_at INTEGER,
      deprecated_at INTEGER,
      revoked_at INTEGER,
      created_at INTEGER NOT NULL,
      grace_period_days INTEGER NOT NULL DEFAULT 30,
      rotated_to_id INTEGER,
      signing_required INTEGER NOT NULL DEFAULT 0,
      key_secret TEXT,
      allowed_ips TEXT,
      monthly_quota INTEGER,
      quota_used INTEGER NOT NULL DEFAULT 0,
      quota_reset_at INTEGER,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      notification_email TEXT,
      last_expiry_notification_sent_at INTEGER
    )
  `);
  await db.run(`
    INSERT INTO api_keys_no_scopes (
      id, key_hash, key_prefix, name, role, status, created_by, metadata,
      expires_at, last_used_at, deprecated_at, revoked_at, created_at,
      grace_period_days, rotated_to_id, signing_required, key_secret,
      allowed_ips, monthly_quota, quota_used, quota_reset_at, tenant_id,
      notification_email, last_expiry_notification_sent_at
    )
    SELECT
      id, key_hash, key_prefix, name, role, status, created_by, metadata,
      expires_at, last_used_at, deprecated_at, revoked_at, created_at,
      grace_period_days, rotated_to_id, signing_required, key_secret,
      allowed_ips, monthly_quota, quota_used, quota_reset_at, tenant_id,
      notification_email, last_expiry_notification_sent_at
    FROM api_keys
  `);
  await db.run(`DROP TABLE api_keys`);
  await db.run(`ALTER TABLE api_keys_no_scopes RENAME TO api_keys`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_api_keys_status ON api_keys(status)`);
};
