/**
 * MemoEncryptionService - Full memo encryption lifecycle
 *
 * RESPONSIBILITY: Orchestrate memo encryption/decryption with key versioning
 * OWNER: Security Team
 * DEPENDENCIES: memoEncryption, memoKeyManager, database
 *
 * Combines ECDH-based memo encryption with key versioning for rotation.
 * - Encrypts new memos with the active key version
 * - Decrypts memos regardless of which key version encrypted them
 * - Supports gradual key rotation
 * - Stores both the encrypted memo and on-chain MEMO_HASH
 */

'use strict';

const {
  encryptMemo,
  decryptMemo,
  isEncryptedMemoEnvelope,
  envelopeToMemoHash,
} = require('../utils/memoEncryption');

const memoKeyManager = require('../utils/memoKeyManager');
const log = require('../utils/log');

// ─── Memo Encryption Workflow ────────────────────────────────────────────────

/**
 * Encrypt a memo for a specific recipient with key versioning.
 *
 * The encrypted memo is stored as a versioned ciphertext string:
 *   "v<version>:<base64-encoded-json-envelope>"
 * This embeds the key version so future decryption can select the correct key.
 *
 * @param {string} plaintext - Plaintext memo (e.g., "Thank you for your support!")
 * @param {string} recipientStellarAddress - Recipient's Stellar public key (G...)
 * @param {Object} options - Optional parameters
 * @param {number} options.keyVersion - Force a specific key version (for testing)
 * @returns {{
 *   memoEnvelope: string,
 *   memoHash: string,
 *   encryptionMetadata: {keyVersion: number, algorithm: string, createdAt: string}
 * }}
 * @throws {Error} if encryption fails
 */
function encryptMemoForRecipient(plaintext, recipientStellarAddress, options = {}) {
  if (typeof plaintext !== 'string' || !plaintext) {
    throw new Error('Plaintext memo must be a non-empty string');
  }
  if (typeof recipientStellarAddress !== 'string' || !recipientStellarAddress.startsWith('G')) {
    throw new Error('Invalid Stellar recipient address');
  }

  try {
    // Determine key version to use (always the active version unless overridden for tests)
    const keyVersion = options.keyVersion || memoKeyManager.getActiveKeyVersion();

    // Encrypt the memo using ECDH-X25519-AES256GCM
    const rawEnvelope = encryptMemo(plaintext, recipientStellarAddress);

    // Serialize as versioned ciphertext: "v<version>:<base64json>"
    const versionedMemo = memoKeyManager.serializeVersionedCiphertext({
      keyVersion,
      encryptedEnvelope: rawEnvelope,
    });

    // Compute on-chain MEMO_HASH (immutable reference based on raw envelope)
    const memoHash = envelopeToMemoHash(rawEnvelope);

    // Store encryption metadata for diagnostics and rotation tracking
    const encryptionMetadata = {
      keyVersion,
      algorithm: 'ECDH-X25519-AES256GCM',
      createdAt: new Date().toISOString(),
    };

    log.debug('MEMO_ENCRYPTION_SERVICE', 'Memo encrypted', {
      recipientAddress: recipientStellarAddress.slice(0, 6) + '...',
      keyVersion,
      memoHashLength: memoHash.length,
    });

    return {
      memoEnvelope: versionedMemo,
      memoHash,
      encryptionMetadata,
    };
  } catch (err) {
    log.error('MEMO_ENCRYPTION_SERVICE', 'Encryption failed', {
      error: err.message,
      recipientAddress: recipientStellarAddress.slice(0, 6) + '...',
    });
    throw err;
  }
}

/**
 * Decrypt a memo using the recipient's Stellar secret key.
 *
 * Accepts both the new versioned format ("v<n>:<base64>") and the legacy raw
 * envelope format (object or JSON string) for backward compatibility.
 *
 * When the versioned format is used, the key version is parsed from the prefix
 * and validated against the key store before decryption proceeds.
 *
 * @param {string|Object} memoEnvelope - Versioned ciphertext ("v1:base64…") or raw envelope
 * @param {string} recipientStellarSecret - Recipient's Stellar secret key (S...)
 * @returns {string} Plaintext memo
 * @throws {Error} if key version is unknown, recipient secret key is wrong, or memo is tampered
 */
