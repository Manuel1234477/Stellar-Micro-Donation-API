/**
 * Idempotency Service - Request Deduplication Layer
 * 
 * RESPONSIBILITY: Ensures donation requests are processed exactly once
 * OWNER: Backend Team
 * DEPENDENCIES: Database, crypto
 * 
 * Prevents duplicate transaction execution using idempotency keys and request hashing.
 * Stores cached responses for duplicate requests with automatic TTL-based cleanup.
 */

const crypto = require('crypto');
const Database = require('../utils/database');

class IdempotencyService {
  constructor() {
    this.DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
  }

  /**
   * Generate hash from request data for duplicate detection
   * @param {Object} requestData - Request body data
   * @returns {string} SHA-256 hash of request
   */
  generateRequestHash(requestData) {
    const normalized = JSON.stringify(requestData, Object.keys(requestData).sort());
    return crypto.createHash('sha256').update(normalized).digest('hex');
  }

  /**
   * Store idempotency record
   * @param {string} idempotencyKey - Client-provided unique key
   * @param {string} requestHash - Hash of request data
   * @param {Object} response - Response to cache
   * @param {number} userId - User ID making the request
   * @returns {Promise<void>}
   */
  async store(idempotencyKey, requestHash, response, userId = null) {
    const expiresAt = new Date(Date.now() + this.DEFAULT_TTL).toISOString();
    
    await Database.run(
      `INSERT INTO idempotency_keys 
       (idempotencyKey, requestHash, response, userId, createdAt, expiresAt) 
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
      [idempotencyKey, requestHash, JSON.stringify(response), userId, expiresAt]
    );
  }

  /**
   * Check if idempotency key exists and return cached response
   * @param {string} idempotencyKey - Client-provided unique key
   * @returns {Promise<Object|null>} Cached response or null if not found
   */
  async get(idempotencyKey) {
    const record = await Database.get(
      `SELECT * FROM idempotency_keys 
       WHERE idempotencyKey = ? 
       AND datetime(expiresAt) > datetime('now')`,
      [idempotencyKey]
    );

    if (!record) {
      return null;
    }

    return {
      response: JSON.parse(record.response),
      requestHash: record.requestHash,
      createdAt: record.createdAt,
      isIdempotent: true
    };
  }

  /**
   * Check if request hash matches stored hash (detect duplicate with different key)
   * @param {string} requestHash - Hash of current request
   * @param {string} excludeKey - Idempotency key to exclude from search
   * @returns {Promise<Object|null>} Matching record or null
   */
  async findByHash(requestHash, excludeKey = null) {
    let query = `SELECT * FROM idempotency_keys 
                 WHERE requestHash = ? 
                 AND datetime(expiresAt) > datetime('now')`;
    const params = [requestHash];

    if (excludeKey) {
      query += ' AND idempotencyKey != ?';
      params.push(excludeKey);
    }

    const record = await Database.get(query, params);

    if (!record) {
      return null;
    }

    return {
      idempotencyKey: record.idempotencyKey,
      response: JSON.parse(record.response),
      createdAt: record.createdAt,
      isDuplicate: true
    };
  }

  /**
   * Validate idempotency key format
   * @param {string} key - Idempotency key to validate
   * @returns {Object} Validation result
   */
  validateKey(key) {
    if (!key || typeof key !== 'string') {
      return {
        valid: false,
        error: 'Idempotency key must be a non-empty string'
      };
    }

    if (key.length < 16) {
      return {
        valid: false,
        error: 'Idempotency key must be at least 16 characters long'
      };
    }

    if (key.length > 255) {
      return {
        valid: false,
        error: 'Idempotency key must not exceed 255 characters'
      };
    }

    // Check for valid characters (alphanumeric, hyphens, underscores)
    if (!/^[a-zA-Z0-9_-]+$/.test(key)) {
      return {
        valid: false,
        error: 'Idempotency key must contain only alphanumeric characters, hyphens, and underscores'
      };
    }

    return { valid: true };
  }

  /**
   * Generate a new idempotency key (for client reference)
   * @returns {string} UUID-based idempotency key
   */
  generateKey() {
    return `idem_${Date.now()}_${crypto.randomBytes(16).toString('hex')}`;
  }

  /**
   * Clean up expired idempotency records
   * Should be run periodically (e.g., daily cron job)
   * @returns {Promise<number>} Number of records deleted
   */
  async cleanupExpired() {
    const result = await Database.run(
      `DELETE FROM idempotency_keys 
       WHERE datetime(expiresAt) <= datetime('now')`
    );

    return result.changes || 0;
  }

  /**
   * Get statistics about idempotency usage
   * @returns {Promise<Object>} Statistics
   */
  async getStats() {
    const total = await Database.get(
      'SELECT COUNT(*) as count FROM idempotency_keys'
    );

    const active = await Database.get(
      `SELECT COUNT(*) as count FROM idempotency_keys 
       WHERE datetime(expiresAt) > datetime('now')`
    );

    const expired = await Database.get(
      `SELECT COUNT(*) as count FROM idempotency_keys 
       WHERE datetime(expiresAt) <= datetime('now')`
    );

    return {
      total: total.count,
      active: active.count,
      expired: expired.count
    };
  }

  /**
   * Delete idempotency record (for testing or manual cleanup)
   * @param {string} idempotencyKey - Key to delete
   * @returns {Promise<boolean>} True if deleted
   */
  async delete(idempotencyKey) {
    const result = await Database.run(
      'DELETE FROM idempotency_keys WHERE idempotencyKey = ?',
      [idempotencyKey]
    );

    return result.changes > 0;
  }
}

module.exports = new IdempotencyService();
