/**
 * Encryption Service - Hybrid Encryption Layer
 *
 * RESPONSIBILITY: RSA-OAEP + AES-256-GCM hybrid encryption for sensitive request bodies
 * OWNER: Security Team
 * DEPENDENCIES: Node.js crypto (built-in)
 *
 * Scheme:
 *   1. Client generates a random 256-bit AES key and 96-bit IV.
 *   2. Client encrypts the request body with AES-256-GCM → ciphertext + authTag.
 *   3. Client encrypts the AES key with the server's RSA-2048 public key (OAEP/SHA-256).
 *   4. Client sends: { encryptedKey, iv, ciphertext, authTag } (all base64).
 *   5. Server decrypts the AES key with its RSA private key, then decrypts the body.
 *
 * Security properties:
 *   - AES-256-GCM provides authenticated encryption (integrity + confidentiality).
 *   - RSA-OAEP prevents chosen-ciphertext attacks.
 *   - Each request uses a fresh AES key + IV → no nonce reuse.
 *   - Private key never leaves the server process.
 */

'use strict';

const crypto = require('crypto');
const log = require('../utils/log');

/** RSA key size in bits */
const RSA_KEY_BITS = 2048;

/** AES key length in bytes (256-bit) */
const AES_KEY_BYTES = 32;

/** GCM IV length in bytes (96-bit — NIST recommended) */
const GCM_IV_BYTES = 12;

/** GCM auth tag length in bytes */
const GCM_TAG_BYTES = 16;

class EncryptionService {
  constructor() {
    this._keyPair = null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Key management
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Generate (or return cached) RSA-2048 key pair.
   * Keys are generated once per process lifetime and held in memory.
   * For production, inject via environment variables (see getKeyPair).
   *
   * @returns {{ publicKey: string, privateKey: string }} PEM-encoded key pair
   */
  getKeyPair() {
    if (this._keyPair) return this._keyPair;

    // Allow injecting pre-generated keys via environment (e.g. for key rotation)
    if (process.env.ENCRYPTION_PRIVATE_KEY && process.env.ENCRYPTION_PUBLIC_KEY) {
      this._keyPair = {
        privateKey: process.env.ENCRYPTION_PRIVATE_KEY.replace(/\\n/g, '\n'),
        publicKey: process.env.ENCRYPTION_PUBLIC_KEY.replace(/\\n/g, '\n'),
      };
      log.info('ENCRYPTION_SERVICE', 'Loaded RSA key pair from environment');
      return this._keyPair;
    }

    log.info('ENCRYPTION_SERVICE', 'Generating RSA key pair', { bits: RSA_KEY_BITS });

    this._keyPair = crypto.generateKeyPairSync('rsa', {
      modulusLength: RSA_KEY_BITS,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    log.info('ENCRYPTION_SERVICE', 'RSA key pair generated');
    return this._keyPair;
  }

  /**
   * Return the server's RSA public key in PEM format.
   * @returns {string} PEM-encoded public key
   */
  getPublicKey() {
    return this.getKeyPair().publicKey;
  }

  /**
   * Return the server's RSA public key as a DER buffer (for fingerprinting).
   * @returns {Buffer} DER-encoded public key
   */
  getPublicKeyDer() {
    const pem = this.getPublicKey();
    const b64 = pem
      .replace('-----BEGIN PUBLIC KEY-----', '')
      .replace('-----END PUBLIC KEY-----', '')
      .replace(/\s/g, '');
    return Buffer.from(b64, 'base64');
  }

  /**
   * Compute SHA-256 fingerprint of the public key (hex).
   * Clients can pin this value to detect key rotation.
   * @returns {string} Hex fingerprint
   */
  getPublicKeyFingerprint() {
    return crypto.createHash('sha256').update(this.getPublicKeyDer()).digest('hex');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Decryption (server-side)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Decrypt a hybrid-encrypted request payload.
   *
   * @param {Object} payload - Encrypted payload from client
   * @param {string} payload.encryptedKey  - Base64 RSA-OAEP encrypted AES key
   * @param {string} payload.iv            - Base64 AES-GCM IV (12 bytes)
   * @param {string} payload.ciphertext    - Base64 AES-GCM ciphertext
   * @param {string} payload.authTag       - Base64 AES-GCM authentication tag (16 bytes)
   * @returns {Object} Decrypted and JSON-parsed request body
   * @throws {Error} If decryption fails (bad key, tampered ciphertext, etc.)
   */
  decrypt({ encryptedKey, iv, ciphertext, authTag }) {
    if (!encryptedKey || !iv || !ciphertext || !authTag) {
      throw new Error('Missing required encryption fields: encryptedKey, iv, ciphertext, authTag');
    }

    // 1. Decrypt AES key with RSA private key (OAEP/SHA-256)
    const aesKey = crypto.privateDecrypt(
      {
        key: this.getKeyPair().privateKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      Buffer.from(encryptedKey, 'base64')
    );

    if (aesKey.length !== AES_KEY_BYTES) {
      throw new Error(`Invalid AES key length: expected ${AES_KEY_BYTES}, got ${aesKey.length}`);
    }

    // 2. Decrypt body with AES-256-GCM
    const ivBuf = Buffer.from(iv, 'base64');
    const tagBuf = Buffer.from(authTag, 'base64');
    const ctBuf = Buffer.from(ciphertext, 'base64');

    if (ivBuf.length !== GCM_IV_BYTES) {
      throw new Error(`Invalid IV length: expected ${GCM_IV_BYTES}, got ${ivBuf.length}`);
    }
    if (tagBuf.length !== GCM_TAG_BYTES) {
      throw new Error(`Invalid auth tag length: expected ${GCM_TAG_BYTES}, got ${tagBuf.length}`);
    }

    const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, ivBuf);
    decipher.setAuthTag(tagBuf);

    const plaintext = Buffer.concat([decipher.update(ctBuf), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8'));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Encryption (test/client helper)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Encrypt a JSON-serialisable payload using the server's public key.
   * Intended for tests and client SDK examples — not used in the server hot path.
   *
   * @param {Object} body - Plain-text request body to encrypt
   * @param {string} publicKeyPem - Server's RSA public key (PEM)
   * @returns {{ encryptedKey: string, iv: string, ciphertext: string, authTag: string }}
   */
  static encrypt(body, publicKeyPem) {
    // 1. Generate fresh AES-256 key + 96-bit IV
    const aesKey = crypto.randomBytes(AES_KEY_BYTES);
    const iv = crypto.randomBytes(GCM_IV_BYTES);

    // 2. Encrypt body with AES-256-GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(body), 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    // 3. Encrypt AES key with RSA-OAEP
    const encryptedKey = crypto.publicEncrypt(
      {
        key: publicKeyPem,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      aesKey
    );

    return {
      encryptedKey: encryptedKey.toString('base64'),
      iv: iv.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      authTag: authTag.toString('base64'),
    };
  }

  /**
   * Reset the cached key pair (useful for testing key rotation scenarios).
   * @returns {void}
   */
  resetKeyPair() {
    this._keyPair = null;
  }
}

// Export a singleton — one key pair per process
module.exports = new EncryptionService();
