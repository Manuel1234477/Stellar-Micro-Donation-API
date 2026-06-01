'use strict';

exports.name = '013_api_key_rate_limit';

exports.up = async (db) => {
  await db.run(`
    ALTER TABLE api_keys ADD COLUMN rate_limit_per_minute INTEGER DEFAULT NULL
  `);
};

exports.down = async (db) => {
  // SQLite does not support DROP COLUMN in older versions; recreate table without the column
  await db.run(`
    CREATE TABLE api_keys_backup AS SELECT
      id, key_hash, key_prefix, name, role, status, created_by, metadata,
      expires_at, last_used_at, deprecated_at, revoked_at, created_at,
      grace_period_days, rotated_to_id, signing_required, key_secret,
      allowed_ips, monthly_quota, quota_used, quota_reset_at, tenant_id,
      notification_email, last_expiry_notification_sent_at
    FROM api_keys
  `);
  await db.run(`DROP TABLE api_keys`);
  await db.run(`ALTER TABLE api_keys_backup RENAME TO api_keys`);
};
