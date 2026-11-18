/**
 * Crypto Core - single implementation of symmetric encryption (#1776)
 *
 * RESPONSIBILITY: AES-256-GCM sealing/opening, envelope formats and key lookup
 * OWNER: Security Team
 * DEPENDENCIES: node:crypto, securityConfig (lazy)
 *
 * Every encryption path in the app goes through this module:
 *
 *   src/utils/encryption.js          wallet secrets (legacy + DEK envelope)  → wrapper
 *   src/services/EncryptionService.js field-level (versioned) + RSA hybrid    → wrapper
 *   src/utils/memoEncryption.js      ECDH-X25519 memo envelopes              → wrapper
 *   src/services/MemoEncryptionService.js memo lifecycle (calls memoEncryption)
 *   src/utils/kms.js                 local KEK wrapping of DEKs              → wrapper
 *   src/middleware/requestDecryption.js (calls EncryptionService)
 *
 * Guarantees enforced here, so wrappers cannot get them wrong:
 *   - Algorithm is always AES-256-GCM with a 32-byte key.
 *   - IV is always 12 random bytes generated inside seal(); callers cannot
 *     pass an IV, so an IV can never be reused deliberately or by mistake.
 *   - Auth tag is always 16 bytes and its length is checked before opening
 *     (authTagLength is pinned, rejecting truncated tags).
 *   - Failures to open throw CryptoError with code DECRYPTION_FAILED and no
 *     detail about which check failed.
 *
 * Envelope formats are documented in docs/security/ENCRYPTION.md.
 */

'use strict';

const nodeCrypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Matches "v<n>:<iv>:<ciphertext>:<tag>" (hex parts). */
const VERSIONED_RE = /^v(\d+):([0-9a-f]*):([0-9a-f]*):([0-9a-f]*)$/i;

class CryptoError extends Error {
  /**
   * @param {string} message
   * @param {string} code - INVALID_INPUT | INVALID_KEY | DECRYPTION_FAILED | KEY_NOT_CONFIGURED | INVALID_ENVELOPE
   */
  constructor(message, code) {
    super(message);
    this.name = 'CryptoError';
    this.code = code;
  }
}

// ─── Primitives ──────────────────────────────────────────────────────────────

function toBuffer(value, name) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  throw new CryptoError(`${name} must be a string or Buffer`, 'INVALID_INPUT');
}

function assertKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) {
    const got = Buffer.isBuffer(key) ? key.length : typeof key;
    throw new CryptoError(`Invalid AES key length: expected ${KEY_BYTES}, got ${got}`, 'INVALID_KEY');
  }
}

/**
 * Derive a 32-byte key from a secret string (SHA-256).
 * This is the derivation every existing stored ciphertext was produced with.
 *
 * @param {string|Buffer} secret
 * @returns {Buffer}
 */
function deriveKey(secret) {
  return nodeCrypto.createHash('sha256').update(secret).digest();
}

/**
 * Generate a random 32-byte data key.
 * @returns {Buffer}
 */
function generateKey() {
  return nodeCrypto.randomBytes(KEY_BYTES);
}

/**
 * Encrypt with AES-256-GCM using a fresh random 96-bit IV.
 *
 * @param {Buffer} key - 32-byte key
 * @param {string|Buffer} plaintext - strings are encoded as UTF-8
 * @param {Object} [options]
 * @param {Buffer} [options.aad] - Additional authenticated data
 * @returns {{ iv: Buffer, ciphertext: Buffer, tag: Buffer }}
 */
function seal(key, plaintext, options = {}) {
  assertKey(key);
  const data = toBuffer(plaintext, 'plaintext');
  const iv = nodeCrypto.randomBytes(IV_BYTES);
  const cipher = nodeCrypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  if (options.aad) cipher.setAAD(options.aad);
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  return { iv, ciphertext, tag: cipher.getAuthTag() };
}

/**
 * Decrypt and authenticate AES-256-GCM data.
 *
 * @param {Buffer} key - 32-byte key
 * @param {{ iv: Buffer, ciphertext: Buffer, tag: Buffer }} sealed
 * @param {Object} [options]
 * @param {Buffer} [options.aad]
 * @returns {Buffer} plaintext
 * @throws {CryptoError} INVALID_ENVELOPE on bad IV/tag length, DECRYPTION_FAILED on auth failure
 */
