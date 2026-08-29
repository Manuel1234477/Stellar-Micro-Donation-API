/**
 * JWT Token Service - Access & Refresh Token Management
 *
 * RESPONSIBILITY: Issue, verify, and rotate JWT access/refresh token pairs
 * OWNER: Security Team
 * DEPENDENCIES: crypto, database, securityConfig
 *
 * Security model:
 * - Access tokens: short-lived (15 min), HMAC-SHA256 signed, stateless
 * - Refresh tokens: long-lived (7 days), stored as SHA-256 hash, single-use
 * - Token family revocation: reusing a consumed refresh token revokes all
 *   tokens in the same family (detects theft)
 */

const crypto = require('crypto');
const db = require('../utils/database');
const { securityConfig } = require('../config/securityConfig');
const log = require('../utils/log');

const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;       // 15 minutes
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Absolute lifetime of a token family. Rotation issues a fresh refresh token
// each time, so without this bound an active session could be extended forever.
// Anchored on family creation, never on the latest rotation.
const REFRESH_TOKEN_ABSOLUTE_TTL_DAYS =
  Number(process.env.REFRESH_TOKEN_ABSOLUTE_TTL_DAYS) > 0
    ? Number(process.env.REFRESH_TOKEN_ABSOLUTE_TTL_DAYS)
    : 30;
const REFRESH_TOKEN_ABSOLUTE_TTL_MS =
  REFRESH_TOKEN_ABSOLUTE_TTL_DAYS * 24 * 60 * 60 * 1000;

// Device identifiers are client-supplied and only ever displayed back to the
// owner, so they are length-capped rather than validated against a format.
const MAX_DEVICE_ID_LENGTH = 128;

const CREATE_TABLE_SQL = `
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
`;

const CREATE_REVOCATIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS refresh_token_revocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jti TEXT NOT NULL UNIQUE,
    api_key_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked_at INTEGER NOT NULL,
    reason TEXT
  )
`;

/**
 * Initializes the refresh_tokens and refresh_token_revocations tables.
 * @returns {Promise<void>}
 */
async function initializeRefreshTokensTable() {
  await db.run(CREATE_TABLE_SQL);
  // Add jti column to existing tables that predate this change
  try { await db.run(`ALTER TABLE refresh_tokens ADD COLUMN jti TEXT`); } catch (_) { /* best-effort */ }
  try { await db.run(`ALTER TABLE refresh_tokens ADD COLUMN device_id TEXT`); } catch (_) { /* best-effort */ }
  try { await db.run(`ALTER TABLE refresh_tokens ADD COLUMN family_started_at INTEGER`); } catch (_) { /* best-effort */ }
  await db.run(`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_device ON refresh_tokens(api_key_id, device_id)`);
  await db.run(CREATE_REVOCATIONS_TABLE_SQL);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_revocations_jti ON refresh_token_revocations(jti)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_revocations_expires ON refresh_token_revocations(expires_at)`);
}

/**
 * Returns the HMAC secret used to sign access tokens.
 * Falls back to a deterministic dev secret when ENCRYPTION_KEY is absent.
 * @returns {string}
 */
function getTokenSecret() {
  return securityConfig.ENCRYPTION_KEY || 'dev_jwt_secret_change_in_production';
}

/**
 * Encodes an object as a base64url string (no padding).
 * @param {object} obj
 * @returns {string}
 */
function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

/**
 * Issues a signed JWT access token (HS256, 15-minute TTL).
 * @param {object} payload - Claims to embed (sub, role, etc.)
 * @returns {string} Signed JWT string
 */
function issueAccessToken(payload) {
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const now = Math.floor(Date.now() / 1000);
  const claims = b64url({
    ...payload,
    iat: now,
    exp: now + Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
  });
  const sig = crypto
    .createHmac('sha256', getTokenSecret())
    .update(`${header}.${claims}`)
    .digest('base64url');
  return `${header}.${claims}.${sig}`;
}

/**
 * Verifies a JWT access token signature and expiry.
 * @param {string} token
 * @returns {{ valid: boolean, payload?: object, reason?: string }}
 */
function verifyAccessToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return { valid: false, reason: 'malformed token' };
    const [header, claims, sig] = parts;
    const expected = crypto
      .createHmac('sha256', getTokenSecret())
      .update(`${header}.${claims}`)
      .digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return { valid: false, reason: 'invalid signature' };
    }
    const payload = JSON.parse(Buffer.from(claims, 'base64url').toString());
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return { valid: false, reason: 'token expired' };
    }
    return { valid: true, payload };
  } catch {
    return { valid: false, reason: 'malformed token' };
  }
}

