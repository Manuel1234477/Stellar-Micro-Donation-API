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
const { serialize: csvSerialize } = require('../utils/csvSerializer');

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
   * Process an export job in the background with streaming to prevent OOM.
   * Rows are processed in configurable batches (default: 500) and written incrementally.
   * @param {string} jobId - Export job ID
   */
  static async processExportJob(jobId) {
    const BATCH_SIZE = parseInt(process.env.EXPORT_BATCH_SIZE || '500', 10);

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

      // Prepare file path
      const fileName = `${jobId}.${job.format}`;
      const filePath = path.join(EXPORT_DIR, fileName);

      // Build SQL query with filters
      const { sql, params } = this.buildQuerySQL({
        startDate: job.start_date,
        endDate: job.end_date,
        status: job.status_filter,
        senderPublicKey: job.sender_public_key,
        recipientPublicKey: job.recipient_public_key,
      });

      let rowCount = 0;
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
      const isCsv = job.format === EXPORT_FORMAT.CSV;
      let buffer = '';
      let firstRow = true;

      // Initialize file with opening bracket for JSON
      if (!isCsv) {
        buffer = '[\n';
      } else {
        buffer = headers.join(',') + '\n';
      }

      // Stream rows one at a time using Database.each
      await Database.each(sql, params, (row) => {
        const formattedRow = {
          id: row.id,
          amount: row.amount,
          senderPublicKey: row.senderPublicKey,
          recipientPublicKey: row.recipientPublicKey,
          memo: row.memo,
          status: row.status,
          timestamp: row.timestamp,
          transactionHash: row.transactionHash,
        };

        if (isCsv) {
          const csvLine = this.serializeCSVRow(formattedRow, headers);
          buffer += csvLine + '\n';
        } else {
          if (!firstRow) {
            buffer += ',\n';
          }
          buffer += JSON.stringify(formattedRow);
          firstRow = false;
        }

        rowCount++;

        // Flush buffer when it reaches a threshold to keep memory bounded
        if (buffer.length > 1024 * 1024) { // 1MB
          fs.appendFileSync(filePath, buffer);
          buffer = '';
        }

        // Log progress every BATCH_SIZE rows
        if (rowCount % BATCH_SIZE === 0) {
          log.debug('DONATION_EXPORT_SERVICE', 'Export progress', {
            jobId,
            processedRows: rowCount,
          });
        }
      });

      // Close JSON array and flush remaining buffer
      if (!isCsv) {
        buffer += '\n]';
      }

      await fs.writeFile(filePath, buffer, { flag: 'a' });

      // Generate signed URL
      const expiresAt = new Date(Date.now() + SIGNED_URL_EXPIRY_MS).toISOString();
      const signedUrl = this.generateSignedUrl(jobId, expiresAt);

      // Update job as completed
      await Database.run(
        `UPDATE donation_exports
         SET status = ?, record_count = ?, file_path = ?, signed_url = ?,
             signed_url_expires_at = ?, updated_at = ?
         WHERE export_id = ?`,
        [
          EXPORT_STATUS.COMPLETED,
          rowCount,
          filePath,
          signedUrl,
          expiresAt,
          new Date().toISOString(),
          jobId,
        ]
      );

      log.info('DONATION_EXPORT_SERVICE', 'Export job completed', {
        jobId,
        recordCount: rowCount,
      });

      // Schedule deletion of export file after SIGNED_URL_EXPIRY_MS
      const cleanupTimer = setTimeout(() => {
        fs.unlink(filePath).catch(() => {});
      }, SIGNED_URL_EXPIRY_MS);
      if (cleanupTimer.unref) {
        cleanupTimer.unref();
      }

      // Fire webhook event: export.ready
      try {
        const WebhookService = require('./WebhookService');
        const webhookService = new WebhookService();
        await webhookService.deliver('export.ready', {
          jobId,
          status: 'ready',
          format: job.format,
          recordCount: rowCount,
          downloadUrl: signedUrl,
          urlExpiresAt: expiresAt,
        });
      } catch (webhookErr) {
        log.warn('DONATION_EXPORT_SERVICE', 'Webhook delivery failed for export.ready', {
          jobId,
          error: webhookErr.message,
        });
      }

      // Send email notification if SMTP is configured
      if (process.env.SMTP_HOST || process.env.SMTP_USER) {
        try {
          const nodemailer = require('nodemailer');
          const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'localhost',
            port: parseInt(process.env.SMTP_PORT || '587', 10),
            secure: process.env.SMTP_SECURE === 'true',
            auth: process.env.SMTP_USER
              ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
              : undefined,
          });

          const toEmail = job.email || process.env.NOTIFICATION_EMAIL || process.env.SMTP_TO || 'admin@stellar-donations.local';
          await transporter.sendMail({
            from: process.env.SMTP_FROM || 'exports@stellar-donations.local',
            to: toEmail,
            subject: `Donation Export Ready — ${jobId}`,
            text: [
              `Your requested donation export is ready.`,
              ``,
              `Job ID: ${jobId}`,
              `Records: ${rowCount}`,
              `Format: ${job.format.toUpperCase()}`,
              `Download URL: ${signedUrl}`,
              `URL Expires At: ${expiresAt}`,
              ``,
              `Please download your file before expiration.`,
            ].join('\n'),
          });
        } catch (emailErr) {
          log.warn('DONATION_EXPORT_SERVICE', 'Failed to send export completion email', {
            jobId,
            error: emailErr.message,
          });
        }
      }
    } catch (err) {
      log.error('DONATION_EXPORT_SERVICE', 'Export job failed', {
        jobId,
        error: err.message,
      });

      await this.updateExportStatus(jobId, EXPORT_STATUS.FAILED, err.message);
      throw err;
    }
  }

  /**
   * Update the status of an export job.
   * @param {string} jobId - Export job ID
   * @param {string} status - New status
   * @param {string} [errorMessage] - Optional error message
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
   * Get the status of an export job.
   * @param {string} jobId - Export job ID
   * @param {string} apiKeyId - API key / user ID for ownership check
   * @returns {Promise<Object>} Job status details
   */
  static async getExportStatus(jobId, apiKeyId) {
    const job = await Database.get(
      'SELECT * FROM donation_exports WHERE export_id = ? AND api_key_id = ?',
      [jobId, apiKeyId]
    );

    if (!job) {
      throw new NotFoundError('Export job not found', ERROR_CODES.NOT_FOUND);
    }

    return {
      jobId: job.export_id,
      status: job.status,
      format: job.format,
      recordCount: job.record_count,
      errorMessage: job.error_message,
      signedUrl: job.signed_url,
      signedUrlExpiresAt: job.signed_url_expires_at,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
    };
  }

  /**
   * Build SQL query with filters for donation export.
   * @param {Object} filters - Filter options
   * @returns {{sql: string, params: Array}}
   */
  static buildQuerySQL(filters = {}) {
    const conditions = [];
    const params = [];

    if (filters.startDate) {
      conditions.push('timestamp >= ?');
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      conditions.push('timestamp <= ?');
      params.push(filters.endDate);
    }
    if (filters.status) {
      conditions.push('status = ?');
      params.push(filters.status);
    }
    if (filters.senderPublicKey) {
      conditions.push('senderPublicKey = ?');
      params.push(filters.senderPublicKey);
    }
    if (filters.recipientPublicKey) {
      conditions.push('recipientPublicKey = ?');
      params.push(filters.recipientPublicKey);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT id, amount, senderPublicKey, recipientPublicKey, memo, status, timestamp, transactionHash FROM transactions ${where} ORDER BY timestamp ASC`;

    return { sql, params };
  }

  /**
   * Serialize a single row to CSV using the shared csvSerializer.
   * @param {Object} row - Row data
   * @param {Array<string>} headers - Column headers
   * @returns {string} CSV line
   */
  static serializeCSVRow(row, headers) {
    return csvSerialize([row], headers).trim();
  }

  /**
   * Generate a signed URL for downloading an export file.
   * @param {string} jobId - Export job ID
   * @param {string} expiresAt - ISO expiry timestamp
   * @returns {string} Signed URL
   */
  static generateSignedUrl(jobId, expiresAt) {
    const secret = process.env.EXPORT_SIGNING_SECRET || 'export-signing-secret';
    const signature = crypto
      .createHmac('sha256', secret)
      .update(`${jobId}:${expiresAt}`)
      .digest('hex');
    return `/donations/export/${jobId}/download?expires=${encodeURIComponent(expiresAt)}&signature=${signature}`;
  }

  /**
   * Verify a signed download URL.
   * @param {string} jobId - Export job ID
   * @param {string} expiresAt - ISO expiry timestamp
   * @param {string} signature - Provided signature
   * @returns {boolean} True if valid and not expired
   */
  static verifySignedUrl(jobId, expiresAt, signature) {
    if (!expiresAt || !signature) {
      return false;
    }
    if (new Date(expiresAt).getTime() < Date.now()) {
      return false;
    }
    const secret = process.env.EXPORT_SIGNING_SECRET || 'export-signing-secret';
    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${jobId}:${expiresAt}`)
      .digest('hex');
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(signature)
    );
  }

  /**
   * Clean up expired export files and records.
   * @returns {Promise<number>} Number of records cleaned up
   */
  static async cleanupExpiredExports() {
    const cutoff = new Date(Date.now() - EXPORT_RETENTION_MS).toISOString();
    const expired = await Database.all(
      'SELECT export_id, file_path FROM donation_exports WHERE created_at < ?',
      [cutoff]
    );

    for (const job of expired) {
      if (job.file_path) {
        try {
          await fs.unlink(job.file_path);
        } catch (err) {
          if (err.code !== 'ENOENT') {
            log.warn('DONATION_EXPORT_SERVICE', 'Failed to delete export file', {
              jobId: job.export_id,
              error: err.message,
            });
          }
        }
      }
    }

    await Database.run('DELETE FROM donation_exports WHERE created_at < ?', [cutoff]);
    return expired.length;
  }
}

module.exports = DonationExportService;
module.exports.EXPORT_STATUS = EXPORT_STATUS;
module.exports.EXPORT_FORMAT = EXPORT_FORMAT;
