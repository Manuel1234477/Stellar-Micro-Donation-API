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
const { maskSensitiveData } = require('../utils/dataMasker');
const { ValidationError, ERROR_CODES } = require('../utils/errors');
const {
  buildCursorWhereClause,
  buildCursorMeta,
} = require('../utils/pagination');

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
  REPLAY_DETECTED: 'REPLAY_DETECTED',

  // Fee Bump Operations
  FEE_BUMP_APPLIED: 'FEE_BUMP_APPLIED',
  FEE_BUMP_FAILED: 'FEE_BUMP_FAILED',
  FEE_BUMP_AUTO_DETECTED: 'FEE_BUMP_AUTO_DETECTED',

  // Wallet Inflation Destination
  INFLATION_DESTINATION_UPDATED: 'INFLATION_DESTINATION_UPDATED',

  // Bulk Operations
  BULK_WALLET_IMPORT: 'BULK_WALLET_IMPORT',
};

class AuditLogService {
  /**
   * Log a non-fatal audit write failure without polluting test output.
   * Audit logging is best-effort for application flows, so swallowed write
   * failures in tests should not surface as console errors.
   *
   * @param {Error} error - Original failure.
   * @param {string} category - Audit category.
   * @param {string} action - Audit action.
   */
  static logWriteFailure(error, category, action) {
    const meta = {
      error: error.message,
      category,
      action
    };

    if (process.env.NODE_ENV === 'test') {
      log.debug('AUDIT_SERVICE', 'Audit log write skipped due to database failure in test mode', meta);
      return;
    }

    log.error('AUDIT_SERVICE', 'Failed to create audit log', meta);
  }

  /**
   * Build the SQL filter clause for audit log queries.
   * @param {Object} filters - Query filters.
   * @returns {{ clause: string, params: Array }} SQL clause fragment and parameters.
   */
  static buildFilterQuery(filters = {}) {
    const {
      category,
      action,
      severity,
      userId,
      requestId,
      startDate,
      endDate
    } = filters;

    let query = ' FROM audit_logs WHERE 1=1';
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

    return { clause: query, params };
  }

  /**
   * Parse JSON details for audit log rows.
   * @param {Object[]} rows - Raw database rows.
   * @returns {Object[]} Parsed audit log entries.
   */
  static parseRows(rows) {
    return rows.map(row => ({
      ...row,
      details: JSON.parse(row.details || '{}')
    }));
  }

  /**
   * Validate that a cursor belongs to the filtered audit log result set.
   * @param {Object} filters - Query filters.
   * @param {{ timestamp: string, id: string }|null} cursor - Decoded cursor.
   * @returns {Promise<boolean>} True when the cursor matches a filtered row.
   */
  static async cursorExists(filters = {}, cursor = null) {
    if (!cursor) {
      return true;
    }

    const filterQuery = this.buildFilterQuery(filters);
    const row = await db.get(
      `SELECT id${filterQuery.clause} AND timestamp = ? AND id = ? LIMIT 1`,
      [...filterQuery.params, cursor.timestamp, cursor.id]
    );

    return Boolean(row);
  }
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
  static async log(params) {
    return AuditLogService._log(params);
  }

  static async _log({
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
      const sanitizedDetails = maskSensitiveData(sanitizeForLogging(details), { showPartial: true });

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

      // Ensure audit_logs table exists
      await db.run(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp TEXT NOT NULL,
          category TEXT NOT NULL,
          action TEXT NOT NULL,
          severity TEXT NOT NULL,
          result TEXT NOT NULL,
          userId TEXT,
          requestId TEXT,
          ipAddress TEXT,
          resource TEXT,
          reason TEXT,
          details TEXT,
          integrityHash TEXT NOT NULL
        )
      `);

      // Insert into database (immutable)
      const dbResult = await db.run(
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
      if (process.env.NODE_ENV !== 'test') {
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
      }

      return {
        id: dbResult.id,
        ...auditEntry
      };
    } catch (error) {
      this.logWriteFailure(error, category, action);
      // Re-throw validation errors, swallow DB errors
      if (error.message === 'Missing required audit log fields') {
        throw error;
      }
      // Don't re-throw DB errors — audit log failures should never block operations
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
        limit = 100,
        offset = 0,
        ...queryFilters
      } = filters;
      const filterQuery = this.buildFilterQuery(queryFilters);
      const rows = await db.all(
        `SELECT *${filterQuery.clause} ORDER BY timestamp DESC, id DESC LIMIT ? OFFSET ?`,
        [...filterQuery.params, limit, offset]
      );

      return this.parseRows(rows);
    } catch (error) {
      log.error('AUDIT_SERVICE', 'Failed to query audit logs', {
        error: error.message,
        filters
      });
      throw error;
    }
  }

  /**
   * Query audit logs using cursor-based pagination.
   * @param {Object} filters - Query filters.
   * @param {Object} pagination - Pagination options.
   * @param {{ timestamp: string, id: string }|null} pagination.cursor - Decoded cursor.
   * @param {number} pagination.limit - Page size.
   * @param {string} pagination.direction - Pagination direction.
   * @returns {Promise<{ data: Array, totalCount: number, meta: Object }>} Paginated results.
   */
  static async queryPaginated(filters = {}, pagination = {}) {
    const {
      cursor = null,
      limit = 20,
      direction = 'next',
    } = pagination;

    const filterQuery = this.buildFilterQuery(filters);
    const totalRow = await db.get(
      `SELECT COUNT(*) as total${filterQuery.clause}`,
      filterQuery.params
    );

    const cursorIsValid = await this.cursorExists(filters, cursor);
    if (!cursorIsValid) {
      throw new ValidationError('Invalid cursor parameter', null, ERROR_CODES.INVALID_REQUEST);
    }

    const cursorWhere = buildCursorWhereClause({
      cursor,
      direction,
      timestampColumn: 'timestamp',
      idColumn: 'id',
    });

    const orderBy = direction === 'prev'
      ? ' ORDER BY timestamp ASC, id ASC'
      : ' ORDER BY timestamp DESC, id DESC';

    const rows = await db.all(
      `SELECT *${filterQuery.clause}${cursorWhere.clause}${orderBy} LIMIT ?`,
      [...filterQuery.params, ...cursorWhere.params, limit + 1]
    );

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const normalizedRows = direction === 'prev' ? [...pageRows].reverse() : pageRows;

    return {
      data: this.parseRows(normalizedRows),
      totalCount: totalRow ? totalRow.total : 0,
      meta: buildCursorMeta({
        items: normalizedRows,
        limit,
        direction,
        hasMore,
        hasCursor: Boolean(cursor),
        timestampField: 'timestamp',
        idField: 'id',
      }),
    };
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