/**
 * Issues a new refresh token, persists its hash and jti, and returns the raw token.
 * @param {number} apiKeyId
 * @param {string} familyId - Token family identifier (UUID)
 * @returns {Promise<string>} Raw refresh token (shown once)
 */
async function issueRefreshToken(apiKeyId, familyId, options = {}) {
  await initializeRefreshTokensTable();
  const raw = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const jti = crypto.randomUUID();
  const now = Date.now();
  const deviceId = normalizeDeviceId(options.deviceId);
  // A rotated token inherits the family's original start so the absolute
  // deadline stays fixed; a brand-new family starts now.
  const familyStartedAt = options.familyStartedAt || now;
  // The sliding window never outlives the absolute deadline.
  const expiresAt = Math.min(
    now + REFRESH_TOKEN_TTL_MS,
    familyStartedAt + REFRESH_TOKEN_ABSOLUTE_TTL_MS
  );
  await db.run(
    `INSERT INTO refresh_tokens
       (jti, token_hash, api_key_id, family_id, device_id, family_started_at, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [jti, hash, apiKeyId, familyId, deviceId, familyStartedAt, expiresAt, now]
  );
  return raw;
}

/**
 * Normalizes a client-supplied device identifier.
 * Rejects absent, non-string, or over-long values rather than storing them.
 * @param {unknown} deviceId
 * @returns {string|null}
 */
function normalizeDeviceId(deviceId) {
  if (typeof deviceId !== 'string') return null;
  const trimmed = deviceId.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_DEVICE_ID_LENGTH);
}

/**
 * The instant a token family began, tolerating rows written before the
 * family_started_at column existed.
 * @param {object} row - A refresh_tokens row
 * @returns {number} Epoch milliseconds
 */
function familyStartOf(row) {
  return row.family_started_at || row.created_at;
}

/**
 * Whether a token family has passed its absolute deadline.
 * @param {object} row - A refresh_tokens row
 * @param {number} now - Epoch milliseconds
 * @returns {boolean}
 */
function isAbsolutelyExpired(row, now) {
  return now >= familyStartOf(row) + REFRESH_TOKEN_ABSOLUTE_TTL_MS;
}

/**
 * Rotates a refresh token: validates the old token, revokes it, issues a new
 * access + refresh token pair. If the old token was already used, the entire
 * token family is revoked (theft detection).
 *
 * @param {string} rawRefreshToken - The raw refresh token from the client
 * @returns {Promise<{ accessToken: string, refreshToken: string, apiKeyId: number } | null>}
 *   Returns null if the token is invalid or expired.
 * @throws {Error} With code 'TOKEN_REUSE_DETECTED' if token reuse is detected
 */
async function rotateRefreshToken(rawRefreshToken, options = {}) {
  await initializeRefreshTokensTable();
  const hash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
  const row = await db.get(
    `SELECT * FROM refresh_tokens WHERE token_hash = ?`,
    [hash]
  );

  if (!row) return null;

  // Token already used → revoke entire family (theft detection)
  // Check this BEFORE the revocations table so reuse always returns TOKEN_REUSE_DETECTED
  if (row.used_at !== null) {
    log.warn('JWT_SERVICE', 'Refresh token reuse detected — revoking family', {
      familyId: row.family_id,
      apiKeyId: row.api_key_id,
    });
    await revokeTokenFamily(row.family_id, 'REFRESH_TOKEN_REUSE_DETECTED');

    // Audit log for security monitoring
    try {
      const AuditLogService = require('./AuditLogService');
      await AuditLogService.log({
        category: 'AUTHENTICATION',
        action: 'REFRESH_TOKEN_REUSE_DETECTED',
        severity: 'HIGH',
        result: 'FAILURE',
        userId: String(row.api_key_id),
        details: { familyId: row.family_id, tokenId: row.id, jti: row.jti },
        reason: 'Refresh token reuse detected; entire token family revoked',
      });
    } catch (_) { /* audit log failure must not block the security response */ }

    const err = new Error('Refresh token reuse detected; token family revoked');
    err.code = 'TOKEN_REUSE_DETECTED';
    throw err;
  }

  if (row.revoked) {
    const err = new Error('Refresh token has been revoked');
    err.code = 'TOKEN_REVOKED';
    throw err;
  }

  // Check revocation table by jti (covers tokens revoked via revokeTokenFamily)
  if (row.jti) {
    const revocation = await db.get(
      `SELECT id FROM refresh_token_revocations WHERE jti = ?`,
      [row.jti]
    );
    if (revocation) {
      const err = new Error('Refresh token has been revoked');
      err.code = 'TOKEN_REVOKED';
      throw err;
    }
  }

  // Absolute deadline: a family may not be rotated past it, however recently
  // its newest token was issued. Revoke the family so the stale credential
  // cannot be presented again.
  if (isAbsolutelyExpired(row, Date.now())) {
    log.warn('JWT_SERVICE', 'Refresh token family passed its absolute expiry', {
      familyId: row.family_id,
      apiKeyId: row.api_key_id,
    });
    await revokeTokenFamily(row.family_id, 'ABSOLUTE_EXPIRY_REACHED');
    const err = new Error('Refresh token family has reached its absolute expiry');
    err.code = 'TOKEN_ABSOLUTE_EXPIRY';
    throw err;
  }

  if (row.expires_at < Date.now()) return null;

  // Insert consumed token's jti into revocations table
  if (row.jti) {
    const now = Date.now();
    await db.run(
      `INSERT OR IGNORE INTO refresh_token_revocations (jti, api_key_id, expires_at, revoked_at, reason)
       VALUES (?, ?, ?, ?, ?)`,
      [row.jti, row.api_key_id, row.expires_at, now, 'ROTATED']
    );
  }

  // Mark old token as used
  await db.run(
    `UPDATE refresh_tokens SET used_at = ? WHERE id = ?`,
    [Date.now(), row.id]
  );

  // Issue new token pair in the same family
  const accessToken = issueAccessToken({ sub: row.api_key_id, role: 'user' });
  // The device stays bound to the family. A caller may supply one only to label
  // a family that has none yet; it can never re-point an already-labelled family.
  const deviceId = row.device_id || normalizeDeviceId(options.deviceId);
  const newRefreshToken = await issueRefreshToken(row.api_key_id, row.family_id, {
    deviceId,
    familyStartedAt: familyStartOf(row),
  });

  return {
    accessToken,
    refreshToken: newRefreshToken,
    apiKeyId: row.api_key_id,
    deviceId,
    familyId: row.family_id,
  };
}

/**
 * Revokes all refresh tokens belonging to a token family.
 * @param {string} familyId
 * @param {string} [reason] - Optional reason for revocation
 * @returns {Promise<void>}
 */
async function revokeTokenFamily(familyId, reason) {
  const now = Date.now();
  await db.run(
    `UPDATE refresh_tokens SET revoked = 1, revoked_at = ?, revoke_reason = ? WHERE family_id = ?`,
    [now, reason || null, familyId]
  );
  // Also insert all active jtis from this family into the revocations table
  const rows = await db.query(
    `SELECT jti, api_key_id, expires_at FROM refresh_tokens WHERE family_id = ? AND jti IS NOT NULL`,
    [familyId]
  );
  for (const r of rows) {
    await db.run(
      `INSERT OR IGNORE INTO refresh_token_revocations (jti, api_key_id, expires_at, revoked_at, reason)
       VALUES (?, ?, ?, ?, ?)`,
      [r.jti, r.api_key_id, r.expires_at, now, reason || 'FAMILY_REVOKED']
    );
  }
}

/**
 * Verifies a raw refresh token is valid and not revoked.
 * @param {string} rawRefreshToken
 * @returns {Promise<{ valid: boolean, row?: object, reason?: string }>}
 */
async function verifyRefreshToken(rawRefreshToken) {
  await initializeRefreshTokensTable();
  const hash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
  const row = await db.get(`SELECT * FROM refresh_tokens WHERE token_hash = ?`, [hash]);

  if (!row) return { valid: false, reason: 'token not found' };
  if (row.expires_at < Date.now()) return { valid: false, reason: 'token expired' };
  if (row.revoked) return { valid: false, reason: 'token revoked' };
  if (row.used_at !== null) return { valid: false, reason: 'token already used' };

  // Check revocations table by jti
  if (row.jti) {
    const revocation = await db.get(
      `SELECT id FROM refresh_token_revocations WHERE jti = ?`,
      [row.jti]
    );
    if (revocation) return { valid: false, reason: 'token revoked (jti)' };
  }

  return { valid: true, row };
}

/**
 * Delete expired entries from refresh_token_revocations to prevent unbounded growth.
 * Should be called by a background job periodically.
 * @returns {Promise<number>} Number of rows deleted
 */
async function cleanupExpiredRevocations() {
  await initializeRefreshTokensTable();
  const now = Date.now();
  const result = await db.run(
    `DELETE FROM refresh_token_revocations WHERE expires_at < ?`,
    [now]
  );
  // Also clean up expired refresh_tokens
  await db.run(`DELETE FROM refresh_tokens WHERE expires_at < ?`, [now]);
  return result.changes || 0;
}

/**
 * Revokes all refresh tokens for a given API key (e.g. on key rotation).
 * @param {number} apiKeyId
 * @returns {Promise<void>}
 */
async function revokeAllForApiKey(apiKeyId) {
  await initializeRefreshTokensTable();
  await db.run(
    `UPDATE refresh_tokens SET revoked = 1 WHERE api_key_id = ?`,
    [apiKeyId]
  );
}

/**
 * Issues an initial access + refresh token pair for an API key.
 * Creates a new token family.
 * @param {number} apiKeyId
 * @param {object} [claims={}] - Extra claims for the access token
 * @returns {Promise<{ accessToken: string, refreshToken: string, familyId: string }>}
 */
async function issueTokenPair(apiKeyId, claims = {}, options = {}) {
  const familyId = crypto.randomUUID();
  const deviceId = normalizeDeviceId(options.deviceId);
  const accessToken = issueAccessToken({ sub: apiKeyId, ...claims });
  const refreshToken = await issueRefreshToken(apiKeyId, familyId, { deviceId });
  return { accessToken, refreshToken, familyId, deviceId };
}

/**
 * Lists the active token families for an API key, one row per session, so a
 * user can recognise their devices and revoke a specific one.
 * @param {number} apiKeyId
 * @returns {Promise<Array<{familyId: string, deviceId: string|null, startedAt: number, absoluteExpiresAt: number, lastIssuedAt: number}>>}
 */
async function listSessionsForApiKey(apiKeyId) {
  await initializeRefreshTokensTable();
  const rows = await db.query(
    `SELECT family_id,
            MAX(device_id)         AS device_id,
            MIN(created_at)        AS started_at,
            MAX(created_at)        AS last_issued_at,
            MIN(family_started_at) AS family_started_at
       FROM refresh_tokens
      WHERE api_key_id = ? AND revoked = 0
      GROUP BY family_id`,
    [apiKeyId]
  );
  const now = Date.now();
  return rows
    .map((r) => {
      const startedAt = r.family_started_at || r.started_at;
      return {
        familyId: r.family_id,
        deviceId: r.device_id || null,
        startedAt,
        lastIssuedAt: r.last_issued_at,
        absoluteExpiresAt: startedAt + REFRESH_TOKEN_ABSOLUTE_TTL_MS,
      };
    })
    .filter((session) => session.absoluteExpiresAt > now);
}

/**
 * Revokes every token family an API key holds on one device.
 * @param {number} apiKeyId
 * @param {string} deviceId
 * @returns {Promise<number>} Number of families revoked
 */
async function revokeDeviceSessions(apiKeyId, deviceId) {
  await initializeRefreshTokensTable();
  const normalized = normalizeDeviceId(deviceId);
  if (!normalized) return 0;
  const rows = await db.query(
    `SELECT DISTINCT family_id FROM refresh_tokens
      WHERE api_key_id = ? AND device_id = ? AND revoked = 0`,
    [apiKeyId, normalized]
  );
  for (const row of rows) {
    await revokeTokenFamily(row.family_id, 'DEVICE_SESSION_REVOKED');
  }
  return rows.length;
}

module.exports = {
  initializeRefreshTokensTable,
  listSessionsForApiKey,
  revokeDeviceSessions,
  normalizeDeviceId,
  issueAccessToken,
  verifyAccessToken,
  verifyRefreshToken,
  issueRefreshToken,
  issueTokenPair,
  rotateRefreshToken,
  revokeTokenFamily,
  revokeAllForApiKey,
  cleanupExpiredRevocations,
  ACCESS_TOKEN_TTL_MS,
  REFRESH_TOKEN_TTL_MS,
  REFRESH_TOKEN_ABSOLUTE_TTL_MS,
};
