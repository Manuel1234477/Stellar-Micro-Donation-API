const db = require('../utils/database');
const crypto = require('crypto');
const log = require('../utils/log');
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
    key_secret TEXT
  )
`;

async function initializeApiKeysTable() {
  await db.run(CREATE_TABLE_SQL);
}

async function createApiKey({ name, role = 'user', expiresInDays, createdBy, metadata = {}, gracePeriodDays = 30, signingRequired = false }) {
  await initializeApiKeysTable();
  const rawKey = crypto.randomBytes(32).toString('hex');
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.substring(0, 8);
  // Generate a separate secret used only for HMAC signing (never returned after creation)
  const keySecret = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const expiresAt = expiresInDays ? now + expiresInDays * 24 * 60 * 60 * 1000 : null;

  const result = await db.run(
    `INSERT INTO api_keys (key_hash, key_prefix, name, role, status, created_by, metadata, expires_at, created_at, grace_period_days, signing_required, key_secret)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`,
    [keyHash, keyPrefix, name, role, createdBy || null, JSON.stringify(metadata), expiresAt, now, gracePeriodDays, signingRequired ? 1 : 0, keySecret]
  );

  return {
    id: result.id,
    key: rawKey,
    keySecret,          // returned ONCE at creation; store securely
    keyPrefix,
    name,
    role,
    status: API_KEY_STATUS.ACTIVE,
    createdAt: new Date(now).toISOString(),
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    gracePeriodDays,
    signingRequired: !!signingRequired,
  };
}

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

  // Update last_used_at
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
    signingRequired: !!row.signing_required,
    keySecret: row.key_secret || null,
  };
}

// Alias used by apiKey.js middleware
const validateKey = validateApiKey;

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
  }));
}

async function deprecateApiKey(id) {
  await initializeApiKeysTable();
  const result = await db.run(
    `UPDATE api_keys SET status = 'deprecated', deprecated_at = ? WHERE id = ? AND status = 'active'`,
    [Date.now(), id]
  );
  return result.changes > 0;
}

async function revokeApiKey(id) {
  await initializeApiKeysTable();
  const result = await db.run(
    `UPDATE api_keys SET status = 'revoked', revoked_at = ? WHERE id = ? AND status != 'revoked'`,
    [Date.now(), id]
  );
  return result.changes > 0;
}

async function updateApiKey(id, updates = {}) {
  await initializeApiKeysTable();
  const allowed = ['name', 'role', 'metadata', 'signing_required'];
  const fields = Object.keys(updates).filter(k => allowed.includes(k));
  if (fields.length === 0) return false;
  const sets = fields.map(f => `${f} = ?`).join(', ');
  const values = fields.map(f => f === 'metadata' ? JSON.stringify(updates[f]) : updates[f]);
  const result = await db.run(`UPDATE api_keys SET ${sets} WHERE id = ?`, [...values, id]);
  return result.changes > 0;
}

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
 */
async function rotateApiKey(oldKeyId, { gracePeriodDays = 30 } = {}) {
  await initializeApiKeysTable();

  const oldRow = await db.get(`SELECT * FROM api_keys WHERE id = ?`, [oldKeyId]);
  if (!oldRow) return null;
  if (oldRow.status === API_KEY_STATUS.REVOKED) return null;

  // Create the new key first — if this throws, old key is untouched
  const newKey = await createApiKey({
    name: `${oldRow.name} (rotated)`,
    role: oldRow.role,
    createdBy: oldRow.created_by,
    metadata: oldRow.metadata ? JSON.parse(oldRow.metadata) : {},
    gracePeriodDays,
  });

  // Deprecate old key, set its grace period for auto-revoke, and link it to the new one
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
 */
async function revokeExpiredDeprecatedKeys() {
  await initializeApiKeysTable();
  const now = Date.now();
  // deprecated_at + grace_period_days * ms_per_day <= now
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

module.exports = {
  initializeApiKeysTable,
  createApiKey,
  validateApiKey,
  validateKey,
  listApiKeys,
  deprecateApiKey,
  revokeApiKey,
  updateApiKey,
  cleanupOldKeys,
  rotateApiKey,
  revokeExpiredDeprecatedKeys,
};