function decryptMemoForRecipient(memoEnvelope, recipientStellarSecret) {
  if (typeof recipientStellarSecret !== 'string' || !recipientStellarSecret.startsWith('S')) {
    throw new Error('Invalid Stellar recipient secret key');
  }

  try {
    let envelopeToDecrypt = memoEnvelope;

    // Handle versioned ciphertext format: "v<n>:<base64json>"
    if (typeof memoEnvelope === 'string' && /^v\d+:/.test(memoEnvelope)) {
      const { keyVersion, encryptedEnvelope } = memoKeyManager.deserializeVersionedCiphertext(memoEnvelope);

      // Validate the key version exists in the key store (throws if unknown)
      try {
        memoKeyManager.getKeyMaterial(keyVersion);
      } catch {
        throw new Error(`Unknown key version ${keyVersion}: memo encrypted with a key that no longer exists`);
      }

      envelopeToDecrypt = encryptedEnvelope;

      log.debug('MEMO_ENCRYPTION_SERVICE', 'Decrypting versioned memo', { keyVersion });
    }

    const plaintext = decryptMemo(envelopeToDecrypt, recipientStellarSecret);

    log.debug('MEMO_ENCRYPTION_SERVICE', 'Memo decrypted successfully');

    return plaintext;
  } catch (err) {
    log.error('MEMO_ENCRYPTION_SERVICE', 'Decryption failed', {
      error: err.message,
      isVersioned: typeof memoEnvelope === 'string' && /^v\d+:/.test(memoEnvelope),
    });
    throw err;
  }
}

/**
 * Estimate if a memo envelope was encrypted with a specific key version.
 * Useful for identifying which memos need re-encryption during rotation.
 *
 * @param {Object} encryptionMetadata - Encryption metadata from transaction record
 * @param {number} targetVersion - Key version to check against
 * @returns {boolean}
 */
function wasEncryptedWithVersion(encryptionMetadata, targetVersion) {
  if (!encryptionMetadata || typeof encryptionMetadata.keyVersion !== 'number') {
    return false;
  }
  return encryptionMetadata.keyVersion === targetVersion;
}

/**
 * Get all in-use key versions from encryption metadata.
 * @param {Array<Object>} transactionRecords - Array of transaction records
 * @returns {Set<number>} Set of key versions in use
 */
function getInUseKeyVersions(transactionRecords = []) {
  const versions = new Set();
  transactionRecords.forEach(tx => {
    if (tx.encryptionMetadata && typeof tx.encryptionMetadata.keyVersion === 'number') {
      versions.add(tx.encryptionMetadata.keyVersion);
    }
  });
  return versions;
}

// ─── Key Rotation Workflow ───────────────────────────────────────────────────

/**
 * Initiate a key rotation.
 * Creates a new active key version and marks old ones as retired.
 * Does NOT re-encrypt existing memos yet.
 *
 * @returns {{
 *   previousVersion: number,
 *   newVersion: number,
 *   status: "initiated"
 * }}
 */
function initiateKeyRotation() {
  const previousVersion = memoKeyManager.getActiveKeyVersion();
  const newVersion = memoKeyManager.rotateKey();

  log.info('MEMO_ENCRYPTION_SERVICE', 'Key rotation initiated', {
    previousVersion,
    newVersion,
  });

  return {
    previousVersion,
    newVersion,
    status: 'initiated',
  };
}

/**
 * Prepare a batch of memos for re-encryption during rotation.
 * Returns memos that were encrypted with the old version.
 *
 * @param {Array<Object>} transactionRecords - Transaction records
 * @param {number} oldKeyVersion - Old key version to identify
 * @returns {Array<Object>} Memos that need re-encryption
 */
