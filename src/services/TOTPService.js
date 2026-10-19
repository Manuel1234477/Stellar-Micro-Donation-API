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

// ─── Encryption helper for secret at rest ─────────────────────────────────────

function encryptSecret(secret) {
  if (!secret) return secret;
  try {
    const EncryptionService = require('./EncryptionService');
    return EncryptionService.encryptField ? EncryptionService.encryptField(secret) : secret;
  } catch (_) {
    return secret;
  }
}

function decryptSecret(secret) {
  if (!secret) return secret;
  try {
    const EncryptionService = require('./EncryptionService');
    return EncryptionService.decryptField ? EncryptionService.decryptField(secret) : secret;
  } catch (_) {
    return secret;
  }
}

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
  const rawSecret = decryptSecret(secret);
  const keyBuf = base32Decode(rawSecret);
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
    'ALTER TABLE api_keys ADD COLUMN totp_last_counter INTEGER',
  ];
  for (const sql of columns) {
    try {
      await db.run(sql);
    } catch (err) {
      const msg = (err.details && err.details.originalError) || err.originalError?.message || err.message || '';
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
async function generateSecret(keyId, keyName = 'AdminKey') {
  await ensureTotpColumns();

  // 20 bytes → 160-bit secret (recommended by RFC 4226)
  const secretBuf = crypto.randomBytes(20);
  const secret = base32Encode(secretBuf);

  const backupCodes = Array.from({ length: BACKUP_CODE_COUNT }, () =>
    crypto.randomBytes(BACKUP_CODE_BYTES).toString('hex')
  );

  // Store encrypted secret and hashed backup codes; totp_enabled stays 0 until verify
  const hashedCodes = backupCodes.map(c =>
    crypto.createHash('sha256').update(c).digest('hex')
  );

  const storedSecret = encryptSecret(secret);

  await db.run(
    `UPDATE api_keys SET totp_secret = ?, totp_backup_codes = ?, totp_enabled = 0, totp_last_counter = NULL WHERE id = ?`,
    [storedSecret, JSON.stringify(hashedCodes), keyId]
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
 * Replay protection (RFC 6238 §5.2): the last accepted time-step counter is
 * persisted per API key in SQLite (`api_keys.totp_last_counter`). A code whose
 * matched counter is less than or equal to the last accepted counter is
 * rejected, so a code observed once cannot be reused within its window (or any
 * earlier window) across instances and restarts.
 *
 * @param {number} keyId - API key database ID
 * @param {string} code - 6-digit TOTP code from the authenticator app
 * @param {number} [timestampMs=Date.now()] - Override for testing
 * @returns {Promise<boolean>} True when the code is valid and not replayed
 */
async function verify(keyId, code, timestampMs = Date.now()) {
  await ensureTotpColumns();

  if (!code || !/^\d{6}$/.test(String(code))) return false;

  const row = await db.get(
    `SELECT totp_secret, totp_last_counter FROM api_keys WHERE id = ?`,
    [keyId]
  );
  if (!row || !row.totp_secret) return false;

  const window = parseInt(process.env.TOTP_WINDOW || String(DEFAULT_WINDOW), 10);
  const counter = Math.floor(timestampMs / 1000 / TOTP_STEP);
  const keyBuf = base32Decode(decryptSecret(row.totp_secret));

  // Search the drift window for a matching code and remember its counter.
  let matchedCounter = null;
  for (let offset = -window; offset <= window; offset++) {
    const candidate = counter + offset;
    if (candidate < 0) continue;
    if (hotp(keyBuf, candidate) === String(code)) {
      matchedCounter = candidate;
      break;
    }
  }

  if (matchedCounter === null) return false;

  // Replay protection: reject codes at or before the last accepted time step.
  const lastCounter = row.totp_last_counter === null || row.totp_last_counter === undefined
    ? null
    : Number(row.totp_last_counter);

  if (lastCounter !== null && matchedCounter <= lastCounter) {
    log.warn('TOTP_SERVICE', 'Rejected replayed TOTP code', {
      keyId,
      matchedCounter,
      lastCounter,
    });
    try {
      const metrics = require('../utils/metrics');
      if (metrics && typeof metrics.increment === 'function') {
        metrics.increment('totp_replay_rejected_total', { keyId: String(keyId) });
      }
    } catch (_) {
      // metrics are best-effort; never block verification on them
    }
    return false;
  }

  // Persist the accepted counter so replays are blocked across instances/restarts.
  await db.run(
    `UPDATE api_keys SET totp_last_counter = ? WHERE id = ?`,
    [matchedCounter, keyId]
  );

  return true;
}

module.exports = {
  generateSecret,
  generateCode,
  verify,
  ensureTotpColumns,
  base32Encode,
  base32Decode,
  hotp,
  TOTP_STEP,
  TOTP_DIGITS,
};
