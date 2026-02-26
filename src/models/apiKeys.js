/**
 * API Keys Model - Data Access Layer
 * 
 * RESPONSIBILITY: Database operations for API key management and validation
 * OWNER: Security Team
 * DEPENDENCIES: Database, crypto, logger, constants
 * 
 * Handles CRUD operations for API keys including creation, validation, rotation,
 * deprecation, and revocation. Supports zero-downtime key rotation workflow.
 */

const db = require('../utils/database');
const crypto = require('crypto');
const log = require('../utils/log');
const { API_KEY_STATUS } = require('../constants');

/**
 * API Key status constants
 */
const KEY_STATUS = API_KEY_STATUS;

/**
 * Initialize API keys table
 */
async function initializeApiKeysTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      name TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      expires_at INTEGER,
      deprecated_at INTEGER,
      revoked_at INTEGER,
      last_used_at INTEGER,
      created_by TEXT,
      metadata TEXT
    )
  `;

  const createIndexQuery = `
    CREATE INDEX IF NOT EXISTS idx_api_keys_status 
    ON api_keys(status, expires_at)
  `;

  try {
    await db.run(createTableQuery);
    await db.run(createIndexQuery);
  } catch (error) {
    log.error('API_KEYS', 'Failed to initialize API keys table', { error: error.message });
    throw error;
  }
}

/**
 * Generate a secure API key
 * @returns {string} Generated API key
 */
function generateApiKey() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Hash an API key for storage
 * @param {string} key - Plain text API key
 * @returns {string} Hashed key
 */
function hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Get key prefix for identification (first 8 characters)
 * @param {string} key - Plain text API key
 * @returns {string} Key prefix
 */
function getKeyPrefix(key) {
  return key.substring(0, 8);
}

/**
 * Create a new API key
 * @param {Object} options - Key creation options
 * @param {string} options.name - Descriptive name for the key
 * @param {string} options.role - Role for the key (admin, user, guest)
 * @param {number} options.expiresInDays - Days until expiration (optional)
 * @param {string} options.createdBy - User who created the key
 * @param {Object} options.metadata - Additional metadata
 * @returns {Promise<Object>} Created key info with plain text key
 */
async function createApiKey({ name, role = 'user', expiresInDays, createdBy, metadata = {} }) {
  const key = generateApiKey();
  const keyHash = hashApiKey(key);
  const keyPrefix = getKeyPrefix(key);
  const createdAt = Date.now();
  const expiresAt = expiresInDays ? createdAt + (expiresInDays * 24 * 60 * 60 * 1000) : null;

  const query = `
    INSERT INTO api_keys (
      key_hash, key_prefix, name, role, status, 
      created_at, expires_at, created_by, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  try {
    const result = await db.run(query, [
      keyHash,
      keyPrefix,
      name,
      role,
      KEY_STATUS.ACTIVE,
      createdAt,
      expiresAt,
      createdBy,
      JSON.stringify(metadata)
    ]);

    log.info('API_KEYS', 'API key created', { 
      id: result.id,
      name, 
      role, 
      prefix: keyPrefix 
    });

    return {
      id: result.id,
      key, // Return plain text key only once
      keyPrefix,
      name,
      role,
      status: KEY_STATUS.ACTIVE,
      createdAt,
      expiresAt
    };
  } catch (error) {
    log.error('API_KEYS', 'Failed to create API key', { error: error.message });
    throw error;
  }
}

/**
 * Validate an API key
 * @param {string} key - Plain text API key to validate
 * @returns {Promise<Object|null>} Key info if valid, null otherwise
 */