function open(key, { iv, ciphertext, tag }, options = {}) {
  assertKey(key);
  if (!Buffer.isBuffer(iv) || iv.length !== IV_BYTES) {
    throw new CryptoError(`Invalid IV length: expected ${IV_BYTES}, got ${iv ? iv.length : 0}`, 'INVALID_ENVELOPE');
  }
  if (!Buffer.isBuffer(tag) || tag.length !== TAG_BYTES) {
    throw new CryptoError(`Invalid auth tag length: expected ${TAG_BYTES}, got ${tag ? tag.length : 0}`, 'INVALID_ENVELOPE');
  }
  if (!Buffer.isBuffer(ciphertext)) {
    throw new CryptoError('ciphertext must be a Buffer', 'INVALID_ENVELOPE');
  }

  try {
    const decipher = nodeCrypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    if (options.aad) decipher.setAAD(options.aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (_) {
    throw new CryptoError('Decryption failed: invalid key or tampered ciphertext', 'DECRYPTION_FAILED');
  }
}

// ─── Key provider ────────────────────────────────────────────────────────────

/**
 * The single place encryption keys are looked up. Wrappers never read key
 * env vars themselves.
 *
 * Each source preserves the exact derivation the data was originally
 * written with, so existing ciphertexts keep decrypting.
 */
const keyProvider = {
  /**
   * Active version for new versioned envelopes (ENCRYPTION_KEY_VERSION, default 1).
   * @returns {number}
   */
  getActiveVersion() {
    const v = parseInt(process.env.ENCRYPTION_KEY_VERSION || '1', 10);
    return Number.isInteger(v) && v > 0 ? v : 1;
  },

  /**
   * Key for a versioned envelope: ENCRYPTION_KEY_<n>, with ENCRYPTION_KEY as
   * the fallback for version 1.
   *
   * @param {number} version
   * @returns {Buffer}
   */
  getVersionedKey(version) {
    const raw = version === 1
      ? (process.env.ENCRYPTION_KEY_1 || process.env.ENCRYPTION_KEY)
      : process.env[`ENCRYPTION_KEY_${version}`];
    if (!raw) throw new CryptoError(`No encryption key configured for version ${version}`, 'KEY_NOT_CONFIGURED');
    return deriveKey(raw);
  },

  /**
   * Key for unversioned "iv:ct:tag" wallet-secret ciphertexts (validated
   * ENCRYPTION_KEY from securityConfig; unwrapped from KMS at startup when
   * KMS_KEY_ID is set).
   *
   * @returns {Buffer}
   */
  getLegacyKey() {
    const { securityConfig } = require('../config/securityConfig');
    const key = securityConfig.ENCRYPTION_KEY;
    if (!key) throw new CryptoError('ENCRYPTION_KEY not available from security configuration', 'KEY_NOT_CONFIGURED');
    return deriveKey(key);
  },

  /**
   * Raw master secret for the local KMS provider (ENCRYPTION_KEY, or the
   * wrapped ENCRYPTED_ENCRYPTION_KEY when KMS is configured).
   *
   * @returns {string}
   */
  resolveMasterSecret() {
    if (process.env.KMS_KEY_ID || process.env.KMS_PROVIDER) {
      const encrypted = process.env.ENCRYPTED_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY;
      if (!encrypted || !encrypted.trim()) {
        throw new CryptoError('KMS is configured but ENCRYPTED_ENCRYPTION_KEY is not set. Supply the wrapped DEK before startup.', 'KEY_NOT_CONFIGURED');
      }
      if (process.env.ENCRYPTION_KEY && process.env.ENCRYPTED_ENCRYPTION_KEY) {
        throw new CryptoError('Do not set both ENCRYPTION_KEY and ENCRYPTED_ENCRYPTION_KEY. Use ENCRYPTED_ENCRYPTION_KEY when KMS is enabled.', 'KEY_NOT_CONFIGURED');
      }
      return encrypted.trim();
    }

    if (!process.env.ENCRYPTION_KEY || !process.env.ENCRYPTION_KEY.trim()) {
      throw new CryptoError('ENCRYPTION_KEY env var is required for local KMS provider', 'KEY_NOT_CONFIGURED');
    }
    return process.env.ENCRYPTION_KEY.trim();
  },

  /**
   * Key-encryption key for the local KMS provider.
   * @returns {Buffer}
   */
  getLocalKEK() {
    return deriveKey(this.resolveMasterSecret());
  },
};

// ─── Envelope formats ────────────────────────────────────────────────────────

/**
 * Serialize to the versioned envelope "v<n>:<iv>:<ciphertext>:<tag>" (hex).
 *
 * @param {number} version
 * @param {{ iv: Buffer, ciphertext: Buffer, tag: Buffer }} sealed
 * @returns {string}
 */
function formatVersioned(version, { iv, ciphertext, tag }) {
  return `v${version}:${iv.toString('hex')}:${ciphertext.toString('hex')}:${tag.toString('hex')}`;
}

/**
 * Parse a versioned envelope.
 *
 * @param {string} envelope
 * @returns {{ version: number, iv: Buffer, ciphertext: Buffer, tag: Buffer }}
 * @throws {CryptoError} INVALID_ENVELOPE
 */
function parseVersioned(envelope) {
  const m = VERSIONED_RE.exec(String(envelope));
  if (!m) throw new CryptoError('Invalid encrypted field format', 'INVALID_ENVELOPE');
  return {
    version: parseInt(m[1], 10),
    iv: Buffer.from(m[2], 'hex'),
    ciphertext: Buffer.from(m[3], 'hex'),
    tag: Buffer.from(m[4], 'hex'),
  };
}

/**
 * @param {*} value
 * @returns {boolean} true if value looks like a versioned envelope
 */
function isVersionedEnvelope(value) {
  return typeof value === 'string' && VERSIONED_RE.test(value);
}

/**
 * Encrypt a string into a versioned envelope using the key provider.
 *
 * @param {string} plaintext
 * @param {number} [version] - defaults to the active version
 * @returns {string}
 */
function encryptVersioned(plaintext, version) {
  const v = version || keyProvider.getActiveVersion();
  return formatVersioned(v, seal(keyProvider.getVersionedKey(v), String(plaintext)));
}

/**
 * Decrypt a versioned envelope, choosing the key from its version prefix.
 *
 * @param {string} envelope
 * @returns {string}
 */
function decryptVersioned(envelope) {
  const { version, ...sealed } = parseVersioned(envelope);
  return open(keyProvider.getVersionedKey(version), sealed).toString('utf8');
}

/**
 * Serialize to the unversioned (v0) format "<iv>:<ciphertext>:<tag>" (hex).
 * Kept for wallet secrets and local DEK wrapping already stored this way.
 *
 * @param {{ iv: Buffer, ciphertext: Buffer, tag: Buffer }} sealed
 * @returns {string}
 */
function formatLegacy({ iv, ciphertext, tag }) {
  return `${iv.toString('hex')}:${ciphertext.toString('hex')}:${tag.toString('hex')}`;
}

/**
 * Parse the unversioned "<iv>:<ciphertext>:<tag>" format.
 *
 * @param {string} envelope
 * @param {string} [errorMessage]
 * @returns {{ iv: Buffer, ciphertext: Buffer, tag: Buffer }}
 */
function parseLegacy(envelope, errorMessage = 'Invalid encrypted data format') {
  const parts = String(envelope).split(':');
  if (parts.length !== 3) throw new CryptoError(errorMessage, 'INVALID_ENVELOPE');
  return {
    iv: Buffer.from(parts[0], 'hex'),
    ciphertext: Buffer.from(parts[1], 'hex'),
    tag: Buffer.from(parts[2], 'hex'),
  };
}

/**
 * Sealed parts ↔ base64 object (used by JSON envelopes: memos, request bodies).
 */
function toBase64Parts({ iv, ciphertext, tag }) {
  return { iv: iv.toString('base64'), ciphertext: ciphertext.toString('base64'), tag: tag.toString('base64') };
}

function fromBase64Parts({ iv, ciphertext, tag }) {
  if (typeof iv !== 'string' || typeof ciphertext !== 'string' || typeof tag !== 'string') {
    throw new CryptoError('Envelope fields iv, ciphertext and tag must be base64 strings', 'INVALID_ENVELOPE');
  }
  return {
    iv: Buffer.from(iv, 'base64'),
    ciphertext: Buffer.from(ciphertext, 'base64'),
    tag: Buffer.from(tag, 'base64'),
  };
}

module.exports = {
  ALGORITHM,
  KEY_BYTES,
  IV_BYTES,
  TAG_BYTES,
  CryptoError,

  // Primitives
  deriveKey,
  generateKey,
  seal,
  open,

  // Keys
  keyProvider,

  // Envelopes
  formatVersioned,
  parseVersioned,
  isVersionedEnvelope,
  encryptVersioned,
  decryptVersioned,
  formatLegacy,
  parseLegacy,
  toBase64Parts,
  fromBase64Parts,
};
