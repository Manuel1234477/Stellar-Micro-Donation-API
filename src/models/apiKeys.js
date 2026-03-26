const db = require('../utils/database');
const crypto = require('crypto');
const { API_KEY_STATUS } = require('../constants/index');

const CREATE_TABLE_SQL = `
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
    allowed_ips TEXT
  )
`;

/**
 * Ensure the api_keys table exists and all optional columns are present.
 * Safe to call multiple times (idempotent).
 */
async function initializeApiKeysTable() {
  await db.run(CREATE_TABLE_SQL);

  const optionalColumns = [
    { name: 'allowed_ips', def: 'TEXT' },
    { name: 'notification_email', def: 'TEXT' },
    { name: 'last_expiry_notification_sent_at', def: 'INTEGER' },
  ];

  for (const col of optionalColumns) {
    try {
      await db.run(`ALTER TABLE api_keys ADD COLUMN ${col.name} ${col.def}`);
    } catch (err) {
      const detail = (err.details && err.details.originalError) || err.message || '';
      if (!detail.includes('duplicate column')) throw err;
    }
  }
}

/**
 * Create a new API key.
 *
 * @param {Object} opts
 * @param {string} opts.name
 * @param {string} [opts.role='user']
 * @param {number} [opts.expiresInDays]
 * @param {string} [opts.createdBy]
 * @param {Object} [opts.metadata={}]
 * @param {number} [opts.gracePeriodDays=30]
 * @param {boolean} [opts.signingRequired=false]
 * @param {string[]|null} [opts.allowedIps=null]
 * @param {string|null} [opts.notificationEmail=null] - Email for expiry notifications
 * @returns {Promise<Object>} Created key info (raw key returned once)
 */
