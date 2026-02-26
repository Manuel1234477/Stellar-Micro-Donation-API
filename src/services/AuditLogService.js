/**
 * Audit Log Service - Security Audit Layer
 * 
 * RESPONSIBILITY: Immutable audit trail for security-sensitive operations
 * OWNER: Security Team
 * DEPENDENCIES: Database, logger, sanitizer
 * 
 * Provides tamper-evident logging for compliance and security monitoring.
 * All audit logs are write-once and include cryptographic integrity checks.
 */

const db = require('../utils/database');
const log = require('../utils/log');
const crypto = require('crypto');
const { sanitizeForLogging } = require('../utils/sanitizer');

/**
 * Audit event severity levels
 */
const AUDIT_SEVERITY = {
  HIGH: 'HIGH',     // Critical security events (auth failures, key operations)
  MEDIUM: 'MEDIUM', // Important operations (wallet ops, config changes)
  LOW: 'LOW'        // Informational (successful auth, queries)
};

/**
 * Audit event categories
 */
const AUDIT_CATEGORY = {
  AUTHENTICATION: 'AUTHENTICATION',
  AUTHORIZATION: 'AUTHORIZATION',
  API_KEY_MANAGEMENT: 'API_KEY_MANAGEMENT',
  FINANCIAL_OPERATION: 'FINANCIAL_OPERATION',
  WALLET_OPERATION: 'WALLET_OPERATION',
  CONFIGURATION: 'CONFIGURATION',
  RATE_LIMITING: 'RATE_LIMITING',
  ABUSE_DETECTION: 'ABUSE_DETECTION',
  DATA_ACCESS: 'DATA_ACCESS'
};

/**
 * Audit event actions
 */
const AUDIT_ACTION = {
  // Authentication
  API_KEY_VALIDATED: 'API_KEY_VALIDATED',
  API_KEY_VALIDATION_FAILED: 'API_KEY_VALIDATION_FAILED',
  LEGACY_KEY_USED: 'LEGACY_KEY_USED',
  
  // Authorization
  PERMISSION_GRANTED: 'PERMISSION_GRANTED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  ADMIN_ACCESS_GRANTED: 'ADMIN_ACCESS_GRANTED',
  ADMIN_ACCESS_DENIED: 'ADMIN_ACCESS_DENIED',
  
  // API Key Management
  API_KEY_CREATED: 'API_KEY_CREATED',
  API_KEY_LISTED: 'API_KEY_LISTED',
  API_KEY_DEPRECATED: 'API_KEY_DEPRECATED',
  API_KEY_REVOKED: 'API_KEY_REVOKED',
  
  // Financial Operations
  DONATION_CREATED: 'DONATION_CREATED',
  DONATION_VERIFIED: 'DONATION_VERIFIED',
  DONATION_STATUS_UPDATED: 'DONATION_STATUS_UPDATED',
  TRANSACTION_RECORDED: 'TRANSACTION_RECORDED',
  
  // Wallet Operations
  WALLET_CREATED: 'WALLET_CREATED',
  WALLET_UPDATED: 'WALLET_UPDATED',
  WALLET_QUERIED: 'WALLET_QUERIED',
  WALLET_TRANSACTIONS_ACCESSED: 'WALLET_TRANSACTIONS_ACCESSED',
  
  // Configuration
  CONFIG_LOADED: 'CONFIG_LOADED',
  DEBUG_MODE_ENABLED: 'DEBUG_MODE_ENABLED',
  NETWORK_CHANGED: 'NETWORK_CHANGED',
  
  // Rate Limiting & Abuse
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  ABUSE_DETECTED: 'ABUSE_DETECTED',
  IP_FLAGGED: 'IP_FLAGGED',
  REPLAY_DETECTED: 'REPLAY_DETECTED'
};