function getMemosToReencrypt(transactionRecords, oldKeyVersion) {
  return transactionRecords.filter(tx => {
    return (
      tx.memoEnvelope &&
      tx.encryptionMetadata &&
      tx.encryptionMetadata.keyVersion === oldKeyVersion
    );
  });
}

/**
 * Re-encrypt a single memo to the new active key version.
 * Must first decrypt with old key, then re-encrypt with new key.
 * Requires the recipient's secret key for decryption.
 *
 * @param {Object} transactionRecord - Transaction with memoEnvelope and encryptionMetadata
 * @param {string} recipientStellarSecret - Recipient's secret key
 * @returns {{
 *   memoEnvelope: Object,
 *   encryptionMetadata: Object,
 *   previousKeyVersion: number
 * }}
 * @throws {Error} if memo is not encrypted or decryption fails
 */
function reencryptMemoToLatestVersion(transactionRecord, recipientStellarSecret) {
  if (!transactionRecord.memoEnvelope || !transactionRecord.encryptionMetadata) {
    throw new Error('Transaction does not have an encrypted memo');
  }

  const oldVersion = transactionRecord.encryptionMetadata.keyVersion;
  const newVersion = memoKeyManager.getActiveKeyVersion();

  if (oldVersion === newVersion) {
    log.debug('MEMO_ENCRYPTION_SERVICE', 'Memo already at latest key version', {
      version: oldVersion,
    });
    return {
      memoEnvelope: transactionRecord.memoEnvelope,
      encryptionMetadata: transactionRecord.encryptionMetadata,
      previousKeyVersion: oldVersion,
    };
  }

  try {
    // Decrypt with old key (metadata contains the version)
    const plaintext = decryptMemoForRecipient(
      transactionRecord.memoEnvelope,
      recipientStellarSecret
    );

    // Re-encrypt with new key
    const result = encryptMemoForRecipient(
      plaintext,
      transactionRecord.recipient || transactionRecord.donor, // Try recipient first, fallback to donor
      { keyVersion: newVersion }
    );

    log.info('MEMO_ENCRYPTION_SERVICE', 'Memo re-encrypted to new key version', {
      previousKeyVersion: oldVersion,
      newKeyVersion: newVersion,
    });

    return {
      memoEnvelope: result.memoEnvelope,
      encryptionMetadata: result.encryptionMetadata,
      previousKeyVersion: oldVersion,
    };
  } catch (err) {
    log.error('MEMO_ENCRYPTION_SERVICE', 'Failed to re-encrypt memo', {
      error: err.message,
      oldVersion,
      newVersion,
    });
    throw err;
  }
}

// ─── Status and Diagnostics ──────────────────────────────────────────────────

/**
 * Get encryption system status and statistics.
 *
 * @param {Array<Object>} transactionRecords - Transaction records (optional)
 * @returns {{
 *   activeVersion: number,
 *   allVersions: Array,
 *   memsEncryptedCount: number,
 *   memosUsingOldVersions: number
 * }}
 */
function getEncryptionStatus(transactionRecords = []) {
  const activeVersion = memoKeyManager.getActiveKeyVersion();
  const allVersions = memoKeyManager.getAllKeyVersions();

  const memosEncryptedCount = transactionRecords.filter(tx => {
    return tx.memoEnvelope && tx.encryptionMetadata;
  }).length;

  const memosUsingOldVersions = transactionRecords.filter(tx => {
    return (
      tx.encryptionMetadata &&
      tx.encryptionMetadata.keyVersion &&
      tx.encryptionMetadata.keyVersion !== activeVersion
    );
  }).length;

  return {
    activeVersion,
    allVersions,
    memosEncryptedCount,
    memosUsingOldVersions,
    rotationRequired: memosUsingOldVersions > 0,
  };
}

module.exports = {
  // Core encryption/decryption
  encryptMemoForRecipient,
  decryptMemoForRecipient,
  wasEncryptedWithVersion,
  getInUseKeyVersions,

  // Key rotation
  initiateKeyRotation,
  getMemosToReencrypt,
  reencryptMemoToLatestVersion,

  // Diagnostics
  getEncryptionStatus,
};
