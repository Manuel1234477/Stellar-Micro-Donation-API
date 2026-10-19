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
 *
 * Local wrapping and env key lookup go through src/utils/crypto.js (#1776);
 * this module only adds the provider switch and the AWS backend.
 */

'use strict';

const log = require('./log');
const cryptoCore = require('./crypto');

function requireAwsKms() {
  try {
    return require('@aws-sdk/client-kms');
  } catch (error) {
    throw new Error('AWS KMS support is not installed. Add @aws-sdk/client-kms to dependencies or disable KMS mode.');
  }
}

/**
 * Raw master secret from env. Delegates to the shared key provider (#1776).
 * @returns {string}
 */
function resolveEncryptionKeyFromEnv() {
  return cryptoCore.keyProvider.resolveMasterSecret();
}

async function unwrapEncryptionKey() {
  const keyId = process.env.KMS_KEY_ID;
  if (!keyId) {
    return resolveEncryptionKeyFromEnv();
  }

  const encrypted = process.env.ENCRYPTED_ENCRYPTION_KEY;
  if (!encrypted || !encrypted.trim()) {
    throw new Error('KMS_KEY_ID is set but ENCRYPTED_ENCRYPTION_KEY is missing');
  }

  const { KMSClient, DecryptCommand } = requireAwsKms();
  const client = new KMSClient({ region: process.env.AWS_REGION || 'us-east-1' });
  const { Plaintext } = await client.send(new DecryptCommand({
    CiphertextBlob: Buffer.from(encrypted, 'base64'),
    KeyId: keyId,
  }));

  if (!Plaintext || !Plaintext.length) {
    throw new Error('KMS decryption returned empty plaintext for the encryption key');
  }

  return Buffer.from(Plaintext).toString('hex');
}

// ─── Local backend ────────────────────────────────────────────────────────────

/**
 * Encrypt a plaintext DEK with the local KEK (AES-256-GCM via src/utils/crypto.js).
 * @param {Buffer} dek - 32-byte plaintext DEK
 * @returns {string} hex-encoded "iv:ciphertext:authTag"
 */
function _localEncryptDEK(dek) {
  return cryptoCore.formatLegacy(cryptoCore.seal(cryptoCore.keyProvider.getLocalKEK(), dek));
}

/**
 * Decrypt an encrypted DEK with the local KEK.
 * @param {string} encryptedDEK - hex-encoded "iv:ciphertext:authTag"
 * @returns {Buffer} plaintext DEK
 */
function _localDecryptDEK(encryptedDEK) {
  const sealed = cryptoCore.parseLegacy(encryptedDEK, 'Invalid encrypted DEK format');
  return cryptoCore.open(cryptoCore.keyProvider.getLocalKEK(), sealed);
}

// ─── AWS KMS backend ──────────────────────────────────────────────────────────

/**
 * Encrypt a DEK using AWS KMS GenerateDataKey / Encrypt.
 * We use the raw Encrypt API so the caller supplies the plaintext DEK.
 * @param {Buffer} dek
 * @returns {Promise<string>} base64-encoded ciphertext blob
 */
async function _awsEncryptDEK(dek) {
  const { KMSClient, EncryptCommand } = requireAwsKms();
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
  const { KMSClient, DecryptCommand } = requireAwsKms();
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
    log.warn('KMS', 'Unknown KMS_PROVIDER value, falling back to local');
    return 'local';
  }
  return p;
}

/**
 * Generate a new random 32-byte DEK.
 * @returns {Buffer}
 */
function generateDEK() {
  return cryptoCore.generateKey();
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

module.exports = {
  generateDEK,
  encryptDEK,
  decryptDEK,
  getProvider,
  resolveEncryptionKeyFromEnv,
  unwrapEncryptionKey,
};
