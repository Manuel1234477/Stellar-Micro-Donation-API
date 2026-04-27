/**
 * TOTP Service - Two-Factor Authentication Layer
 *
 * RESPONSIBILITY: Time-based One-Time Password (RFC 6238) generation, verification,
 *                 and lifecycle management for admin API keys.
 * OWNER: Security Team
 * DEPENDENCIES: crypto (built-in), qrcode
 *
 * Implements TOTP without external TOTP libraries to minimise the dependency
 * surface. The algorithm follows RFC 6238 / RFC 4226 (HOTP) exactly:
 *   1. Derive a counter from floor(unix_time / 30)
 *   2. HMAC-SHA1 the counter with the base32-decoded secret
 *   3. Dynamic truncation → 6-digit code
 *
 * Environment variables:
 *   TOTP_ISSUER  - Issuer name shown in authenticator apps (default: StellarDonationAPI)
 *   TOTP_WINDOW  - Number of 30-second windows to accept on each side (default: 1)
 */

'use strict';

const crypto = require('crypto');
const qrcode = require('qrcode');
const db = require('../utils/database');
const log = require('../utils/log');

// ─── Constants ────────────────────────────────────────────────────────────────

const TOTP_STEP = 30;          // seconds per window
const TOTP_DIGITS = 6;
const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_BYTES = 5;   // 10 hex chars per code
const ISSUER = process.env.TOTP_ISSUER || 'StellarDonationAPI';
const DEFAULT_WINDOW = 1;      // ±1 window tolerance

// ─── Base32 helpers ───────────────────────────────────────────────────────────

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Encode a Buffer as a base32 string (RFC 4648, no padding).
 *
 * @param {Buffer} buf
 * @returns {string}
 */
function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

/**
 * Decode a base32 string to a Buffer (RFC 4648, case-insensitive, ignores padding).
 *
 * @param {string} str
 * @returns {Buffer}
 */
