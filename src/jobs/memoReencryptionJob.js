'use strict';

/**
 * MemoReencryptionJob - Background Re-encryption of Memos After Key Rotation
 *
 * RESPONSIBILITY: Gradually re-encrypt memos from old key versions to the
 *                 current active key version without service interruption.
 * OWNER: Security Team
 * DEPENDENCIES: MemoEncryptionService, memoKeyManager, Database, timerRegistry
 *
 * Design:
 *  - Runs as a low-priority background job on a configurable interval
 *  - Processes memos in small batches to avoid locking the database
 *  - Tracks progress via in-memory counters and DB status column
 *  - Skips memos already at the active version
 *  - Stops automatically when all memos are migrated
 *  - Exposes getStatus() for admin visibility
 *
 * Usage (from server bootstrap or scheduler):
 *   const job = new MemoReencryptionJob({ recipientSecrets: { 'GABC...': 'SABC...' } });
 *   job.start();
 *   // Later...
 *   job.stop();
 */

const Database = require('../utils/database');
const memoKeyManager = require('../utils/memoKeyManager');
const MemoEncryptionService = require('../services/MemoEncryptionService');
const log = require('../utils/log');
const timerRegistry = require('../utils/timerRegistry');

const DEFAULT_BATCH_SIZE = parseInt(process.env.MEMO_REENCRYPT_BATCH_SIZE, 10) || 50;
const DEFAULT_INTERVAL_MS = parseInt(process.env.MEMO_REENCRYPT_INTERVAL_MS, 10) || 30_000; // 30 seconds