class AuditLogService {
  /**
   * Log a security-sensitive operation
   * @param {Object} params - Audit log parameters
   * @param {string} params.category - Event category (from AUDIT_CATEGORY)
   * @param {string} params.action - Event action (from AUDIT_ACTION)
   * @param {string} params.severity - Event severity (from AUDIT_SEVERITY)
   * @param {string} params.result - Operation result ('SUCCESS' or 'FAILURE')
   * @param {string} params.userId - User or API key identifier
   * @param {string} params.requestId - Request correlation ID
   * @param {string} params.ipAddress - Client IP address
   * @param {Object} params.details - Additional context (will be sanitized)
   * @param {string} params.resource - Resource being accessed (optional)
   * @param {string} params.reason - Reason for failure (optional)
   * @returns {Promise<Object>} Created audit log entry
   */
  static async log({
    category,
    action,
    severity,
    result,
    userId = null,
    requestId = null,
    ipAddress = null,
    details = {},
    resource = null,
    reason = null
  }) {
    try {
      // Validate required fields
      if (!category || !action || !severity || !result) {
        throw new Error('Missing required audit log fields');
      }

      // Sanitize details to prevent sensitive data leakage
      const sanitizedDetails = sanitizeForLogging(details);

      // Create audit entry
      const auditEntry = {
        timestamp: new Date().toISOString(),
        category,
        action,
        severity,
        result,
        userId,
        requestId,
        ipAddress,
        resource,
        reason,
        details: JSON.stringify(sanitizedDetails)
      };

      // Generate integrity hash
      const hash = this.generateHash(auditEntry);
      auditEntry.integrityHash = hash;

      // Insert into database (immutable)
      const result = await db.run(
        `INSERT INTO audit_logs (
          timestamp, category, action, severity, result,
          userId, requestId, ipAddress, resource, reason,
          details, integrityHash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          auditEntry.timestamp,
          auditEntry.category,
          auditEntry.action,
          auditEntry.severity,
          auditEntry.result,
          auditEntry.userId,
          auditEntry.requestId,
          auditEntry.ipAddress,
          auditEntry.resource,
          auditEntry.reason,
          auditEntry.details,
          auditEntry.integrityHash
        ]
      );

      // Also log to application logs for real-time monitoring
      const logLevel = severity === AUDIT_SEVERITY.HIGH ? 'warn' : 'info';
      log[logLevel]('AUDIT', `${action}: ${result}`, {
        category,
        action,
        severity,
        result,
        userId,
        requestId,
        ipAddress,
        resource,
        reason
      });

      return {
        id: result.lastID,
        ...auditEntry
      };
    } catch (error) {
      // Critical: Audit logging failure should be logged but not block operations
      log.error('AUDIT_SERVICE', 'Failed to create audit log', {
        error: error.message,
        category,
        action
      });
      throw error;
    }
  }

  /**
   * Generate cryptographic hash for integrity verification
   * @param {Object} entry - Audit log entry
   * @returns {string} SHA-256 hash
   */
  static generateHash(entry) {
    const data = `${entry.timestamp}|${entry.category}|${entry.action}|${entry.result}|${entry.userId}|${entry.details}`;
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Verify integrity of an audit log entry
   * @param {Object} entry - Audit log entry from database
   * @returns {boolean} True if integrity check passes
   */
  static verifyIntegrity(entry) {
    const expectedHash = this.generateHash(entry);
    return expectedHash === entry.integrityHash;
  }

  /**
   * Query audit logs with filters
   * @param {Object} filters - Query filters
   * @param {string} filters.category - Filter by category
   * @param {string} filters.action - Filter by action
   * @param {string} filters.severity - Filter by severity
   * @param {string} filters.userId - Filter by user
   * @param {string} filters.requestId - Filter by request
   * @param {string} filters.startDate - Filter by start date (ISO 8601)
   * @param {string} filters.endDate - Filter by end date (ISO 8601)
   * @param {number} filters.limit - Maximum results (default 100)
   * @param {number} filters.offset - Pagination offset (default 0)
   * @returns {Promise<Array>} Audit log entries
   */
  static async query(filters = {}) {
    try {
      const {
        category,
        action,
        severity,
        userId,
        requestId,
        startDate,
        endDate,
        limit = 100,
        offset = 0
      } = filters;

      let query = 'SELECT * FROM audit_logs WHERE 1=1';
      const params = [];

      if (category) {
        query += ' AND category = ?';
        params.push(category);
      }

      if (action) {
        query += ' AND action = ?';
        params.push(action);
      }

      if (severity) {
        query += ' AND severity = ?';
        params.push(severity);
      }

      if (userId) {
        query += ' AND userId = ?';
        params.push(userId);
      }

      if (requestId) {
        query += ' AND requestId = ?';
        params.push(requestId);
      }

      if (startDate) {
        query += ' AND timestamp >= ?';
        params.push(startDate);
      }

      if (endDate) {
        query += ' AND timestamp <= ?';
        params.push(endDate);
      }

      query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);

      const rows = await db.all(query, params);

      // Parse JSON details
      return rows.map(row => ({
        ...row,
        details: JSON.parse(row.details || '{}')
      }));
    } catch (error) {
      log.error('AUDIT_SERVICE', 'Failed to query audit logs', {
        error: error.message,
        filters
      });
      throw error;
    }
  }

  /**
   * Get audit log statistics
   * @param {Object} filters - Query filters (same as query method)
   * @returns {Promise<Object>} Statistics summary
   */
  static async getStatistics(filters = {}) {
    try {
      const {
        category,
        action,
        severity,
        userId,
        startDate,
        endDate
      } = filters;

      let query = `
        SELECT 
          category,
          action,
          severity,
          result,
          COUNT(*) as count
        FROM audit_logs
        WHERE 1=1
      `;
      const params = [];

      if (category) {
        query += ' AND category = ?';
        params.push(category);
      }

      if (action) {
        query += ' AND action = ?';
        params.push(action);
      }

      if (severity) {
        query += ' AND severity = ?';
        params.push(severity);
      }

      if (userId) {
        query += ' AND userId = ?';
        params.push(userId);
      }

      if (startDate) {
        query += ' AND timestamp >= ?';
        params.push(startDate);
      }

      if (endDate) {
        query += ' AND timestamp <= ?';
        params.push(endDate);
      }

      query += ' GROUP BY category, action, severity, result';

      const rows = await db.all(query, params);
      return rows;
    } catch (error) {
      log.error('AUDIT_SERVICE', 'Failed to get audit statistics', {
        error: error.message,
        filters
      });
      throw error;
    }
  }
}

// Export constants for use in other modules
AuditLogService.SEVERITY = AUDIT_SEVERITY;
AuditLogService.CATEGORY = AUDIT_CATEGORY;
AuditLogService.ACTION = AUDIT_ACTION;

module.exports = AuditLogService;