async function validateApiKey(key) {
  if (!key) return null;

  const keyHash = hashApiKey(key);
  const now = Date.now();

  const query = `
    SELECT id, key_prefix, name, role, status, created_at, expires_at, deprecated_at
    FROM api_keys
    WHERE key_hash = ?
  `;

  try {
    const keyInfo = await db.get(query, [keyHash]);

    if (!keyInfo) {
      return null;
    }

    // Check if key is revoked
    if (keyInfo.status === KEY_STATUS.REVOKED) {
      log.warn('API_KEYS', 'Attempted use of revoked key', { prefix: keyInfo.key_prefix });
      return null;
    }

    // Check if key is expired
    if (keyInfo.expires_at && keyInfo.expires_at < now) {
      log.warn('API_KEYS', 'Attempted use of expired key', { prefix: keyInfo.key_prefix });
      return null;
    }

    // Update last used timestamp
    await db.run('UPDATE api_keys SET last_used_at = ? WHERE id = ?', [now, keyInfo.id]);

    // Warn if key is deprecated
    if (keyInfo.status === KEY_STATUS.DEPRECATED) {
      log.warn('API_KEYS', 'Using deprecated key', { 
        prefix: keyInfo.key_prefix,
        deprecatedAt: keyInfo.deprecated_at 
      });
    }

    return {
      id: keyInfo.id,
      keyPrefix: keyInfo.key_prefix,
      name: keyInfo.name,
      role: keyInfo.role,
      status: keyInfo.status,
      isDeprecated: keyInfo.status === KEY_STATUS.DEPRECATED
    };
  } catch (error) {
    log.error('API_KEYS', 'Failed to validate API key', { error: error.message });
    return null;
  }
}

/**
 * List all API keys (without sensitive data)
 * @param {Object} filters - Optional filters
 * @returns {Promise<Array>} List of API keys
 */
async function listApiKeys(filters = {}) {
  let query = `
    SELECT id, key_prefix, name, role, status, 
           created_at, expires_at, deprecated_at, last_used_at, created_by
    FROM api_keys
    WHERE 1=1
  `;
  const params = [];

  if (filters.status) {
    query += ' AND status = ?';
    params.push(filters.status);
  }

  if (filters.role) {
    query += ' AND role = ?';
    params.push(filters.role);
  }

  query += ' ORDER BY created_at DESC';

  try {
    const keys = await db.all(query, params);
    return keys.map(key => ({
      ...key,
      metadata: key.metadata ? JSON.parse(key.metadata) : {}
    }));
  } catch (error) {
    log.error('API_KEYS', 'Failed to list API keys', { error: error.message });
    throw error;
  }
}

/**
 * Deprecate an API key (mark for future removal)
 * @param {number} keyId - Key ID to deprecate
 * @returns {Promise<boolean>} Success status
 */
async function deprecateApiKey(keyId) {
  const now = Date.now();
  const query = `
    UPDATE api_keys 
    SET status = ?, deprecated_at = ?
    WHERE id = ? AND status = ?
  `;

  try {
    const result = await db.run(query, [
      KEY_STATUS.DEPRECATED,
      now,
      keyId,
      KEY_STATUS.ACTIVE
    ]);

    if (result.changes > 0) {
      log.info('API_KEYS', 'API key deprecated', { id: keyId });
      return true;
    }
    return false;
  } catch (error) {
    log.error('API_KEYS', 'Failed to deprecate API key', { error: error.message });
    throw error;
  }
}

/**
 * Revoke an API key (immediate invalidation)
 * @param {number} keyId - Key ID to revoke
 * @returns {Promise<boolean>} Success status
 */
async function revokeApiKey(keyId) {
  const now = Date.now();
  const query = `
    UPDATE api_keys 
    SET status = ?, revoked_at = ?
    WHERE id = ?
  `;

  try {
    const result = await db.run(query, [KEY_STATUS.REVOKED, now, keyId]);

    if (result.changes > 0) {
      log.info('API_KEYS', 'API key revoked', { id: keyId });
      return true;
    }
    return false;
  } catch (error) {
    log.error('API_KEYS', 'Failed to revoke API key', { error: error.message });
    throw error;
  }
}

/**
 * Clean up expired and old revoked keys
 * @param {number} retentionDays - Days to retain revoked keys
 * @returns {Promise<number>} Number of keys deleted
 */
async function cleanupOldKeys(retentionDays = 90) {
  const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
  
  const query = `
    DELETE FROM api_keys 
    WHERE (status = ? AND revoked_at < ?)
       OR (status != ? AND expires_at < ?)
  `;

  try {
    const result = await db.run(query, [
      KEY_STATUS.REVOKED,
      cutoffTime,
      KEY_STATUS.REVOKED,
      cutoffTime
    ]);

    log.info('API_KEYS', 'Cleaned up old API keys', { count: result.changes });
    return result.changes;
  } catch (error) {
    log.error('API_KEYS', 'Failed to cleanup old keys', { error: error.message });
    throw error;
  }
}

module.exports = {
  KEY_STATUS,
  initializeApiKeysTable,
  generateApiKey,
  createApiKey,
  validateApiKey,
  listApiKeys,
  deprecateApiKey,
  revokeApiKey,
  cleanupOldKeys
};
