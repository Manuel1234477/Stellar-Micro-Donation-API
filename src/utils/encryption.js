/**
 * Encryption Utility - Data Protection Layer
 * 
 * RESPONSIBILITY: AES-256-GCM encryption/decryption for sensitive data at rest
 * OWNER: Security Team
 * DEPENDENCIES: crypto, security config, logger
 * 
 * Provides secure encryption for sensitive data storage using AES-256-GCM with
 * authenticated encryption. Manages encryption keys and initialization vectors.
 */

const crypto = require('crypto');
const { securityConfig } = require("../config/securityConfig");
const log = require("./log");

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Standard for GCM
// eslint-disable-next-line no-unused-vars -- Reserved for future GCM tag validation
const AUTH_TAG_LENGTH = 16;

// eslint-disable-next-line no-unused-vars -- Reserved for future config-driven algorithm selection
const config = require('../config');

/**
 * Get or derive the encryption key using security configuration
 */
const getEncryptionKey = () => {
    const key = securityConfig.ENCRYPTION_KEY;
    
    if (!key) {
        const errorMsg =
          "ENCRYPTION_KEY not available from security configuration";
        log.error("ENCRYPTION", errorMsg, {
          hasSecurityConfig: !!securityConfig,
          encryptionKeyPresent: !!key,
        });
        throw new Error(errorMsg);
    }

    // If key is provided as hex or base64, decode it.
    // For simplicity here, we assume it's a string and hash it to 32 bytes.
    const derivedKey = crypto.createHash("sha256").update(key).digest();

    log.debug("ENCRYPTION", "Encryption key derived successfully", {
      keyLength: derivedKey.length,
      algorithm: ALGORITHM,
    });

    return derivedKey;
};

/**
 * Encrypt text using AES-256-GCM
 * @param {string} text - Text to encrypt
 * @returns {string} - Encrypted text in format iv:content:authTag (hex)
 */
const encrypt = (text) => {
    try {
      const iv = crypto.randomBytes(IV_LENGTH);
      const key = getEncryptionKey();
      const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

      let encrypted = cipher.update(text, "utf8", "hex");
      encrypted += cipher.final("hex");

      const authTag = cipher.getAuthTag().toString("hex");

      const result = `${iv.toString("hex")}:${encrypted}:${authTag}`;

      log.debug("ENCRYPTION", "Text encrypted successfully", {
        inputLength: text.length,
        resultLength: result.length,
      });

      return result;
    } catch (error) {
      log.error("ENCRYPTION", "Failed to encrypt text", {
        error: error.message,
        stack: error.stack,
      });
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
    const parts = encryptedData.split(":");
    if (parts.length !== 3) {
      throw new Error("Invalid encrypted data format");
    }

    const iv = Buffer.from(parts[0], "hex");
    const encryptedText = parts[1];
    const authTag = Buffer.from(parts[2], "hex");
    const key = getEncryptionKey();

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedText, "hex", "utf8");
    decrypted += decipher.final("utf8");

    log.debug("ENCRYPTION", "Text decrypted successfully", {
      inputLength: encryptedData.length,
      outputLength: decrypted.length,
    });

    return decrypted;
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
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, dek, iv);
  let ct = cipher.update(plaintext, 'utf8', 'hex');
  ct += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  const encryptedDEK = await kms.encryptDEK(dek);

  return JSON.stringify({
    v: 2,
    encryptedDEK,
    iv: iv.toString('hex'),
    ct,
    tag,
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
  const decipher = crypto.createDecipheriv(ALGORITHM, dek, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  let plaintext = decipher.update(ct, 'hex', 'utf8');
  plaintext += decipher.final('utf8');
  return plaintext;
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
