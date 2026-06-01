/**
 * Donation Export Service (Issue #123)
 * 
 * RESPONSIBILITY: Async export of donation data with job tracking
 * OWNER: Platform Team
 * 
 * Provides async export functionality for large donation datasets.
 * Jobs are tracked in database, files stored on disk with 24-hour retention.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const Database = require('../utils/database');
const log = require('../utils/log');
const { ValidationError, NotFoundError } = require('../utils/errors');
const { ERROR_CODES } = require('../utils/errors');

const EXPORT_DIR = path.join(__dirname, '../../data/exports');
const EXPORT_RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours
const SIGNED_URL_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

const EXPORT_STATUS = {
  QUEUED: 'queued',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

const EXPORT_FORMAT = {
  CSV: 'csv',
  JSON: 'json',
};

class DonationExportService {
  /**
   * Initialize export tables and storage directory.
   */
  static async initialize() {
    await Database.run(`
      CREATE TABLE IF NOT EXISTS donation_exports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        export_id TEXT UNIQUE NOT NULL,
        api_key_id TEXT NOT NULL,
        start_date TEXT,
        end_date TEXT,
        status_filter TEXT,
        sender_public_key TEXT,
        recipient_public_key TEXT,
        format TEXT NOT NULL,
        status TEXT NOT NULL,
        record_count INTEGER DEFAULT 0,
        file_path TEXT,
        error_message TEXT,
        signed_url TEXT,
        signed_url_expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT,
        FOREIGN KEY (api_key_id) REFERENCES api_keys(id)
      )
    `);

    await fs.mkdir(EXPORT_DIR, { recursive: true });
    log.info('DONATION_EXPORT_SERVICE', 'Export tables and storage initialized');
  }

  /**
   * Generate a unique export ID.
   * @returns {string} Export ID in format 'export-{timestamp}-{random}'
   */
  static generateExportId() {
    const timestamp = Date.now();
    const random = crypto.randomBytes(4).toString('hex');
    return `export-${timestamp}-${random}`;
  }

  /**
   * Queue an async export job.
   * @param {string} apiKeyId - API key / user ID
   * @param {Object} options - Export options
   * @param {string|null} options.startDate - ISO date string
   * @param {string|null} options.endDate - ISO date string
   * @param {string|null} options.status - Transaction status filter
   * @param {string|null} options.senderPublicKey - Sender public key filter
   * @param {string|null} options.recipientPublicKey - Recipient public key filter
   * @param {string} options.format - 'json' or 'csv'
   * @returns {Promise<{jobId: string, status: string}>}
   */
  static async queueExportJob(apiKeyId, options = {}) {
    const {
      startDate,
      endDate,
      status,
      senderPublicKey,
      recipientPublicKey,
      format = EXPORT_FORMAT.CSV,
    } = options;

    // Validate format
    if (!Object.values(EXPORT_FORMAT).includes(format)) {
      throw new ValidationError(
        `Invalid format: ${format}`,
        { allowed: Object.values(EXPORT_FORMAT) },
        ERROR_CODES.INVALID_REQUEST
      );
    }

    // Validate date range
    if (startDate && Number.isNaN(new Date(startDate).getTime())) {
      throw new ValidationError('Invalid startDate', null, ERROR_CODES.INVALID_DATE_FORMAT);
    }
    if (endDate && Number.isNaN(new Date(endDate).getTime())) {
      throw new ValidationError('Invalid endDate', null, ERROR_CODES.INVALID_DATE_FORMAT);
    }
    if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
      throw new ValidationError(
        'startDate must not be after endDate',
        null,
        ERROR_CODES.INVALID_REQUEST
      );
    }

    const jobId = this.generateExportId();
    const createdAt = new Date().toISOString();

    await Database.run(
      `INSERT INTO donation_exports (
        export_id, api_key_id, start_date, end_date, status_filter,
        sender_public_key, recipient_public_key, format, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        jobId,
        apiKeyId,
        startDate || null,
        endDate || null,
        status || null,
        senderPublicKey || null,
        recipientPublicKey || null,
        format,
        EXPORT_STATUS.QUEUED,
        createdAt,
      ]
    );

    // Process asynchronously
    setImmediate(async () => {
      try {
        await this.processExportJob(jobId);
      } catch (err) {
        log.error('DONATION_EXPORT_SERVICE', 'Async export job failed', {
          jobId,
          error: err.message,
        });
      }
    });

    return { jobId, status: EXPORT_STATUS.QUEUED };
  }

  /**
   * Process an export job in the background.
   * @param {string} jobId - Export job ID
   */
  static async processExportJob(jobId) {
    try {
      // Update status to processing
      await this.updateExportStatus(jobId, EXPORT_STATUS.PROCESSING);

      // Fetch job details
      const job = await Database.get(
        'SELECT * FROM donation_exports WHERE export_id = ?',
        [jobId]
      );

      if (!job) {
        throw new Error('Job not found');
      }

      // Query donations with filters
      const donations = await this.queryDonations({
        startDate: job.start_date,
        endDate: job.end_date,
        status: job.status_filter,
        senderPublicKey: job.sender_public_key,
        recipientPublicKey: job.recipient_public_key,
      });

      // Generate export content
      let content;
      if (job.format === EXPORT_FORMAT.CSV) {
        content = this.convertToCSV(donations);
      } else {
        content = this.convertToJSON(donations);
      }

      // Write to file
      const fileName = `${jobId}.${job.format}`;
      const filePath = path.join(EXPORT_DIR, fileName);
      await fs.writeFile(filePath, content, 'utf8');

      // Generate signed URL
      const expiresAt = new Date(Date.now() + SIGNED_URL_EXPIRY_MS).toISOString();
      const token = crypto
        .createHmac('sha256', process.env.ENCRYPTION_KEY || 'dev-secret')
        .update(`${jobId}:${expiresAt}`)
        .digest('hex');
      const signedUrl = `/donations/export/${jobId}/download?token=${token}&expires=${encodeURIComponent(
        expiresAt
      )}`;

      // Update job as completed
      await Database.run(
        `UPDATE donation_exports 
         SET status = ?, record_count = ?, file_path = ?, signed_url = ?, 
             signed_url_expires_at = ?, updated_at = ? 
         WHERE export_id = ?`,
        [
          EXPORT_STATUS.COMPLETED,
          donations.length,
          filePath,
          signedUrl,
          expiresAt,
          new Date().toISOString(),
          jobId,
        ]
      );

      log.info('DONATION_EXPORT_SERVICE', 'Export job completed', {
        jobId,
        records: donations.length,
        format: job.format,
      });
    } catch (err) {
      await this.updateExportStatus(jobId, EXPORT_STATUS.FAILED, err.message);
      log.error('DONATION_EXPORT_SERVICE', 'Export job failed', {
        jobId,
        error: err.message,
      });
    }
  }

  /**
   * Query donations with filters.
   * @param {Object} filters - Query filters
   * @returns {Promise<Array>} Donation records
   */
  static async queryDonations(filters = {}) {
    let query = `
      SELECT 
        t.id,
        t.amount,
        sender.publicKey AS senderPublicKey,
        receiver.publicKey AS recipientPublicKey,
        t.memo,
        t.status,
        t.timestamp,
        t.stellar_tx_id AS transactionHash
      FROM transactions t
      LEFT JOIN users sender ON t.senderId = sender.id
      LEFT JOIN users receiver ON t.receiverId = receiver.id
      WHERE 1=1
    `;
    const params = [];

    if (filters.startDate) {
      query += ' AND t.timestamp >= ?';
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      query += ' AND t.timestamp <= ?';
      params.push(filters.endDate);
    }
    if (filters.status) {
      query += ' AND t.status = ?';
      params.push(filters.status);
    }
    if (filters.senderPublicKey) {
      query += ' AND sender.publicKey = ?';
      params.push(filters.senderPublicKey);
    }
    if (filters.recipientPublicKey) {
      query += ' AND receiver.publicKey = ?';
      params.push(filters.recipientPublicKey);
    }

    query += ' ORDER BY t.timestamp DESC';

    return await Database.all(query, params);
  }

  /**
   * Convert donations to CSV format.
   * @param {Array} donations - Donation records
   * @returns {string} CSV content
   */
  static convertToCSV(donations) {
    const headers = [
      'id',
      'amount',
      'senderPublicKey',
      'recipientPublicKey',
      'memo',
      'status',
      'timestamp',
      'transactionHash',
    ];

    const csvEscape = (value) => {
      if (value === null || value === undefined) return '';
      const str = String(value);
      if (str.includes('"') || str.includes(',') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const rows = [headers.join(',')];
    for (const donation of donations) {
      const row = headers.map((h) => csvEscape(donation[h])).join(',');
      rows.push(row);
    }

    return rows.join('\n');
  }

  /**
   * Convert donations to JSON format.
   * @param {Array} donations - Donation records
   * @returns {string} JSON content
   */
  static convertToJSON(donations) {
    return JSON.stringify(donations, null, 2);
  }

  /**
   * Update export job status.
   * @param {string} jobId - Export job ID
   * @param {string} status - New status
   * @param {string|null} errorMessage - Error message if failed
   */
  static async updateExportStatus(jobId, status, errorMessage = null) {
    await Database.run(
      `UPDATE donation_exports 
       SET status = ?, error_message = ?, updated_at = ? 
       WHERE export_id = ?`,
      [status, errorMessage, new Date().toISOString(), jobId]
    );
  }

  /**
   * Get export job status.
   * @param {string} jobId - Export job ID
   * @returns {Promise<Object>} Job status
   */
  static async getJobStatus(jobId) {
    const job = await Database.get(
      'SELECT * FROM donation_exports WHERE export_id = ?',
      [jobId]
    );

    if (!job) {
      throw new NotFoundError('Export job not found', ERROR_CODES.NOT_FOUND);
    }

    const response = {
      jobId: job.export_id,
      status: job.status,
      progress: {
        processed: job.record_count || 0,
        total: job.record_count || 0,
      },
      downloadUrl: null,
      urlExpiresAt: null,
      error: job.error_message,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
    };

    // Include download URL if completed and not expired
    if (job.status === EXPORT_STATUS.COMPLETED && job.signed_url) {
      const expiresAt = new Date(job.signed_url_expires_at);
      if (expiresAt > new Date()) {
        response.downloadUrl = job.signed_url;
        response.urlExpiresAt = job.signed_url_expires_at;
      } else {
        // Regenerate expired URL
        const newExpiresAt = new Date(Date.now() + SIGNED_URL_EXPIRY_MS).toISOString();
        const token = crypto
          .createHmac('sha256', process.env.ENCRYPTION_KEY || 'dev-secret')
          .update(`${jobId}:${newExpiresAt}`)
          .digest('hex');
        const signedUrl = `/donations/export/${jobId}/download?token=${token}&expires=${encodeURIComponent(
          newExpiresAt
        )}`;

        await Database.run(
          `UPDATE donation_exports 
           SET signed_url = ?, signed_url_expires_at = ?, updated_at = ? 
           WHERE export_id = ?`,
          [signedUrl, newExpiresAt, new Date().toISOString(), jobId]
        );

        response.downloadUrl = signedUrl;
        response.urlExpiresAt = newExpiresAt;
      }
    }

    return response;
  }

  /**
   * Verify signed download URL and return file path.
   * @param {string} jobId - Export job ID
   * @param {string} token - HMAC token
   * @param {string} expires - Expiry timestamp
   * @returns {Promise<{filePath: string, format: string}>}
   */
  static async verifyAndGetDownload(jobId, token, expires) {
    // Verify expiry
    const expiresAt = new Date(expires);
    if (expiresAt <= new Date()) {
      throw new ValidationError('Download URL has expired', null, ERROR_CODES.INVALID_REQUEST);
    }

    // Verify token
    const expectedToken = crypto
      .createHmac('sha256', process.env.ENCRYPTION_KEY || 'dev-secret')
      .update(`${jobId}:${expires}`)
      .digest('hex');

    if (token !== expectedToken) {
      throw new ValidationError('Invalid download token', null, ERROR_CODES.INVALID_REQUEST);
    }

    // Get job
    const job = await Database.get(
      'SELECT * FROM donation_exports WHERE export_id = ?',
      [jobId]
    );

    if (!job) {
      throw new NotFoundError('Export job not found', ERROR_CODES.NOT_FOUND);
    }

    if (job.status !== EXPORT_STATUS.COMPLETED) {
      throw new ValidationError('Export is not completed', null, ERROR_CODES.INVALID_REQUEST);
    }

    if (!job.file_path) {
      throw new NotFoundError('Export file not found', ERROR_CODES.NOT_FOUND);
    }

    return {
      filePath: job.file_path,
      format: job.format,
    };
  }

  /**
   * Delete expired export jobs and files.
   * @returns {Promise<number>} Number of deleted jobs
   */
  static async deleteExpiredExports() {
    const cutoffDate = new Date(Date.now() - EXPORT_RETENTION_MS).toISOString();

    // Get expired jobs
    const expiredJobs = await Database.all(
      'SELECT export_id, file_path FROM donation_exports WHERE created_at < ?',
      [cutoffDate]
    );

    let deletedCount = 0;

    for (const job of expiredJobs) {
      try {
        // Delete file if exists
        if (job.file_path) {
          await fs.unlink(job.file_path).catch(() => {
            // Ignore if file doesn't exist
          });
        }

        // Delete database record
        await Database.run('DELETE FROM donation_exports WHERE export_id = ?', [
          job.export_id,
        ]);

        deletedCount++;
      } catch (err) {
        log.error('DONATION_EXPORT_SERVICE', 'Failed to delete expired export', {
          jobId: job.export_id,
          error: err.message,
        });
      }
    }

    if (deletedCount > 0) {
      log.info('DONATION_EXPORT_SERVICE', 'Deleted expired exports', {
        count: deletedCount,
      });
    }

    return deletedCount;
  }
}

module.exports = DonationExportService;
