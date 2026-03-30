/**
 * MemoKeyManager - Key Versioning and Rotation for Memo Encryption
 *
 * RESPONSIBILITY: Manage memo encryption keys with version tracking
 * OWNER: Security Team
 * DEPENDENCIES: crypto, database, logger
 *
 * Implements envelope encryption pattern:
 * - Active key version encrypts new memos
 * - Old versions remain functional for decryption during rotation
 * - Gradual rotation re-encrypts all memos
 * - Each memo stores its key version internally
 *
 * Key versioning model:
 * {
 *   version: 1,
 *   keyMaterial: "...hex-encoded 32-byte key...",
 *   createdAt: "2024-01-01T00:00:00Z",
 *   status: "active|retired", // active = used for new encryptions
 * }
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const log = require('./log');

// ─── Configuration ───────────────────────────────────────────────────────────

const KEYS_STORAGE_PATH = process.env.MEMO_KEYS_DIR || path.join(__dirname, '../../data/memo-keys');
const KEYS_INDEX_FILE = path.join(KEYS_STORAGE_PATH, 'keys.json');

// ─── Initialization ──────────────────────────────────────────────────────────

/**
 * Ensure the keys storage directory exists.
 * @returns {void}
 */
function ensureKeysDir() {
  if (!fs.existsSync(KEYS_STORAGE_PATH)) {
    fs.mkdirSync(KEYS_STORAGE_PATH, { recursive: true });
  }
}

/**
 * Load the key index from storage.
 * @returns {Object|null}
 */
