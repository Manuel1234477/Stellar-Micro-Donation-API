/**
 * Bulk Wallet Import Service
 *
 * RESPONSIBILITY: Parse CSV/JSON files, asynchronously process bulk imports with
 *                 validation, deduplication, batching, progress reporting, and webhooks.
 * OWNER: Backend Team
 * DEPENDENCIES: Wallet model, csv-parse, stellar-sdk, WebhookService
 */

'use strict';

const { parse } = require('csv-parse/sync');
const StellarSdk = require('stellar-sdk');
const crypto = require('crypto');
const Wallet = require('../models/wallet');
const log = require('../utils/log');

const DEFAULT_MAX_ROWS = 1000;
const DEFAULT_BATCH_SIZE = 50;

/** In-memory store for bulk import jobs: jobId -> job */
const _jobs = new Map();

/**
 * Parse a Buffer/string as JSON, returning an array of wallet objects.
 * @param {Buffer} buffer
 * @returns {Object[]}
 */
function parseJSON(buffer) {
  const parsed = JSON.parse(buffer.toString('utf8'));
  if (!Array.isArray(parsed)) throw new Error('JSON body must be an array');
  return parsed;
}

/**
 * Parse a Buffer/string as CSV, returning an array of wallet objects.
 * Supports header aliases: public_key, address, publickey.
 * @param {Buffer} buffer
 * @returns {Object[]}
 */
function parseCSV(buffer) {
  const records = parse(buffer, { columns: true, skip_empty_lines: true, trim: true });
  return records.map(r => {
    const pk = r.public_key || r.address || r.publicKey || r.publickey || '';
    const label = r.label || null;
    const ownerName = r.owner_name || r.ownerName || r.owner || null;
    return {
      ...r,
      public_key: pk,
      address: pk,
      label,
      owner_name: ownerName,
      ownerName,
    };
  });
}

/**
 * Validate a single wallet row.
 * @param {Object} row
 * @returns {{ valid: true, publicKey: string } | { valid: false, reason: string, publicKey: string }}
 */
function validateRow(row) {
  const pk = row.public_key || row.address || row.publicKey || '';

  if (row.secret_key !== undefined || row.private_key !== undefined || row.secretKey !== undefined) {
    return { valid: false, reason: 'private_key_not_accepted', publicKey: pk };
  }
  if (!pk || typeof pk !== 'string' || !pk.trim()) {
    return { valid: false, reason: 'missing_public_key', publicKey: pk };
  }
  const cleanKey = pk.trim();
  if (!StellarSdk.StrKey.isValidEd25519PublicKey(cleanKey)) {
    return { valid: false, reason: 'invalid_address', publicKey: cleanKey };
  }
  return { valid: true, publicKey: cleanKey };
}

class BulkWalletImportService {
  constructor() {
    this.jobs = _jobs;
  }

  /**
   * Parse file buffer into an array of wallet objects.
   *
   * @param {Buffer} buffer - Raw file content.
   * @param {'application/json'|'text/csv'|string} mimeType - Content type of the file.
   * @returns {Object[]} Parsed rows.
   * @throws {Error} If the format is unsupported or parsing fails.
   */
  parseFile(buffer, mimeType) {
    if (mimeType === 'application/json' || mimeType === 'json') {
      return parseJSON(buffer);
    }
    if (mimeType === 'text/csv' || mimeType === 'csv' || mimeType?.includes('csv') || mimeType?.includes('text/plain')) {
      return parseCSV(buffer);
    }
    throw new Error(`Unsupported file type: ${mimeType}`);
  }

