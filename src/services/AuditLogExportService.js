/**
 * Audit Log Export Service - Compliance Export Layer
 * 
 * RESPONSIBILITY: Generate async exports of audit logs for compliance and security reviews
 * OWNER: Compliance Team
 * DEPENDENCIES: Database, AuditLogService, config
 * 
 * Provides async export functionality for large audit log datasets with:
 * - Date range filtering
 * - JSON and CSV format support
 * - Async generation for large exports (>1000 records)
 * - Export status tracking
 */

const Database = require('../utils/database');
const AuditLogService = require('./AuditLogService');
const log = require('../utils/log');
const { ValidationError, NotFoundError, ERROR_CODES } = require('../utils/errors');
const crypto = require('crypto');

/**
 * Export status constants
 */
const EXPORT_STATUS = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED'
};

/**
 * Export format constants
 */
const EXPORT_FORMAT = {
  JSON: 'json',
  CSV: 'csv'
};

/**
 * Async export threshold - exports with more records than this are processed asynchronously
 * @type {number}
 */
const ASYNC_EXPORT_THRESHOLD = 1000;

/**
 * Audit log export service class
 */
class AuditLogExportService {
  /**
   * Generate unique export ID
   * @returns {string} Export ID
   */
  static generateExportId() {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Count audit logs for a specific API key within date range
   * @param {string} apiKeyId - API key ID
   * @param {Object} filters - Date range filters
   * @param {string} filters.startDate - Start date (ISO 8601)
   * @param {string} filters.endDate - End date (ISO 8601)
   * @param {string} filters.action - Action filter (optional)
   * @returns {Promise<number>} Count of matching records
   */
  static async countAuditLogs(apiKeyId, filters = {}) {
    const { startDate, endDate, action } = filters;

    let query = `
      SELECT COUNT(*) as count
      FROM audit_logs
      WHERE userId = ?
    `;
    const params = [apiKeyId];

    if (startDate) {
      query += ' AND timestamp >= ?';
      params.push(startDate);
    }

    if (endDate) {
      query += ' AND timestamp <= ?';
      params.push(endDate);
    }

    if (action) {
      query += ' AND action = ?';
      params.push(action);
    }

    const result = await Database.get(query, params);
    return result ? result.count : 0;
  }

  /**
   * Query audit logs for export
   * @param {string} apiKeyId - API key ID
   * @param {Object} options - Query options
   * @param {string} options.startDate - Start date (ISO 8601)
   * @param {string} options.endDate - End date (ISO 8601)
   * @param {string} options.action - Action filter (optional)
   * @param {number} options.limit - Maximum records
   * @param {number} options.offset - Pagination offset
   * @returns {Promise<Array>} Audit log entries
   */
  static async queryAuditLogs(apiKeyId, options = {}) {
    const { startDate, endDate, action, limit = 1000, offset = 0 } = options;

    let query = `
      SELECT 
        id,
        timestamp,
        category,
        action,
        severity,
        result,
        userId,
        requestId,
        ipAddress,
        resource,
        reason,
        details
      FROM audit_logs
      WHERE userId = ?
    `;
    const params = [apiKeyId];

    if (startDate) {
      query += ' AND timestamp >= ?';
      params.push(startDate);
    }

    if (endDate) {
      query += ' AND timestamp <= ?';
      params.push(endDate);
    }

    if (action) {
      query += ' AND action = ?';
      params.push(action);
    }

    query += ' ORDER BY timestamp DESC, id DESC';
    query += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = await Database.query(query, params);

    return rows.map(row => ({
      ...row,
      details: JSON.parse(row.details || '{}')
    }));
  }

  /**
   * Convert audit logs to JSON format
   * @param {Array} logs - Audit log entries
   * @returns {string} JSON string
   */
  static convertToJSON(logs) {
    return JSON.stringify(logs, null, 2);
  }

  /**
   * Convert audit logs to CSV format
   * @param {Array} logs - Audit log entries
   * @returns {string} CSV string
   */
  static convertToCSV(logs) {
    if (logs.length === 0) {
      return '';
    }

    // CSV headers
    const headers = [
      'id',
      'timestamp',
      'category',
      'action',
      'severity',
      'result',
      'userId',
      'requestId',
      'ipAddress',
      'resource',
      'reason',
      'details'
    ];

    const csvRows = [headers.join(',')];

    // CSV data rows
    for (const log of logs) {
      const row = [
        log.id,
        log.timestamp,
        log.category,
        log.action,
        log.severity,
        log.result,
        log.userId || '',
        log.requestId || '',
        log.ipAddress || '',
        log.resource || '',
        log.reason || '',
        JSON.stringify(log.details || {})
      ].map(field => {
        // Escape CSV fields
        const stringField = String(field);
        if (stringField.includes(',') || stringField.includes('"') || stringField.includes('\n')) {
          return `"${stringField.replace(/"/g, '""')}"`;
        }
        return stringField;
      });

      csvRows.push(row.join(','));
    }

    return csvRows.join('\n');
  }

  /**
   * Create export record in database
   * @param {string} exportId - Export ID
   * @param {string} apiKeyId - API key ID
   * @param {Object} filters - Export filters
   * @param {string} format - Export format
   * @param {number} recordCount - Total record count
   * @returns {Promise<Object>} Created export record
   */
  static async createExportRecord(exportId, apiKeyId, filters, format, recordCount) {
    await Database.run(
      `INSERT INTO audit_log_exports (
        export_id, api_key_id, start_date, end_date, action_filter,
        format, status, record_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        exportId,
        apiKeyId,
        filters.startDate || null,
        filters.endDate || null,
        filters.action || null,
        format,
        EXPORT_STATUS.PENDING,
        recordCount,
        new Date().toISOString()
      ]
    );

    return {
      exportId,
      apiKeyId,
      filters,
      format,
      status: EXPORT_STATUS.PENDING,
      recordCount,
      createdAt: new Date().toISOString()
    };
  }

  /**
   * Update export status
   * @param {string} exportId - Export ID
   * @param {string} status - New status
   * @param {string} filePath - File path (optional)
   * @param {string} errorMessage - Error message (optional)
   * @returns {Promise<void>}
   */
  static async updateExportStatus(exportId, status, filePath = null, errorMessage = null) {
    const updates = ['status = ?', 'updated_at = ?'];
    const params = [status, new Date().toISOString()];

    if (filePath) {
      updates.push('file_path = ?');
      params.push(filePath);
    }

    if (errorMessage) {
      updates.push('error_message = ?');
      params.push(errorMessage);
    }

    params.push(exportId);

    await Database.run(
      `UPDATE audit_log_exports SET ${updates.join(', ')} WHERE export_id = ?`,
      params
    );
  }

  /**
   * Get export record by ID
   * @param {string} exportId - Export ID
   * @returns {Promise<Object|null>} Export record or null
   */
  static async getExportRecord(exportId) {
    const row = await Database.get(
      'SELECT * FROM audit_log_exports WHERE export_id = ?',
      [exportId]
    );

    if (!row) {
      return null;
    }

    return {
      exportId: row.export_id,
      apiKeyId: row.api_key_id,
      startDate: row.start_date,
      endDate: row.end_date,
      actionFilter: row.action_filter,
      format: row.format,
      status: row.status,
      recordCount: row.record_count,
      filePath: row.file_path,
      errorMessage: row.error_message,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  /**
   * Process export synchronously (for small datasets)
   * @param {string} exportId - Export ID
   * @param {string} apiKeyId - API key ID
   * @param {Object} filters - Export filters
   * @param {string} format - Export format
   * @returns {Promise<string>} Export content
   */
  static async processExportSync(exportId, apiKeyId, filters, format) {
    try {
      await this.updateExportStatus(exportId, EXPORT_STATUS.PROCESSING);

      // Query audit logs
      const logs = await this.queryAuditLogs(apiKeyId, {
        ...filters,
        limit: filters.limit || 10000
      });

      // Convert to requested format
      let content;
      if (format === EXPORT_FORMAT.CSV) {
        content = this.convertToCSV(logs);
      } else {
        content = this.convertToJSON(logs);
      }

      // Update status to completed
      await this.updateExportStatus(exportId, EXPORT_STATUS.COMPLETED);

      log.info('AUDIT_EXPORT_SERVICE', 'Export completed synchronously', {
        exportId,
        apiKeyId,
        recordCount: logs.length,
        format
      });

      return content;
    } catch (error) {
      await this.updateExportStatus(exportId, EXPORT_STATUS.FAILED, null, error.message);
      throw error;
    }
  }

  /**
   * Process export asynchronously (for large datasets)
   * @param {string} exportId - Export ID
   * @param {string} apiKeyId - API key ID
   * @param {Object} filters - Export filters
   * @param {string} format - Export format
   * @returns {Promise<void>}
   */
  static async processExportAsync(exportId, apiKeyId, filters, format) {
    // This would typically be processed by a job queue
    // For now, we'll process it immediately but mark as async
    setImmediate(async () => {
      try {
        await this.updateExportStatus(exportId, EXPORT_STATUS.PROCESSING);

        // Query all audit logs
        const logs = await this.queryAuditLogs(apiKeyId, {
          ...filters,
          limit: filters.limit || 100000
        });

        // Convert to requested format
        let content;
        if (format === EXPORT_FORMAT.CSV) {
          content = this.convertToCSV(logs);
        } else {
          content = this.convertToJSON(logs);
        }

        // In production, save to file storage (S3, GCS, etc.)
        // For now, we'll just mark as completed
        await this.updateExportStatus(exportId, EXPORT_STATUS.COMPLETED);

        log.info('AUDIT_EXPORT_SERVICE', 'Export completed asynchronously', {
          exportId,
          apiKeyId,
          recordCount: logs.length,
          format
        });
      } catch (error) {
        await this.updateExportStatus(exportId, EXPORT_STATUS.FAILED, null, error.message);
        log.error('AUDIT_EXPORT_SERVICE', 'Async export failed', {
          exportId,
          apiKeyId,
          error: error.message
        });
      }
    });
  }

  /**
   * Initiate audit log export
   * @param {string} apiKeyId - API key ID
   * @param {Object} options - Export options
   * @param {string} options.startDate - Start date (ISO 8601)
   * @param {string} options.endDate - End date (ISO 8601)
   * @param {string} options.action - Action filter (optional)
   * @param {string} options.format - Export format (json or csv)
   * @returns {Promise<Object>} Export initiation result
   */
  static async initiateExport(apiKeyId, options = {}) {
    const { startDate, endDate, action, format = EXPORT_FORMAT.JSON } = options;

    // Validate format
    if (!Object.values(EXPORT_FORMAT).includes(format)) {
      throw new ValidationError(
        `Invalid format: ${format}. Must be 'json' or 'csv'.`,
        null,
        ERROR_CODES.INVALID_REQUEST
      );
    }

    // Validate date range
    if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
      throw new ValidationError(
        'Start date must be before end date',
        null,
        ERROR_CODES.INVALID_REQUEST
      );
    }

    // Count records
    const recordCount = await this.countAuditLogs(apiKeyId, { startDate, endDate, action });

    if (recordCount === 0) {
      throw new NotFoundError(
        'No audit logs found for the specified criteria',
        ERROR_CODES.NOT_FOUND
      );
    }

    // Generate export ID
    const exportId = this.generateExportId();

    // Create export record
    const exportRecord = await this.createExportRecord(
      exportId,
      apiKeyId,
      { startDate, endDate, action },
      format,
      recordCount
    );

    // Determine if async processing is needed
    const needsAsync = recordCount > ASYNC_EXPORT_THRESHOLD;

    if (needsAsync) {
      // Process asynchronously
      await this.processExportAsync(exportId, apiKeyId, { startDate, endDate, action }, format);

      return {
        exportId,
        status: EXPORT_STATUS.PENDING,
        recordCount,
        format,
        async: true,
        message: `Export initiated. ${recordCount} records will be processed asynchronously.`,
        statusUrl: `/api-keys/${apiKeyId}/audit-log/export/${exportId}`
      };
    } else {
      // Process synchronously
      const content = await this.processExportSync(exportId, apiKeyId, { startDate, endDate, action }, format);

      return {
        exportId,
        status: EXPORT_STATUS.COMPLETED,
        recordCount,
        format,
        async: false,
        content,
        message: `Export completed. ${recordCount} records exported.`
      };
    }
  }

  /**
   * Get export status
   * @param {string} apiKeyId - API key ID
   * @param {string} exportId - Export ID
   * @returns {Promise<Object>} Export status
   */
  static async getExportStatus(apiKeyId, exportId) {
    const exportRecord = await this.getExportRecord(exportId);

    if (!exportRecord) {
      throw new NotFoundError('Export not found', ERROR_CODES.NOT_FOUND);
    }

    // Verify export belongs to API key
    if (exportRecord.apiKeyId !== apiKeyId) {
      throw new ValidationError(
        'Export does not belong to this API key',
        null,
        ERROR_CODES.UNAUTHORIZED
      );
    }

    return {
      exportId: exportRecord.exportId,
      status: exportRecord.status,
      recordCount: exportRecord.recordCount,
      format: exportRecord.format,
      createdAt: exportRecord.createdAt,
      updatedAt: exportRecord.updatedAt,
      errorMessage: exportRecord.errorMessage,
      downloadUrl: exportRecord.status === EXPORT_STATUS.COMPLETED
        ? `/api-keys/${apiKeyId}/audit-log/export/${exportId}/download`
        : null
    };
  }

  /**
   * Get all exports for an API key
   * @param {string} apiKeyId - API key ID
   * @param {Object} options - Query options
   * @param {number} options.limit - Maximum results
   * @param {number} options.offset - Pagination offset
   * @returns {Promise<Array>} List of exports
   */
  static async getExports(apiKeyId, options = {}) {
    const { limit = 50, offset = 0 } = options;

    const rows = await Database.query(
      `SELECT 
        export_id,
        format,
        status,
        record_count,
        created_at,
        updated_at
      FROM audit_log_exports
      WHERE api_key_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?`,
      [apiKeyId, limit, offset]
    );

    return rows.map(row => ({
      exportId: row.export_id,
      format: row.format,
      status: row.status,
      recordCount: row.record_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  /**
   * Initialize export tables
   * @returns {Promise<void>}
   */
  static async initializeTables() {
    await Database.run(`
      CREATE TABLE IF NOT EXISTS audit_log_exports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        export_id TEXT UNIQUE NOT NULL,
        api_key_id TEXT NOT NULL,
        start_date TEXT,
        end_date TEXT,
        action_filter TEXT,
        format TEXT NOT NULL,
        status TEXT NOT NULL,
        record_count INTEGER NOT NULL,
        file_path TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT,
        FOREIGN KEY (api_key_id) REFERENCES api_keys(id)
      )
    `);

    log.info('AUDIT_EXPORT_SERVICE', 'Export tables initialized');
  }
}

module.exports = AuditLogExportService;
module.exports.EXPORT_STATUS = EXPORT_STATUS;
module.exports.EXPORT_FORMAT = EXPORT_FORMAT;
module.exports.ASYNC_EXPORT_THRESHOLD = ASYNC_EXPORT_THRESHOLD;