function base32Decode(str) {
  const s = str.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const output = [];
  for (const char of s) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue; // skip unknown chars
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

// ─── HOTP / TOTP core ────────────────────────────────────────────────────────

/**
 * Compute an HOTP value for a given secret and counter (RFC 4226).
 *
 * @param {Buffer} keyBuf - Raw HMAC key bytes
 * @param {number} counter - 64-bit counter value
 * @returns {string} Zero-padded TOTP_DIGITS-digit code
 */
function hotp(keyBuf, counter) {
  // Encode counter as big-endian 8-byte buffer
  const counterBuf = Buffer.alloc(8);
  // JavaScript numbers are safe up to 2^53; split into two 32-bit halves
  const hi = Math.floor(counter / 0x100000000);
  const lo = counter >>> 0;
  counterBuf.writeUInt32BE(hi, 0);
  counterBuf.writeUInt32BE(lo, 4);

  const hmac = crypto.createHmac('sha1', keyBuf).update(counterBuf).digest();

  // Dynamic truncation
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(code % Math.pow(10, TOTP_DIGITS)).padStart(TOTP_DIGITS, '0');
}

/**
 * Compute the TOTP code for a given secret and timestamp.
 *
 * @param {string} secret - Base32-encoded TOTP secret
 * @param {number} [timestampMs=Date.now()] - Unix timestamp in milliseconds
 * @returns {string} 6-digit TOTP code
 */
function generateCode(secret, timestampMs = Date.now()) {
  const keyBuf = base32Decode(secret);
  const counter = Math.floor(timestampMs / 1000 / TOTP_STEP);
  return hotp(keyBuf, counter);
}

// ─── Database helpers ─────────────────────────────────────────────────────────

/**
 * Ensure the totp_secret, totp_enabled, and totp_backup_codes columns exist.
 * Safe to call multiple times (ALTER TABLE is idempotent via error swallowing).
 *
 * @returns {Promise<void>}
 */
async function ensureTotpColumns() {
  const columns = [
    'ALTER TABLE api_keys ADD COLUMN totp_secret TEXT',
    'ALTER TABLE api_keys ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE api_keys ADD COLUMN totp_backup_codes TEXT',
  ];
  for (const sql of columns) {
    try {
      await db.run(sql);
    } catch (err) {
      const msg = (err.details && err.details.originalError) || err.message || '';
      if (!msg.includes('duplicate column')) throw err;
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate a new TOTP secret and QR code data URL for an API key.
 * Does NOT enable TOTP — the caller must call `enable()` after verifying
 * the first code from the authenticator app.
 *
 * @param {number} keyId - API key database ID
 * @param {string} keyName - Human-readable label shown in the authenticator app
 * @returns {Promise<{secret: string, qrCodeDataUrl: string, backupCodes: string[], otpauthUrl: string}>}
 */
async function generateSecret(keyId, keyName) {
  await ensureTotpColumns();

  // 20 bytes → 160-bit secret (recommended by RFC 4226)
  const secretBuf = crypto.randomBytes(20);
  const secret = base32Encode(secretBuf);

  const backupCodes = Array.from({ length: BACKUP_CODE_COUNT }, () =>
    crypto.randomBytes(BACKUP_CODE_BYTES).toString('hex')
  );

  // Store secret and hashed backup codes; totp_enabled stays 0 until verify
  const hashedCodes = backupCodes.map(c =>
    crypto.createHash('sha256').update(c).digest('hex')
  );

  await db.run(
    `UPDATE api_keys SET totp_secret = ?, totp_backup_codes = ?, totp_enabled = 0 WHERE id = ?`,
    [secret, JSON.stringify(hashedCodes), keyId]
  );

  const label = encodeURIComponent(`${ISSUER}:${keyName}`);
  const issuerParam = encodeURIComponent(ISSUER);
  const otpauthUrl = `otpauth://totp/${label}?secret=${secret}&issuer=${issuerParam}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP}`;

  const qrCodeDataUrl = await qrcode.toDataURL(otpauthUrl);

  log.info('TOTP_SERVICE', 'TOTP secret generated', { keyId });

  return { secret, qrCodeDataUrl, backupCodes, otpauthUrl };
}

/**
 * Verify a TOTP code against the stored secret for an API key.
 * Accepts codes within ±TOTP_WINDOW windows of the current time.
 *
 * @param {number} keyId - API key database ID
 * @param {string} code - 6-digit TOTP code from the authenticator app
 * @param {number} [timestampMs=Date.now()] - Override for testing
 * @returns {Promise<boolean>} True when the code is valid
 */
async function verify(keyId, code, timestampMs = Date.now()) {
  await ensureTotpColumns();

  if (!code || !/^\d{6}$/.test(String(code))) return false;

  const row = await db.get(
    `SELECT totp_secret FROM api_keys WHERE id = ?`,
    [keyId]
  );
  if (!row || !row.totp_secret) return false;

  const window = parseInt(process.env.TOTP_WINDOW || String(DEFAULT_WINDOW), 10);
  const counter = Math.floor(timestampMs / 1000 / TOTP_STEP);
  const keyBuf = base32Decode(row.totp_secret);

  for (let delta = -window; delta <= window; delta++) {
    const expected = hotp(keyBuf, counter + delta);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(code).padStart(TOTP_DIGITS, '0')))) {
      return true;
    }
  }
  return false;
}

/**
 * Enable TOTP for an API key after the user has verified their first code.
 * Requires a valid TOTP code to prevent accidental lockout.
 *
 * @param {number} keyId - API key database ID
 * @param {string} code - 6-digit TOTP code confirming setup
 * @returns {Promise<{enabled: boolean, reason?: string}>}
 */
async function enable(keyId, code) {
  await ensureTotpColumns();

  const row = await db.get(
    `SELECT totp_secret, totp_enabled FROM api_keys WHERE id = ?`,
    [keyId]
  );
  if (!row) return { enabled: false, reason: 'API key not found' };
  if (!row.totp_secret) return { enabled: false, reason: 'TOTP not set up — call generateSecret first' };
  if (row.totp_enabled) return { enabled: false, reason: 'TOTP already enabled' };

  const valid = await verify(keyId, code);
  if (!valid) return { enabled: false, reason: 'Invalid TOTP code' };

  await db.run(`UPDATE api_keys SET totp_enabled = 1 WHERE id = ?`, [keyId]);
  log.info('TOTP_SERVICE', 'TOTP enabled', { keyId });
  return { enabled: true };
}

/**
 * Disable TOTP for an API key.
 * Requires a valid TOTP code or backup code to prevent unauthorised disabling.
 *
 * @param {number} keyId - API key database ID
 * @param {string} code - Current TOTP code or a backup code
 * @returns {Promise<{disabled: boolean, reason?: string}>}
 */
async function disable(keyId, code) {
  await ensureTotpColumns();

  const row = await db.get(
    `SELECT totp_secret, totp_enabled FROM api_keys WHERE id = ?`,
    [keyId]
  );
  if (!row) return { disabled: false, reason: 'API key not found' };
  if (!row.totp_enabled) return { disabled: false, reason: 'TOTP is not enabled' };

  // Accept either a live TOTP code or a backup code
  const totpValid = await verify(keyId, code);
  const backupValid = !totpValid && await verifyBackupCode(keyId, code);

  if (!totpValid && !backupValid) return { disabled: false, reason: 'Invalid code' };

  await db.run(
    `UPDATE api_keys SET totp_enabled = 0, totp_secret = NULL, totp_backup_codes = NULL WHERE id = ?`,
    [keyId]
  );
  log.info('TOTP_SERVICE', 'TOTP disabled', { keyId });
  return { disabled: true };
}

/**
 * Verify a single-use backup code for an API key.
 * The code is invalidated immediately on first use.
 *
 * @param {number} keyId - API key database ID
 * @param {string} rawCode - Plain-text backup code (10 hex chars)
 * @returns {Promise<boolean>} True when the code was valid and has been consumed
 */
async function verifyBackupCode(keyId, rawCode) {
  await ensureTotpColumns();

  if (!rawCode || typeof rawCode !== 'string') return false;

  const row = await db.get(
    `SELECT totp_backup_codes FROM api_keys WHERE id = ?`,
    [keyId]
  );
  if (!row || !row.totp_backup_codes) return false;

  let codes;
  try {
    codes = JSON.parse(row.totp_backup_codes);
  } catch {
    return false;
  }

  const hash = crypto.createHash('sha256').update(rawCode.trim()).digest('hex');
  const idx = codes.indexOf(hash);
  if (idx === -1) return false;

  // Invalidate the used code
  codes.splice(idx, 1);
  await db.run(
    `UPDATE api_keys SET totp_backup_codes = ? WHERE id = ?`,
    [JSON.stringify(codes), keyId]
  );

  log.info('TOTP_SERVICE', 'Backup code consumed', { keyId, remaining: codes.length });
  return true;
}

/**
 * Check whether TOTP is enabled for a given API key ID.
 *
 * @param {number} keyId - API key database ID
 * @returns {Promise<boolean>}
 */
async function isTotpEnabled(keyId) {
  await ensureTotpColumns();
  const row = await db.get(
    `SELECT totp_enabled FROM api_keys WHERE id = ?`,
    [keyId]
  );
  return Boolean(row && row.totp_enabled);
}

/**
 * Return the number of remaining backup codes for an API key.
 *
 * @param {number} keyId - API key database ID
 * @returns {Promise<number>}
 */
async function remainingBackupCodes(keyId) {
  await ensureTotpColumns();
  const row = await db.get(
    `SELECT totp_backup_codes FROM api_keys WHERE id = ?`,
    [keyId]
  );
  if (!row || !row.totp_backup_codes) return 0;
  try {
    return JSON.parse(row.totp_backup_codes).length;
  } catch {
    return 0;
  }
}

module.exports = {
  generateSecret,
  verify,
  enable,
  disable,
  verifyBackupCode,
  isTotpEnabled,
  remainingBackupCodes,
  // Exported for unit testing
  generateCode,
  base32Encode,
  base32Decode,
  ensureTotpColumns,
  TOTP_STEP,
  TOTP_DIGITS,
  BACKUP_CODE_COUNT,
};