  /**
   * Create and start an asynchronous bulk wallet import job.
   *
   * @param {Object} params
   * @param {Object[]} params.rows - Parsed wallet rows
   * @param {number} [params.batchSize] - Chunk size for DB operations
   * @param {string} [params.apiKeyId] - Optional actor attribution
   * @returns {Object} Initial job metadata { jobId, status, total, createdAt }
   */
  createJob({ rows = [], batchSize = DEFAULT_BATCH_SIZE, apiKeyId = null } = {}) {
    const maxRows = parseInt(process.env.BULK_IMPORT_MAX_ROWS || DEFAULT_MAX_ROWS, 10);
    if (rows.length > maxRows) {
      const err = new Error(`File exceeds maximum row limit of ${maxRows}`);
      err.code = 'ROW_LIMIT_EXCEEDED';
      err.limit = maxRows;
      throw err;
    }

    const jobId = crypto.randomUUID ? crypto.randomUUID() : `import_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const effectiveBatchSize = Math.max(1, parseInt(batchSize || DEFAULT_BATCH_SIZE, 10) || DEFAULT_BATCH_SIZE);

    const job = {
      jobId,
      status: 'processing',
      total: rows.length,
      processed: 0,
      succeeded: 0,
      failed: 0,
      errors: [],
      createdAt: new Date().toISOString(),
      completedAt: null,
      batchSize: effectiveBatchSize,
      apiKeyId,
    };

    this.jobs.set(jobId, job);

    // Process asynchronously in background
    setImmediate(async () => {
      await this._processJob(jobId, rows, effectiveBatchSize);
    });

    return {
      jobId,
      status: job.status,
      total: job.total,
      createdAt: job.createdAt,
    };
  }

  /**
   * Process a queued job in configurable batch sizes with deduplication and validation.
   * @private
   */
  async _processJob(jobId, rows, batchSize) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    const seenInJob = new Set();

    for (let offset = 0; offset < rows.length; offset += batchSize) {
      const batch = rows.slice(offset, offset + batchSize);

      for (let i = 0; i < batch.length; i++) {
        const row = batch[i];
        const rowNumber = offset + i + 1;
        const validation = validateRow(row);

        if (!validation.valid) {
          job.failed++;
          job.processed++;
          job.errors.push({
            row: rowNumber,
            public_key: validation.publicKey,
            reason: validation.reason,
          });
          continue;
        }

        const pk = validation.publicKey;

        // 1. Intra-file duplicate check
        if (seenInJob.has(pk)) {
          job.failed++;
          job.processed++;
          job.errors.push({
            row: rowNumber,
            public_key: pk,
            reason: 'duplicate_in_file',
          });
          continue;
        }
        seenInJob.add(pk);

        // 2. Database deduplication check
        const existingWallet = Wallet.getByAddress(pk);
        if (existingWallet) {
          job.failed++;
          job.processed++;
          job.errors.push({
            row: rowNumber,
            public_key: pk,
            reason: 'duplicate_in_db',
          });
          continue;
        }

        // 3. Create wallet
        try {
          Wallet.create({
            address: pk,
            label: row.label || null,
            ownerName: row.owner_name || row.ownerName || null,
          });
          job.succeeded++;
          job.processed++;
        } catch (createErr) {
          job.failed++;
          job.processed++;
          job.errors.push({
            row: rowNumber,
            public_key: pk,
            reason: createErr.message || 'creation_failed',
          });
        }
      }

      // Small tick between batches to prevent event loop starvation
      await new Promise(r => setImmediate(r));
    }

    job.status = 'completed';
    job.completedAt = new Date().toISOString();

    log.info('BULK_WALLET_IMPORT', 'Bulk import job completed', {
      jobId,
      total: job.total,
      processed: job.processed,
      succeeded: job.succeeded,
      failed: job.failed,
      errorsCount: job.errors.length,
    });

    // Fire webhook event wallets.bulk_import_complete
    try {
      const WebhookService = require('./WebhookService');
      const webhookService = new WebhookService();
      await webhookService.deliver('wallets.bulk_import_complete', {
        jobId: job.jobId,
        total: job.total,
        processed: job.processed,
        succeeded: job.succeeded,
        failed: job.failed,
        errors: job.errors,
        completedAt: job.completedAt,
      });
    } catch (webhookErr) {
      log.warn('BULK_WALLET_IMPORT', 'Webhook delivery failed or skipped', { error: webhookErr.message });
    }
  }

  /**
   * Get the status and progress of an import job.
   * @param {string} jobId
   * @returns {Object|null}
   */
  getJob(jobId) {
    return this.jobs.get(jobId) || null;
  }

  /**
   * Synchronous import with atomic rollback (legacy support for unit tests).
   *
   * @param {Object[]} rows - Array of wallet objects.
   * @returns {{ totalSubmitted: number, totalCreated: number, details: Array<{ row: number, public_key: string, status: string, reason?: string }> }}
   */
  importRows(rows) {
    const maxRows = parseInt(process.env.BULK_IMPORT_MAX_ROWS || DEFAULT_MAX_ROWS, 10);

    if (rows.length > maxRows) {
      const err = new Error(`File exceeds maximum row limit of ${maxRows}`);
      err.code = 'ROW_LIMIT_EXCEEDED';
      err.limit = maxRows;
      throw err;
    }

    const seen = new Set();
    const validationErrors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const result = validateRow(row);
      if (!result.valid) {
        validationErrors.push({ row: i + 1, public_key: result.publicKey || '', reason: result.reason });
        continue;
      }
      if (seen.has(result.publicKey)) {
        validationErrors.push({ row: i + 1, public_key: result.publicKey, reason: 'duplicate_in_file' });
        continue;
      }
      seen.add(result.publicKey);
    }

    if (validationErrors.length > 0) {
      const err = new Error('Validation failed: one or more rows are invalid');
      err.code = 'VALIDATION_FAILED';
      err.details = validationErrors;
      throw err;
    }

    const snapshot = Wallet.loadWallets();
    const details = [];
    const created = [];

    try {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const pk = row.public_key || row.address || row.publicKey;
        const wallet = Wallet.create({
          address: pk,
          label: row.label || null,
          ownerName: row.owner_name || row.ownerName || null,
        });
        created.push(wallet);
        details.push({ row: i + 1, public_key: pk, status: 'created', id: wallet.id });
      }
    } catch (insertErr) {
      Wallet.saveWallets(snapshot);
      const err = new Error(`Insert failed, transaction rolled back: ${insertErr.message}`);
      err.code = 'INSERT_FAILED';
      throw err;
    }

    return {
      totalSubmitted: rows.length,
      totalCreated: created.length,
      details,
    };
  }

  /**
   * Parse a file buffer and import wallets atomically.
   *
   * @param {Buffer} buffer - Raw file content.
   * @param {'application/json'|'text/csv'} mimeType - Content type.
   * @returns {{ totalSubmitted: number, totalCreated: number, details: Object[] }}
   */
  importFile(buffer, mimeType) {
    const rows = this.parseFile(buffer, mimeType);
    return this.importRows(rows);
  }
}

module.exports = BulkWalletImportService;
