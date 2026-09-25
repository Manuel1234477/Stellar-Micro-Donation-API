const path = require('path');
const crypto = require('crypto');
const fs = require('fs/promises');
const db = require('../utils/database');
const log = require('../utils/log');
const { ValidationError, NotFoundError, ERROR_CODES } = require('../utils/errors');
const { escapeField: csvEscape } = require('../utils/csvSerializer');

const EXPORT_TYPES = ['donations', 'wallets', 'audit_logs'];
const EXPORT_FORMATS = ['csv', 'json'];
const EXPORT_RETENTION_MS = 24 * 60 * 60 * 1000;
const SIGNED_URL_TTL_MS = 60 * 60 * 1000;
const EXPORT_DIR = path.join(__dirname, '../../data/exports');
const SIGNING_SECRET = process.env.EXPORT_SIGNING_SECRET || process.env.ENCRYPTION_SECRET || 'export-signing-secret';

/**
 * Convert records to CSV with a header row.
 * @param {Object[]} records - Records to serialize.
 * @param {string[]} headers - Ordered header names.
 * @returns {string} CSV content.
 */
function toCsv(records, headers) {
  const headerRow = headers.map(csvEscape).join(',');
  const rows = records.map((record) => headers.map((header) => csvEscape(record[header])).join(','));
  return [headerRow, ...rows].join('\n');
}

/**
 * Normalize DB rows for serialization.
 * @param {Object[]} rows - Raw DB rows.
 * @returns {Object[]} Normalized rows.
 */
function normalizeRows(rows) {
  return rows.map((row) => {
    const normalized = { ...row };
    Object.keys(normalized).forEach((key) => {
      const value = normalized[key];
      if (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) {
        try {
          normalized[key] = JSON.parse(value);
        } catch (_err) {
          // Leave non-JSON strings untouched.
        }
      }
    });
    return normalized;
  });
}

/**
 * Export data service for CSV/JSON generation and lifecycle management.
 */