function loadKeysIndex() {
  ensureKeysDir();
  if (!fs.existsSync(KEYS_INDEX_FILE)) {
    return null;
  }
  try {
    const data = fs.readFileSync(KEYS_INDEX_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    log.error('MEMO_KEY_MANAGER', 'Failed to load keys index', { error: err.message });
    return null;
  }
}

/**
 * Save the key index to storage.
 * @param {Object} index - Keys index object
 * @returns {void}
 */
function saveKeysIndex(index) {
  ensureKeysDir();
  try {
    fs.writeFileSync(KEYS_INDEX_FILE, JSON.stringify(index, null, 2));
    log.debug('MEMO_KEY_MANAGER', 'Keys index saved', { path: KEYS_INDEX_FILE });
  } catch (err) {
    log.error('MEMO_KEY_MANAGER', 'Failed to save keys index', { error: err.message });
    throw err;
  }
}

/**
 * Initialize key storage with a default key if it doesn't exist.
 * Each server instance should run this once at startup.
 * @returns {Object} The initialized keys index
 */
function initializeKeyStorage() {
  let index = loadKeysIndex();

  if (!index) {
    log.info('MEMO_KEY_MANAGER', 'Initializing key storage with version 1');
    const keyMaterial = crypto.randomBytes(32).toString('hex');
    index = {
      activeVersion: 1,
      keys: [
        {
          version: 1,
          keyMaterial,
          createdAt: new Date().toISOString(),
          status: 'active',
        },
      ],
    };
    saveKeysIndex(index);
  }

  return index;
}

// ─── Key Access ──────────────────────────────────────────────────────────────

/**
 * Get the active key version number.
 * @returns {number}
 */
function getActiveKeyVersion() {
  const index = loadKeysIndex() || initializeKeyStorage();
  return index.activeVersion || 1;
}

/**
 * Get the key material for a specific version.
 * @param {number} version - Key version number
 * @returns {Buffer} 32-byte key material
 * @throws {Error} if version not found
 */
function getKeyMaterial(version) {
  const index = loadKeysIndex() || initializeKeyStorage();
  const keyEntry = index.keys.find(k => k.version === version);

  if (!keyEntry) {
    throw new Error(`Key version ${version} not found`);
  }

  return Buffer.from(keyEntry.keyMaterial, 'hex');
}

/**
 * Get the active key material (current version).
 * @returns {Buffer} 32-byte key material
 */
function getActiveKeyMaterial() {
  const version = getActiveKeyVersion();
  return getKeyMaterial(version);
}

/**
 * Retrieve all key versions (including retired ones).
 * Useful for rotation status and diagnostics.
 * @returns {Array} Array of { version, createdAt, status }
 */
function getAllKeyVersions() {
  const index = loadKeysIndex() || initializeKeyStorage();
  return index.keys.map(k => ({
    version: k.version,
    createdAt: k.createdAt,
    status: k.status,
  }));
}

// ─── Key Rotation ────────────────────────────────────────────────────────────

/**
 * Create a new key version and make it active.
 * Existing versions become 'retired' but remain usable for decryption.
 * @returns {number} The new active version number
 */
function rotateKey() {
  let index = loadKeysIndex() || initializeKeyStorage();

  // Find highest existing version
  const maxVersion = Math.max(...index.keys.map(k => k.version));
  const newVersion = maxVersion + 1;

  // Mark all existing keys as retired
  index.keys.forEach(k => {
    if (k.status === 'active') {
      k.status = 'retired';
    }
  });

  // Create new active key
  const keyMaterial = crypto.randomBytes(32).toString('hex');
  index.keys.push({
    version: newVersion,
    keyMaterial,
    createdAt: new Date().toISOString(),
    status: 'active',
  });

  // Update active version pointer
  index.activeVersion = newVersion;

  saveKeysIndex(index);

  log.info('MEMO_KEY_MANAGER', 'Key rotated', {
    previousVersion: maxVersion,
    newVersion,
  });

  return newVersion;
}

// ─── Key Versioning Utilities ────────────────────────────────────────────────

/**
 * Serialize an encrypted memo with its key version prefix.
 * Format: "v<version>:<base64-json-envelope>"
 *
 * @param {{keyVersion: number, encryptedEnvelope: Object}} versionedEncryption
 * @returns {string} Versioned ciphertext
 */
function serializeVersionedCiphertext(versionedEncryption) {
  const { keyVersion, encryptedEnvelope } = versionedEncryption;
  const serialized = JSON.stringify(encryptedEnvelope);
  const encoded = Buffer.from(serialized).toString('base64');
  return `v${keyVersion}:${encoded}`;
}

/**
 * Deserialize a versioned ciphertext to extract key version and envelope.
 * Format: "v<version>:<base64-json-envelope>"
 *
 * @param {string} versionedCiphertext
 * @returns {{keyVersion: number, encryptedEnvelope: Object}}
 * @throws {Error} if format is invalid
 */
function deserializeVersionedCiphertext(versionedCiphertext) {
  if (typeof versionedCiphertext !== 'string') {
    throw new Error('Versioned ciphertext must be a string');
  }

  const match = versionedCiphertext.match(/^v(\d+):(.+)$/);
  if (!match) {
    throw new Error('Invalid versioned ciphertext format: expected "v<version>:<base64>"');
  }

  const [, versionStr, encodedEnvelope] = match;
  const keyVersion = parseInt(versionStr, 10);

  try {
    const serialized = Buffer.from(encodedEnvelope, 'base64').toString('utf8');
    const encryptedEnvelope = JSON.parse(serialized);
    return { keyVersion, encryptedEnvelope };
  } catch (err) {
    throw new Error(`Failed to deserialize versioned ciphertext: ${err.message}`);
  }
}

// ─── Re-encryption for Rotation ──────────────────────────────────────────────

/**
 * Re-encrypt a memo from an old key version to the current active version.
 * Used during gradual key rotation.
 *
 * @param {Object} memoRecord - Transaction record with memo and encryptionMetadata
 * @param {Function} decryptFn - Decryption function: (ciphertext, keyVersion) => plaintext
 * @param {Function} encryptFn - Encryption function: (plaintext, keyVersion) => versioned ciphertext
 * @returns {Object} Updated encryp encryptionMetadata
 * @throws {Error} if decryption or encryption fails
 */
function reencryptMemo(memoRecord, decryptFn, encryptFn) {
  if (!memoRecord.memoEnvelope || !memoRecord.encryptionMetadata) {
    throw new Error('Memo record missing encrypted memo or metadata');
  }

  const { keyVersion: oldVersion } = memoRecord.encryptionMetadata;

  // Decrypt with old key version
  const plaintext = decryptFn(memoRecord.memoEnvelope, oldVersion);

  // Encrypt with active version
  const newActiveVersion = getActiveKeyVersion();
  const newVersionedCiphertext = encryptFn(plaintext, newActiveVersion);

  return {
    ...memoRecord.encryptionMetadata,
    keyVersion: newActiveVersion,
    previousKeyVersion: oldVersion,
    rotatedAt: new Date().toISOString(),
  };
}

/**
 * Export key versions for offsite backup or audit.
 * WARNING: This includes unencrypted key material. Exercise extreme caution.
 *
 * @returns {Object} All key versions with metadata
 */
function exportKeyVersions() {
  const index = loadKeysIndex() || initializeKeyStorage();
  return {
    activeVersion: index.activeVersion,
    exportedAt: new Date().toISOString(),
    keys: index.keys, // Contains plaintext key material!
  };
}

/**
 * Clear all key storage for testing purposes.
 * WARNING: This permanently deletes all keys. Use with extreme caution!
 *
 * @returns {void}
 */
function clearAllKeys() {
  if (fs.existsSync(KEYS_INDEX_FILE)) {
    fs.unlinkSync(KEYS_INDEX_FILE);
    log.warn('MEMO_KEY_MANAGER', 'All keys cleared from storage');
  }
}

module.exports = {
  // Initialization
  initializeKeyStorage,
  ensureKeysDir,

  // Key access
  getActiveKeyVersion,
  getKeyMaterial,
  getActiveKeyMaterial,
  getAllKeyVersions,

  // Key rotation
  rotateKey,

  // Versioning utilities
  serializeVersionedCiphertext,
  deserializeVersionedCiphertext,
  reencryptMemo,

  // Export and testing
  exportKeyVersions,
  clearAllKeys,
};
