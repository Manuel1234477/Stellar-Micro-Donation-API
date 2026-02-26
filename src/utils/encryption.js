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

module.exports = {
  encrypt,
  decrypt,
  isEncryptionConfigured,
  getEncryptionKey,
};