class ExportService {
  /**
   * Build signed URL for an export ID.
   * @param {number|string} exportId - Export ID.
   * @returns {string} Signed URL.
   */
  static buildSignedUrl(exportId) {
    const expiresAtMs = Date.now() + SIGNED_URL_TTL_MS;
    const expires = String(expiresAtMs);
    const payload = `${exportId}:${expires}`;
    const signature = crypto.createHmac('sha256', SIGNING_SECRET).update(payload).digest('hex');
    const baseUrl = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || '3000'}`;
    return `${baseUrl}/exports/${exportId}/download?expires=${encodeURIComponent(expires)}&signature=${signature}`;
  }

  /**
   * Ensure the export jobs table and export directory exist.
   * @returns {Promise<void>}
   */
  static async ensureStorage() {
    await db.run(`
      CREATE TABLE IF NOT EXISTS export_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        format TEXT NOT NULL,
        status TEXT NOT NULL,
        dateStart TEXT,
        dateEnd TEXT,
        requestedBy TEXT,
        filePath TEXT,
        downloadUrl TEXT,
        error TEXT,
        createdAt TEXT NOT NULL,
        completedAt TEXT,
        expiresAt TEXT
      )
    `);
    await fs.mkdir(EXPORT_DIR, { recursive: true });
  }

  /**
   * Validate export type and format values.
   * @param {string} type - Export data type.
   * @param {string} format - Output format.
   * @returns {void}
   */
  static validateTypeAndFormat(type, format) {
    if (!EXPORT_TYPES.includes(type)) {
      throw new ValidationError('Invalid export type', { allowed: EXPORT_TYPES }, ERROR_CODES.INVALID_REQUEST);
    }
    if (!EXPORT_FORMATS.includes(format)) {
      throw new ValidationError('Invalid export format', { allowed: EXPORT_FORMATS }, ERROR_CODES.INVALID_REQUEST);
    }
  }

  /**
   * Validate optional ISO date range.
   * @param {{ startDate?: string, endDate?: string }} [dateRange={}] - Date range filters.
   * @returns {{ startDate: string|null, endDate: string|null }} Normalized date range.
   */
  static validateDateRange(dateRange = {}) {
    const startDate = dateRange.startDate || null;
    const endDate = dateRange.endDate || null;

    if (startDate && Number.isNaN(new Date(startDate).getTime())) {
      throw new ValidationError('Invalid startDate', null, ERROR_CODES.INVALID_DATE_FORMAT);
    }
    if (endDate && Number.isNaN(new Date(endDate).getTime())) {
      throw new ValidationError('Invalid endDate', null, ERROR_CODES.INVALID_DATE_FORMAT);
    }
    if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
      throw new ValidationError('startDate must not be after endDate', null, ERROR_CODES.INVALID_REQUEST);
    }

    return { startDate, endDate };
  }

  /**
   * Resolve source table metadata for export type.
   * @param {string} type - Export type.
   * @returns {{ table: string, timestampColumn: string, headers: string[] }} Table mapping.
   */
  static getTypeMetadata(type) {
    if (type === 'donations') {
      return {
        table: 'transactions',
        timestampColumn: 'timestamp',
        headers: ['id', 'senderId', 'receiverId', 'amount', 'memo', 'timestamp', 'stellar_tx_id'],
      };
    }
    if (type === 'wallets') {
      return {
        table: 'users',
        timestampColumn: 'createdAt',
        headers: ['id', 'publicKey', 'createdAt', 'daily_limit', 'monthly_limit', 'per_transaction_limit'],
      };
    }
    return {
      table: 'audit_logs',
      timestampColumn: 'timestamp',
      headers: ['id', 'timestamp', 'category', 'action', 'severity', 'result', 'userId', 'requestId', 'resource', 'details'],
    };
  }

  /**
   * Generate a signed download URL for a completed export.
   * @param {number|string} exportId - Export job ID.
   * @returns {Promise<string>} Signed URL valid for one hour.
   */
  static async getSignedDownloadUrl(exportId) {
    await this.ensureStorage();
    const job = await db.get('SELECT * FROM export_jobs WHERE id = ?', [exportId]);
    if (!job) {
      throw new NotFoundError('Export job not found', ERROR_CODES.NOT_FOUND);
    }
    if (job.status !== 'completed') {
      throw new ValidationError('Export is not ready for download', null, ERROR_CODES.INVALID_REQUEST);
    }

    return this.buildSignedUrl(job.id);
  }

  /**
   * Query and return rows for the given export job.
   * @param {{ type: string, dateStart?: string, dateEnd?: string }} job - Export job record.
   * @returns {Promise<{ rows: Object[], headers: string[] }>} Data rows and headers.
   */
  static async fetchRowsForJob(job) {
    const metadata = this.getTypeMetadata(job.type);
    let query = `SELECT * FROM ${metadata.table} WHERE 1=1`;
    const params = [];

    if (job.dateStart) {
      query += ` AND ${metadata.timestampColumn} >= ?`;
      params.push(job.dateStart);
    }
    if (job.dateEnd) {
      query += ` AND ${metadata.timestampColumn} <= ?`;
      params.push(job.dateEnd);
    }
    query += ` ORDER BY ${metadata.timestampColumn} DESC`;

    const rows = await db.all(query, params);
    const normalizedRows = normalizeRows(rows);
    const headers = normalizedRows.length > 0 ? Object.keys(normalizedRows[0]) : metadata.headers;
    return { rows: normalizedRows, headers };
  }

  /**
   * Persist export payload to disk.
   * @param {number|string} exportId - Export ID.
   * @param {string} format - Export format.
   * @param {string} content - Serialized content.
   * @returns {Promise<string>} Persisted file path.
   */
  static async writeExportFile(exportId, format, content) {
    const filePath = path.join(EXPORT_DIR, `export-${exportId}.${format}`);
    await fs.writeFile(filePath, content, 'utf8');
    return filePath;
  }

  /**
   * Create an export job and trigger async generation.
   * @param {{ type: string, format: string, dateRange?: {startDate?: string, endDate?: string}, requestedBy?: string }} params - Export params.
   * @returns {Promise<number>} New export job ID.
   */
  static async initiateExport({ type, format, dateRange = {}, requestedBy = null }) {
    await this.ensureStorage();
    this.validateTypeAndFormat(type, format);
    const { startDate, endDate } = this.validateDateRange(dateRange);
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + EXPORT_RETENTION_MS).toISOString();

    const result = await db.run(
      `INSERT INTO export_jobs (type, format, status, dateStart, dateEnd, requestedBy, createdAt, expiresAt)
       VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)`,
      [type, format, startDate, endDate, requestedBy, now, expiresAt]
    );

    const exportId = result.lastID;
    this.processExport(exportId).catch((err) => {
      log.error('Export processing failed', { exportId, error: err.message });
    });

    return exportId;
  }

  /**
   * Process a queued export job: pending → processing → completed/failed.
   * @param {number|string} exportId - Export job ID.
   * @returns {Promise<void>}
   */
  static async processExport(exportId) {
    await this.ensureStorage();
    const job = await db.get('SELECT * FROM export_jobs WHERE id = ?', [exportId]);
    if (!job) {
      throw new NotFoundError('Export job not found', ERROR_CODES.NOT_FOUND);
    }

    await db.run(`UPDATE export_jobs SET status = 'processing' WHERE id = ?`, [exportId]);

    try {
      const { rows, headers } = await this.fetchRowsForJob(job);
      const content = job.format === 'json' ? JSON.stringify(rows, null, 2) : toCsv(rows, headers);
      const filePath = await this.writeExportFile(exportId, job.format, content);
      const downloadUrl = this.buildSignedUrl(exportId);
      const completedAt = new Date().toISOString();

      await db.run(
        `UPDATE export_jobs SET status = 'completed', filePath = ?, downloadUrl = ?, completedAt = ? WHERE id = ?`,
        [filePath, downloadUrl, completedAt, exportId]
      );
    } catch (err) {
      await db.run(`UPDATE export_jobs SET status = 'failed', error = ? WHERE id = ?`, [err.message, exportId]);
      throw err;
    }
  }

  /**
   * Fetch export job status.
   * @param {number|string} exportId - Export job ID.
   * @returns {Promise<Object>} Export job record.
   */
  static async getExportStatus(exportId) {
    await this.ensureStorage();
    const job = await db.get('SELECT * FROM export_jobs WHERE id = ?', [exportId]);
    if (!job) {
      throw new NotFoundError('Export job not found', ERROR_CODES.NOT_FOUND);
    }
    return job;
  }
}

module.exports = ExportService;
