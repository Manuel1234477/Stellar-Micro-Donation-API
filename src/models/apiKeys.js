const db = require('../utils/database');
const crypto = require('crypto');
const { API_KEY_STATUS } = require('../constants/index');

let isInitialized = false;
let initializationPromise = null;

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
    scopes TEXT,
    allowed_ips TEXT,
    notification_email TEXT,
    last_expiry_notification_sent_at INTEGER,
    monthly_quota INTEGER,
    quota_used INTEGER NOT NULL DEFAULT 0,
    quota_reset_at INTEGER,
    tenant_id TEXT NOT NULL DEFAULT 'default'
  )
`;

/**
 * Ensure the api_keys table exists and all optional columns are present.
 * Safe to call multiple times (idempotent).
 */
async function initializeApiKeysTable() {
  if (isInitialized) return;
  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    try {
      await db.run(CREATE_TABLE_SQL);
      isInitialized = true;
    } finally {
      initializationPromise = null;
    }
  })();

  return initializationPromise;
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
  monthlyQuota = null,
  scopes = [],
}) {
  await initializeApiKeysTable();
  const rawKey = crypto.randomBytes(32).toString('hex');
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.substring(0, 8);
  const keySecret = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const expiresAt = expiresInDays ? now + expiresInDays * 24 * 60 * 60 * 1000 : null;
  const allowedIpsJson = allowedIps && allowedIps.length > 0 ? JSON.stringify(allowedIps) : null;
  
  // Set quota reset to first of next month if quota is specified
  const quotaResetAt = monthlyQuota ? getNextMonthFirstDay() : null;

  const result = await db.run(
    `INSERT INTO api_keys (
      key_hash, key_prefix, name, role, status, created_by, metadata, 
      expires_at, created_at, grace_period_days, signing_required, 
      key_secret, scopes, allowed_ips, monthly_quota, quota_used, quota_reset_at,
      notification_email
    ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [
      keyHash, keyPrefix, name, role, createdBy || null, JSON.stringify(metadata), 
      expiresAt, now, gracePeriodDays, signingRequired ? 1 : 0, 
      keySecret, JSON.stringify(scopes || []), allowedIpsJson, monthlyQuota,
      quotaResetAt, notificationEmail || null
    ]
  );

  return {
    id: result.id,
    key: rawKey,
    keySecret,
    keyPrefix,
    name,
    role,
    scopes: scopes || [],
    status: API_KEY_STATUS.ACTIVE,
    createdAt: new Date(now).toISOString(),
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    gracePeriodDays,
    signingRequired: !!signingRequired,
    allowedIps: allowedIps || null,
    monthlyQuota,
    quotaUsed: 0,
    quotaResetAt: quotaResetAt ? new Date(quotaResetAt).toISOString() : null,
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

  // Check and reset quota if needed
  if (row.monthly_quota && row.quota_reset_at && row.quota_reset_at <= now) {
    await resetQuota(row.id);
    row.quota_used = 0;
    row.quota_reset_at = getNextMonthFirstDay();
  }

  // Update last_used_at
  await db.run('UPDATE api_keys SET last_used_at = ? WHERE id = ?', [now, row.id]);

  return {
    id: row.id,
    keyPrefix: row.key_prefix,
    name: row.name,
    role: row.role,
    scopes: row.scopes ? JSON.parse(row.scopes) : [],
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
    monthlyQuota: row.monthly_quota,
    quotaUsed: row.quota_used || 0,
    quotaResetAt: row.quota_reset_at,
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
    scopes: row.scopes ? JSON.parse(row.scopes) : [],
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
    scopes: oldRow.scopes ? JSON.parse(oldRow.scopes) : [],
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
 * Get the first day of next month at midnight UTC
 * @returns {number} Timestamp in milliseconds
 */
function getNextMonthFirstDay() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  // Next month (0-11, so +1 wraps to next year if needed)
  const nextMonth = month === 11 ? 0 : month + 1;
  const nextYear = month === 11 ? year + 1 : year;
  return Date.UTC(nextYear, nextMonth, 1, 0, 0, 0, 0);
}

/**
 * Reset quota for a specific API key
 * @param {number} keyId - API key ID
 * @returns {Promise<boolean>} True if reset successful
 */
async function resetQuota(keyId) {
  await initializeApiKeysTable();
  const nextReset = getNextMonthFirstDay();
  const result = await db.run(
    `UPDATE api_keys SET quota_used = 0, quota_reset_at = ? WHERE id = ?`,
    [nextReset, keyId]
  );
  return result.changes > 0;
}

/**
 * Increment quota usage for an API key
 * @param {number} keyId - API key ID
 * @returns {Promise<{quotaUsed: number, quotaRemaining: number|null}>}
 */
async function incrementQuota(keyId) {
  await initializeApiKeysTable();
  const row = await db.get(`SELECT monthly_quota, quota_used FROM api_keys WHERE id = ?`, [keyId]);
  
  if (!row) {
    throw new Error('API key not found');
  }

  const newUsed = (row.quota_used || 0) + 1;
  await db.run(`UPDATE api_keys SET quota_used = ? WHERE id = ?`, [newUsed, keyId]);

  return {
    quotaUsed: newUsed,
    quotaRemaining: row.monthly_quota ? row.monthly_quota - newUsed : null,
  };
}

/**
 * Reset all quotas for keys that have passed their reset date
 * Called by background scheduler on the first of each month
 * @returns {Promise<number>} Number of keys reset
 */
async function resetExpiredQuotas() {
  await initializeApiKeysTable();
  const now = Date.now();
  const nextReset = getNextMonthFirstDay();
  
  const result = await db.run(
    `UPDATE api_keys 
     SET quota_used = 0, quota_reset_at = ?
     WHERE monthly_quota IS NOT NULL 
       AND quota_reset_at IS NOT NULL 
       AND quota_reset_at <= ?`,
    [nextReset, now]
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
  // Also persist to the notices log table (idempotent — ignore duplicate)
  try {
    await db.run(
      `CREATE TABLE IF NOT EXISTS api_key_expiration_notices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        api_key_id INTEGER NOT NULL,
        threshold_days INTEGER NOT NULL,
        sent_at INTEGER NOT NULL
      )`
    );
    await db.run(
      `INSERT INTO api_key_expiration_notices (api_key_id, threshold_days, sent_at)
       VALUES (?, ?, ?)`,
      [id, thresholdDays, Date.now()]
    );
  } catch (_) { /* best-effort */ }
}

/**
 * List all expiration notices sent for a given API key.
 * @param {number} keyId
 * @returns {Promise<Array<{id, thresholdDays, sentAt}>>}
 */
async function getExpirationNotices(keyId) {
  try {
    await db.run(
      `CREATE TABLE IF NOT EXISTS api_key_expiration_notices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        api_key_id INTEGER NOT NULL,
        threshold_days INTEGER NOT NULL,
        sent_at INTEGER NOT NULL
      )`
    );
    const rows = await db.all(
      `SELECT id, threshold_days, sent_at FROM api_key_expiration_notices
       WHERE api_key_id = ? ORDER BY sent_at DESC`,
      [keyId]
    );
    return rows.map(r => ({ id: r.id, thresholdDays: r.threshold_days, sentAt: r.sent_at }));
  } catch (_) {
    return [];
  }
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
  incrementQuota,
  resetQuota,
  resetExpiredQuotas,
  getNextMonthFirstDay,
  getKeysExpiringWithin,
  markExpiryNotificationSent,
  getExpirationNotices,
};
