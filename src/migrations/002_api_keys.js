'use strict';

exports.name = '002_api_keys';

exports.up = async (db) => {
  await db.run(`
    CREATE TABLE IF NOT EXISTS api_keys (
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
    CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash)
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_api_keys_status ON api_keys(status)
  `);
};