class MemoReencryptionJob {
  /**
   * @param {Object} options
   * @param {Object} options.recipientSecrets - Map of { publicKey: secretKey } for decryption
   * @param {number} options.batchSize - Memos to process per tick (default: 50)
   * @param {number} options.intervalMs - Milliseconds between ticks (default: 30000)
   */
  constructor(options = {}) {
    this.recipientSecrets = options.recipientSecrets || this._loadSecretsFromEnv();
    this.batchSize = options.batchSize || DEFAULT_BATCH_SIZE;
    this.intervalMs = options.intervalMs || DEFAULT_INTERVAL_MS;

    this.isRunning = false;
    this.intervalId = null;

    this.stats = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      startedAt: null,
      lastBatchAt: null,
      lastError: null,
    };
  }

  /**
   * Load recipient secrets from RECIPIENT_SECRETS env var (JSON map).
   * @private
   */
  _loadSecretsFromEnv() {
    if (!process.env.RECIPIENT_SECRETS) return {};
    try {
      return JSON.parse(process.env.RECIPIENT_SECRETS);
    } catch {
      log.warn('MEMO_REENCRYPT_JOB', 'Failed to parse RECIPIENT_SECRETS env var; no secrets loaded');
      return {};
    }
  }

  /**
   * Start the background re-encryption job.
   * Runs one batch immediately, then repeats at intervalMs.
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.stats.startedAt = new Date().toISOString();

    log.info('MEMO_REENCRYPT_JOB', 'Starting memo re-encryption background job', {
      batchSize: this.batchSize,
      intervalMs: this.intervalMs,
    });

    // Run immediately, then on each interval tick
    this._processBatch().catch(err => {
      log.error('MEMO_REENCRYPT_JOB', 'Error in first batch', { error: err.message });
    });

    this.intervalId = timerRegistry.createInterval(
      () => this._processBatch().catch(err => {
        log.error('MEMO_REENCRYPT_JOB', 'Error in batch tick', { error: err.message });
      }),
      this.intervalMs,
      'memo-reencryption-job'
    );

    // Don't hold the process open
    if (this.intervalId && this.intervalId.unref) {
      this.intervalId.unref();
    }
  }

  /**
   * Stop the background job.
   */
  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.intervalId) {
      if (this.intervalId.cancel) {
        this.intervalId.cancel();
      } else if (typeof clearInterval === 'function') {
        clearInterval(this.intervalId);
      }
      this.intervalId = null;
    }

    log.info('MEMO_REENCRYPT_JOB', 'Memo re-encryption job stopped', {
      stats: this.stats,
    });
  }

  /**
   * Process one batch of memos that need re-encryption.
   * @private
   */
  async _processBatch() {
    if (!this.isRunning) return;

    const activeVersion = memoKeyManager.getActiveKeyVersion();

    // Find memos NOT at the active version — versioned ciphertext starts with "v<n>:"
    // We identify old-version memos by their memoEnvelope prefix NOT matching the active version
    let rows;
    try {
      rows = await Database.query(
        `SELECT id, donor, recipient, data
         FROM donations_store
         WHERE deleted_at IS NULL
           AND data IS NOT NULL
           AND json_extract(data, '$.memoEnvelope') IS NOT NULL
           AND json_extract(data, '$.encryptionMetadata') IS NOT NULL
           AND CAST(json_extract(data, '$.encryptionMetadata.keyVersion') AS INTEGER) != ?
         LIMIT ?`,
        [activeVersion, this.batchSize]
      );
    } catch (err) {
      // If donations_store doesn't exist yet or FTS fails gracefully
      log.debug('MEMO_REENCRYPT_JOB', 'Could not query donations_store', { error: err.message });
      this.stop();
      return;
    }

    if (!rows || rows.length === 0) {
      log.info('MEMO_REENCRYPT_JOB', 'No more memos to re-encrypt; stopping job', {
        stats: this.stats,
        activeVersion,
      });
      this.stop();
      return;
    }

    this.stats.lastBatchAt = new Date().toISOString();

    for (const row of rows) {
      this.stats.processed++;

      let txData;
      try {
        txData = JSON.parse(row.data);
      } catch {
        this.stats.skipped++;
        continue;
      }

      const memoEnvelope = txData.memoEnvelope;
      if (!memoEnvelope || typeof memoEnvelope !== 'string' || !/^v\d+:/.test(memoEnvelope)) {
        this.stats.skipped++;
        continue;
      }

      // Look up the recipient secret key for decryption
      const recipientPublicKey = row.recipient || txData.recipient;
      const recipientSecret = recipientPublicKey ? this.recipientSecrets[recipientPublicKey] : null;

      if (!recipientSecret) {
        log.debug('MEMO_REENCRYPT_JOB', 'No secret available for recipient; skipping', {
          id: row.id,
          recipient: recipientPublicKey ? recipientPublicKey.slice(0, 8) + '...' : 'unknown',
        });
        this.stats.skipped++;
        continue;
      }

      try {
        // Decrypt with old key version
        const plaintext = MemoEncryptionService.decryptMemoForRecipient(memoEnvelope, recipientSecret);

        // Re-encrypt with the current active version
        const encryptionResult = MemoEncryptionService.encryptMemoForRecipient(
          plaintext,
          recipientPublicKey
        );

        // Patch just the encryption fields in the JSON data
        const updatedData = {
          ...txData,
          memoEnvelope: encryptionResult.memoEnvelope,
          memoHash: encryptionResult.memoHash,
          encryptionMetadata: encryptionResult.encryptionMetadata,
        };

        await Database.run(
          `UPDATE donations_store SET data = ?, status_updated_at = ? WHERE id = ?`,
          [JSON.stringify(updatedData), new Date().toISOString(), row.id]
        );

        this.stats.succeeded++;
        log.debug('MEMO_REENCRYPT_JOB', 'Memo re-encrypted', {
          id: row.id,
          oldVersion: txData.encryptionMetadata?.keyVersion,
          newVersion: activeVersion,
        });
      } catch (err) {
        this.stats.failed++;
        this.stats.lastError = err.message;
        log.warn('MEMO_REENCRYPT_JOB', 'Failed to re-encrypt memo', {
          id: row.id,
          error: err.message,
        });
      }
    }

    log.info('MEMO_REENCRYPT_JOB', 'Batch complete', {
      batchSize: rows.length,
      succeeded: this.stats.succeeded,
      failed: this.stats.failed,
      skipped: this.stats.skipped,
    });
  }

  /**
   * Get current job status for admin visibility.
   * @returns {Object}
   */
  getStatus() {
    const activeVersion = memoKeyManager.getActiveKeyVersion();
    return {
      isRunning: this.isRunning,
      batchSize: this.batchSize,
      intervalMs: this.intervalMs,
      activeKeyVersion: activeVersion,
      stats: { ...this.stats },
    };
  }

  /**
   * Run a single manual batch (e.g. for admin-triggered re-encryption).
   * Does not start the background interval.
   * @returns {Promise<Object>} batch statistics
   */
  async runOnce() {
    const before = { ...this.stats };
    this.isRunning = true;
    await this._processBatch();
    this.isRunning = false;
    return {
      processed: this.stats.processed - before.processed,
      succeeded: this.stats.succeeded - before.succeeded,
      failed: this.stats.failed - before.failed,
      skipped: this.stats.skipped - before.skipped,
    };
  }
}

module.exports = MemoReencryptionJob;