async function createApiKey({
  name,
  role = 'user',
  expiresInDays,
  createdBy,
  metadata = {},
  gracePeriodDays = 30,
  signingRequired = false,
  allowedIps = null,
  notificationEmail = null,
}) {
  await initializeApiKeysTable();
  const rawKey = crypto.randomBytes(32).toString('hex');
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.substring(0, 8);
  const keySecret = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const expiresAt = expiresInDays ? now + expiresInDays * 24 * 60 * 60 * 1000 : null;
  const allowedIpsJson = allowedIps && allowedIps.length > 0 ? JSON.stringify(allowedIps) : null;

  const result = await db.run(
    `INSERT INTO api_keys
       (key_hash, key_prefix, name, role, status, created_by, metadata, expires_at,
        created_at, grace_period_days, signing_required, key_secret, allowed_ips, notification_email)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      keyHash, keyPrefix, name, role,
      createdBy || null, JSON.stringify(metadata), expiresAt,
      now, gracePeriodDays, signingRequired ? 1 : 0, keySecret,
      allowedIpsJson, notificationEmail || null,
    ]
  );

  return {
    id: result.id,
    key: rawKey,
    keySecret,
    keyPrefix,
    name,
    role,
    status: API_KEY_STATUS.ACTIVE,
    createdAt: new Date(now).toISOString(),
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    gracePeriodDays,
    signingRequired: !!signingRequired,
    allowedIps: allowedIps || null,
    notificationEmail: notificationEmail || null,
  };
}

/**
 * Validate a raw API key and return its metadata, or null if invalid/expired.
 *
 * @param {string} rawKey
 * @returns {Promise<Object|null>}
 */
async function validateApiKey(rawKey) {
  await initializeApiKeysTable();
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const now = Date.now();

  const row = await db.get(
    `SELECT * FROM api_keys WHERE key_hash = ?`,
    [keyHash]
  );

  if (!row) return null;
  if (row.status === API_KEY_STATUS.REVOKED) return null;
  if (row.expires_at && row.expires_at < now) return null;

  await db.run('UPDATE api_keys SET last_used_at = ? WHERE id = ?', [now, row.id]);

  return {
    id: row.id,
    keyPrefix: row.key_prefix,
    name: row.name,
    role: row.role,
    status: row.status,
    isDeprecated: row.status === API_KEY_STATUS.DEPRECATED,
    last_used_at: now,
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
    gracePeriodDays: row.grace_period_days || 30,
    createdAt: row.created_at,
    expiresAt: row.expires_at || null,
    signingRequired: !!row.signing_required,
    keySecret: row.key_secret || null,
    allowedIps: row.allowed_ips ? JSON.parse(row.allowed_ips) : null,
    notificationEmail: row.notification_email || null,
  };
}

// Alias used by apiKey.js middleware
const validateKey = validateApiKey;

/**
 * List API keys with optional filters.
 *
 * @param {Object} [filters={}]
 * @param {string} [filters.status]
 * @param {string} [filters.role]
 * @returns {Promise<Array>}
 */
async function listApiKeys(filters = {}) {
  await initializeApiKeysTable();
  let sql = 'SELECT * FROM api_keys WHERE 1=1';
  const params = [];
  if (filters.status) { sql += ' AND status = ?'; params.push(filters.status); }
  if (filters.role) { sql += ' AND role = ?'; params.push(filters.role); }
  sql += ' ORDER BY created_at DESC';

  const rows = await db.all(sql, params);
  return rows.map(row => ({
    id: row.id,
    keyPrefix: row.key_prefix,
    name: row.name,
    role: row.role,
    status: row.status,
    isDeprecated: row.status === API_KEY_STATUS.DEPRECATED,
    last_used_at: row.last_used_at,
    created_at: row.created_at,
    expires_at: row.expires_at,
    deprecated_at: row.deprecated_at,
    revoked_at: row.revoked_at,
    notification_email: row.notification_email || null,
  }));
}

/**
 * Deprecate an active API key (marks it for rotation grace period).
 *
 * @param {number} id
 * @returns {Promise<boolean>}
 */
async function deprecateApiKey(id) {
  await initializeApiKeysTable();
  const result = await db.run(
    `UPDATE api_keys SET status = 'deprecated', deprecated_at = ? WHERE id = ? AND status = 'active'`,
    [Date.now(), id]
  );
  return result.changes > 0;
}

/**
 * Revoke an API key immediately.
 *
 * @param {number} id
 * @returns {Promise<boolean>}
 */
async function revokeApiKey(id) {
  await initializeApiKeysTable();
  const result = await db.run(
    `UPDATE api_keys SET status = 'revoked', revoked_at = ? WHERE id = ? AND status != 'revoked'`,
    [Date.now(), id]
  );
  return result.changes > 0;
}

/**
 * Update mutable fields on an API key.
 *
 * @param {number} id
 * @param {Object} updates
 * @returns {Promise<boolean>}
 */
async function updateApiKey(id, updates = {}) {
  await initializeApiKeysTable();
  const allowed = ['name', 'role', 'metadata', 'signing_required', 'allowed_ips', 'notification_email'];
  const fields = Object.keys(updates).filter(k => allowed.includes(k));
  if (fields.length === 0) return false;
  const sets = fields.map(f => `${f} = ?`).join(', ');
  const values = fields.map(f => {
    if (f === 'metadata') return JSON.stringify(updates[f]);
    if (f === 'allowed_ips') return updates[f] ? JSON.stringify(updates[f]) : null;
    return updates[f];
  });
  const result = await db.run(`UPDATE api_keys SET ${sets} WHERE id = ?`, [...values, id]);
  return result.changes > 0;
}

/**
 * Delete revoked keys older than retentionDays.
 *
 * @param {number} [retentionDays=90]
 * @returns {Promise<number>} Number of deleted rows
 */
async function cleanupOldKeys(retentionDays = 90) {
  await initializeApiKeysTable();
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const result = await db.run(
    `DELETE FROM api_keys WHERE status = 'revoked' AND revoked_at < ?`,
    [cutoff]
  );
  return result.changes;
}

/**
 * Atomically create a new key and deprecate the old one.
 * If new key creation fails, the old key remains active.
 *
 * @param {number} oldKeyId
 * @param {Object} [opts]
 * @param {number} [opts.gracePeriodDays=30]
 * @returns {Promise<Object|null>}
 */
async function rotateApiKey(oldKeyId, { gracePeriodDays = 30 } = {}) {
  await initializeApiKeysTable();

  const oldRow = await db.get(`SELECT * FROM api_keys WHERE id = ?`, [oldKeyId]);
  if (!oldRow) return null;
  if (oldRow.status === API_KEY_STATUS.REVOKED) return null;

  const newKey = await createApiKey({
    name: `${oldRow.name} (rotated)`,
    role: oldRow.role,
    createdBy: oldRow.created_by,
    metadata: oldRow.metadata ? JSON.parse(oldRow.metadata) : {},
    gracePeriodDays,
    notificationEmail: oldRow.notification_email || null,
  });

  const now = Date.now();
  await db.run(
    `UPDATE api_keys SET status = 'deprecated', deprecated_at = ?, rotated_to_id = ?, grace_period_days = ? WHERE id = ?`,
    [now, newKey.id, gracePeriodDays, oldKeyId]
  );

  return {
    newKey,
    oldKeyId,
    deprecatedAt: new Date(now).toISOString(),
    gracePeriodDays,
    autoRevokeAt: new Date(now + gracePeriodDays * 24 * 60 * 60 * 1000).toISOString(),
  };
}

/**
 * Revoke deprecated keys whose grace period has elapsed.
 * Called by the background scheduler.
 *
 * @returns {Promise<number>} Number of revoked keys
 */
async function revokeExpiredDeprecatedKeys() {
  await initializeApiKeysTable();
  const now = Date.now();
  const result = await db.run(
    `UPDATE api_keys
     SET status = 'revoked', revoked_at = ?
     WHERE status = 'deprecated'
       AND deprecated_at IS NOT NULL
       AND (deprecated_at + (grace_period_days * 86400000)) <= ?`,
    [now, now]
  );
  return result.changes;
}

/**
 * Fetch active keys that expire within the given number of days and have not yet
 * received a notification at this threshold level.
 *
 * The deduplication logic uses last_expiry_notification_sent_at which stores the
 * threshold (e.g. 7 or 1). A key is included when:
 *   - last_expiry_notification_sent_at IS NULL  (never notified), OR
 *   - last_expiry_notification_sent_at > withinDays  (only a wider threshold was sent)
 *
 * @param {number} withinDays - Look-ahead window in days (e.g. 7 or 1)
 * @returns {Promise<Array>}
 */
async function getKeysExpiringWithin(withinDays) {
  await initializeApiKeysTable();
  const now = Date.now();
  const windowEnd = now + withinDays * 24 * 60 * 60 * 1000;

  const rows = await db.all(
    `SELECT id, name, key_prefix, expires_at, notification_email,
            last_expiry_notification_sent_at, metadata
     FROM api_keys
     WHERE status = 'active'
       AND expires_at IS NOT NULL
       AND expires_at > ?
       AND expires_at <= ?
       AND (last_expiry_notification_sent_at IS NULL
            OR last_expiry_notification_sent_at > ?)`,
    [now, windowEnd, withinDays]
  );

  return rows.map(row => ({
    id: row.id,
    name: row.name,
    keyPrefix: row.key_prefix,
    expiresAt: row.expires_at,
    notificationEmail: row.notification_email || null,
    lastExpiryNotificationSentAt: row.last_expiry_notification_sent_at,
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
  }));
}

/**
 * Record that an expiry notification was sent for a key at a given threshold.
 * Stores the threshold (days) so we don't re-send the same level.
 *
 * @param {number} id - API key ID
 * @param {number} thresholdDays - The notification threshold (e.g. 7 or 1)
 * @returns {Promise<void>}
 */
async function markExpiryNotificationSent(id, thresholdDays) {
  await db.run(
    `UPDATE api_keys SET last_expiry_notification_sent_at = ? WHERE id = ?`,
    [thresholdDays, id]
  );
}

module.exports = {
  initializeApiKeysTable,
  createApiKey,
  validateApiKey,
  validateKey,
  updateApiKey,
  listApiKeys,
  deprecateApiKey,
  revokeApiKey,
  cleanupOldKeys,
  rotateApiKey,
  revokeExpiredDeprecatedKeys,
  getKeysExpiringWithin,
  markExpiryNotificationSent,
};
