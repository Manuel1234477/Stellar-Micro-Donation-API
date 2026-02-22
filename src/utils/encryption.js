const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Standard for GCM
const AUTH_TAG_LENGTH = 16;

/**
 * Get or derive the encryption key
 * In a real app, this should be a 32-byte key from a secure environment variable
 */
const getEncryptionKey = () => {
    const key = process.env.ENCRYPTION_KEY;
    if (!key) {
        if (process.env.NODE_ENV === 'production') {
            throw new Error('ENCRYPTION_KEY must be set in production');
        }
        // Fallback for development only
        return Buffer.alloc(32, 'dev-secret-key-do-not-use-in-prod');
    }

    // If key is provided as hex or base64, decode it. 
    // For simplicity here, we assume it's a string and hash it to 32 bytes.
    return crypto.createHash('sha256').update(key).digest();
};

/**
 * Encrypt text using AES-256-GCM
 * @param {string} text - Text to encrypt
 * @returns {string} - Encrypted text in format iv:content:authTag (hex)
 */
const encrypt = (text) => {
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = getEncryptionKey();
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag().toString('hex');

    return `${iv.toString('hex')}:${encrypted}:${authTag}`;
};

/**
 * Decrypt text using AES-256-GCM
 * @param {string} encryptedData - Encrypted text in format iv:content:authTag (hex)
 * @returns {string} - Decrypted text
 */
const decrypt = (encryptedData) => {
    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
        throw new Error('Invalid encrypted data format');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = parts[1];
    const authTag = Buffer.from(parts[2], 'hex');
    const key = getEncryptionKey();

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
};

module.exports = {
    encrypt,
    decrypt
};
