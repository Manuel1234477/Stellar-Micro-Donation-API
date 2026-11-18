/**
 * Encryption Utility - Data Protection Layer
 * 
 * RESPONSIBILITY: AES-256-GCM encryption/decryption for sensitive data at rest
 * OWNER: Security Team
 * DEPENDENCIES: crypto, security config, logger
 * 
 * Thin wrapper over src/utils/crypto.js (#1776): this module only maps the
 * wallet-secret storage formats onto the shared AES-256-GCM core and key
 * provider. It contains no cipher code of its own.
 */

const { securityConfig } = require("../config/securityConfig");
const log = require("./log");
const cryptoCore = require("./crypto");

/**
 * Get the key used for unversioned wallet-secret ciphertexts.
 * Lookup lives in the shared key provider (src/utils/crypto.js).
 */
const getEncryptionKey = () => {
  try {
    return cryptoCore.keyProvider.getLegacyKey();
  } catch (error) {
    log.error("ENCRYPTION", error.message, {
      hasSecurityConfig: !!securityConfig,
      encryptionKeyPresent: !!securityConfig.ENCRYPTION_KEY,
    });
    throw new Error(error.message);
  }
};

/**
 * Encrypt text using AES-256-GCM
 * @param {string} text - Text to encrypt
 * @returns {string} - Encrypted text in format iv:content:authTag (hex)
 */
const encrypt = (text) => {
  try {
    return cryptoCore.formatLegacy(cryptoCore.seal(getEncryptionKey(), text));
  } catch (error) {
    log.error("ENCRYPTION", "Failed to encrypt text", { error: error.message });
    throw new Error(`Encryption failed: ${error.message}`);
  }
};

/**
 * Decrypt text using AES-256-GCM
 * @param {string} encryptedData - Encrypted text in format iv:content:authTag (hex)
 * @returns {string} - Decrypted text
 */
const decrypt = (encryptedData) => {
  try {
    const sealed = cryptoCore.parseLegacy(encryptedData);
    return cryptoCore.open(getEncryptionKey(), sealed).toString("utf8");
  } catch (error) {
    log.error("ENCRYPTION", "Failed to decrypt text", {
      error: error.message,
      inputLength: encryptedData?.length,
    });
    throw new Error(`Decryption failed: ${error.message}`);
  }
};

/**
 * Check if encryption is properly configured
 * @returns {boolean} - True if encryption key is available
 */
const isEncryptionConfigured = () => {
  return !!securityConfig.ENCRYPTION_KEY;
};

// ─── Envelope Encryption (DEK per wallet) ────────────────────────────────────

const kms = require('./kms');

/**
 * Encrypt a wallet secret using envelope encryption.
 *
 * Generates a fresh DEK, encrypts the plaintext with it (AES-256-GCM),
 * then encrypts the DEK with the KEK via the configured KMS provider.
 *
 * Stored format (JSON string):
 *   { v: 2, encryptedDEK: "<kms-blob>", iv: "<hex>", ct: "<hex>", tag: "<hex>" }
 *
 * @param {string} plaintext - Wallet secret to protect
 * @returns {Promise<string>} JSON envelope string
 */
const encryptWithDEK = async (plaintext) => {
  const dek = kms.generateDEK();
  const { iv, ciphertext, tag } = cryptoCore.seal(dek, plaintext);
  const encryptedDEK = await kms.encryptDEK(dek);

  return JSON.stringify({
    v: 2,
    encryptedDEK,
    iv: iv.toString('hex'),
    ct: ciphertext.toString('hex'),
    tag: tag.toString('hex'),
  });
};

/**
 * Decrypt an envelope-encrypted wallet secret.
 *
 * Accepts both v2 (envelope) and legacy v1 (single-key) formats so existing
 * records continue to work until migrated.
 *
 * @param {string} envelope - JSON envelope string (v2) or legacy "iv:ct:tag" (v1)
 * @returns {Promise<string>} Plaintext wallet secret
 */
const decryptWithDEK = async (envelope) => {
  // Legacy format: "iv:ct:tag" (no JSON, no version field)
  if (!envelope.startsWith('{')) {
    return decrypt(envelope);
  }

  const { v, encryptedDEK, iv, ct, tag } = JSON.parse(envelope);
  if (v !== 2) throw new Error(`Unsupported envelope version: ${v}`);

  const dek = await kms.decryptDEK(encryptedDEK);
  return cryptoCore.open(dek, {
    iv: Buffer.from(iv, 'hex'),
    ciphertext: Buffer.from(ct, 'hex'),
    tag: Buffer.from(tag, 'hex'),
  }).toString('utf8');
};

/**
 * Rotate the DEK for an already-encrypted envelope without changing the plaintext.
 *
 * Decrypts the current envelope, then re-encrypts with a brand-new DEK.
 * The KEK (master key) is unchanged; only the per-wallet DEK is rotated.
 *
 * @param {string} currentEnvelope - Existing JSON envelope string
 * @returns {Promise<string>} New JSON envelope string with fresh DEK
 */
const rotateDEK = async (currentEnvelope) => {
  const plaintext = await decryptWithDEK(currentEnvelope);
  return encryptWithDEK(plaintext);
};

module.exports = {
  encrypt,
  decrypt,
  isEncryptionConfigured,
  getEncryptionKey,
  encryptWithDEK,
  decryptWithDEK,
  rotateDEK,
};
