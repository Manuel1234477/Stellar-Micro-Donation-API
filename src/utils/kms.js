/**
 * KMS (Key Management Service) - Master Key Provider Layer
 *
 * RESPONSIBILITY: Manage Key Encryption Keys (KEK) via pluggable backends.
 *   Supports local (ENCRYPTION_KEY env var) and AWS KMS providers.
 * OWNER: Security Team
 * DEPENDENCIES: crypto, aws-sdk (optional, only loaded for aws provider)
 *
 * Envelope encryption model:
 *   - Each wallet has its own Data Encryption Key (DEK).
 *   - The DEK is encrypted by the KEK managed here (the "envelope").
 *   - Only the encrypted DEK is stored; the plaintext DEK lives only in memory.
 */

'use strict';

const crypto = require('crypto');
const log = require('./log');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

// ─── Local backend ────────────────────────────────────────────────────────────

/**
 * Derive a 32-byte KEK from the ENCRYPTION_KEY env var.
 * @returns {Buffer}
 */
function _localKEK() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error('ENCRYPTION_KEY env var is required for local KMS provider');
  return crypto.createHash('sha256').update(raw).digest();
}

/**
 * Encrypt a plaintext DEK with the local KEK (AES-256-GCM).
 * @param {Buffer} dek - 32-byte plaintext DEK
 * @returns {string} hex-encoded "iv:ciphertext:authTag"
 */
function _localEncryptDEK(dek) {
  const kek = _localKEK();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, kek, iv);
  const encrypted = Buffer.concat([cipher.update(dek), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${encrypted.toString('hex')}:${authTag.toString('hex')}`;
}

/**
 * Decrypt an encrypted DEK with the local KEK.
 * @param {string} encryptedDEK - hex-encoded "iv:ciphertext:authTag"
 * @returns {Buffer} plaintext DEK
 */
function _localDecryptDEK(encryptedDEK) {
  const parts = encryptedDEK.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted DEK format');
  const [ivHex, ctHex, tagHex] = parts;
  const kek = _localKEK();
  const decipher = crypto.createDecipheriv(ALGORITHM, kek, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]);
}

// ─── AWS KMS backend ──────────────────────────────────────────────────────────

/**
 * Encrypt a DEK using AWS KMS GenerateDataKey / Encrypt.
 * We use the raw Encrypt API so the caller supplies the plaintext DEK.
 * @param {Buffer} dek
 * @returns {Promise<string>} base64-encoded ciphertext blob
 */
async function _awsEncryptDEK(dek) {
  // Lazy-load to avoid hard dependency when not using AWS
  const { KMSClient, EncryptCommand } = require('@aws-sdk/client-kms');
  const keyId = process.env.KMS_KEY_ID;
  if (!keyId) throw new Error('KMS_KEY_ID env var is required for aws KMS provider');

  const client = new KMSClient({ region: process.env.AWS_REGION || 'us-east-1' });
  const { CiphertextBlob } = await client.send(
    new EncryptCommand({ KeyId: keyId, Plaintext: dek })
  );
  return Buffer.from(CiphertextBlob).toString('base64');
}

/**
 * Decrypt an encrypted DEK using AWS KMS.
 * @param {string} encryptedDEK - base64-encoded ciphertext blob
 * @returns {Promise<Buffer>} plaintext DEK
 */
async function _awsDecryptDEK(encryptedDEK) {
  const { KMSClient, DecryptCommand } = require('@aws-sdk/client-kms');
  const client = new KMSClient({ region: process.env.AWS_REGION || 'us-east-1' });
  const { Plaintext } = await client.send(
    new DecryptCommand({ CiphertextBlob: Buffer.from(encryptedDEK, 'base64') })
  );
  return Buffer.from(Plaintext);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Resolve the active KMS provider from KMS_PROVIDER env var.
 * Defaults to 'local'.
 * @returns {'local'|'aws'}
 */
function getProvider() {
  const p = (process.env.KMS_PROVIDER || 'local').toLowerCase();
  if (!['local', 'aws'].includes(p)) {
    log.warn('KMS', `Unknown KMS_PROVIDER "${p}", falling back to local`);
    return 'local';
  }
  return p;
}

/**
 * Generate a new random 32-byte DEK.
 * @returns {Buffer}
 */
function generateDEK() {
  return crypto.randomBytes(32);
}

/**
 * Encrypt a plaintext DEK with the configured KEK provider.
 * @param {Buffer} dek - plaintext DEK
 * @returns {Promise<string>} provider-specific encrypted DEK string
 */
async function encryptDEK(dek) {
  const provider = getProvider();
  log.debug('KMS', 'Encrypting DEK', { provider });
  if (provider === 'aws') return _awsEncryptDEK(dek);
  return _localEncryptDEK(dek);
}

/**
 * Decrypt an encrypted DEK with the configured KEK provider.
 * @param {string} encryptedDEK - provider-specific encrypted DEK string
 * @returns {Promise<Buffer>} plaintext DEK
 */
async function decryptDEK(encryptedDEK) {
  const provider = getProvider();
  log.debug('KMS', 'Decrypting DEK', { provider });
  if (provider === 'aws') return _awsDecryptDEK(encryptedDEK);
  return _localDecryptDEK(encryptedDEK);
}

module.exports = { generateDEK, encryptDEK, decryptDEK, getProvider };
