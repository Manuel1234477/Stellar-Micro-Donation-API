/**
 * Recurring Donation Scheduler - Background Service
 *
 * RESPONSIBILITY: Automated execution of scheduled recurring donations
 * OWNER: Backend Team
 * DEPENDENCIES: StellarService, Database, WebhookService, correlation utilities
 *
 * Background service that processes recurring donation schedules at regular intervals.
 * Features:
 *  - Cron-like scheduling (daily / weekly / monthly / custom interval in days)
 *  - Retry logic with exponential backoff (max 3 retries per cycle)
 *  - Duplicate-execution prevention via in-memory Set
 *  - Webhook notification on persistent failure (all retries exhausted)
 *  - Execution history logging to recurring_donation_logs table
 *  - Correlation ID propagation for distributed tracing
 */

const Database = require('../utils/database');
const WebhookService = require('./WebhookService');
const ApiKeyExpirationNotifier = require('./ApiKeyExpirationNotifier');
const { SCHEDULE_STATUS, DONATION_FREQUENCIES } = require('../constants');
const log = require('../utils/log');
const { revokeExpiredDeprecatedKeys } = require('../models/apiKeys');
const {
  withBackgroundContext,
  withAsyncContext,
  getCorrelationSummary,
} = require('../utils/correlation');

class RecurringDonationScheduler {
  /**
   * @param {Object} stellarService - StellarService or MockStellarService instance
   */
  constructor(stellarService) {
    this.stellarService = stellarService || null;
    this.intervalId = null;
    this.isRunning = false;

    /** How often the scheduler polls for due donations (ms) */
    this.checkInterval = 60_000; // 1 minute

    // Backup configuration (default: daily)
    this.backupInterval = parseInt(process.env.BACKUP_INTERVAL_MS, 10) || 24 * 60 * 60 * 1000;
    this.lastBackupAt = 0;

    // Retry configuration
    this.maxRetries = 3;
    this.initialBackoffMs = 1_000;  // 1 second
    this.maxBackoffMs = 30_000;     // 30 seconds
    this.backoffMultiplier = 2;

    /** In-progress schedule IDs – prevents concurrent duplicate execution */
    this.executingSchedules = new Set();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Start the scheduler.
   * Runs immediately on start, then at every checkInterval.
   * @returns {void}
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    // Run immediately, then on each interval tick
    this.processSchedules();
    this.intervalId = setInterval(() => this.processSchedules(), this.checkInterval);

    this.intervalId = setInterval(() => {
      this.processSchedules();
    }, this.checkInterval);

    const correlation = getCorrelationSummary();
    log.info("RECURRING_SCHEDULER", "Scheduler started", {
      checkIntervalSeconds: this.checkInterval / 1000,
      correlationId: correlation.correlationId,
      traceId: correlation.traceId,
    });
  }

  /**
   * Stop the scheduler.
   * ntly executing donations.
   * @returns {void}
   */
  stop() {
    if (!this.isRunning) return;

    return withBackgroundContext('scheduler_stop', () => {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.isRunning = false;

      const { correlationId, traceId } = getCorrelationSummary();
      log.info('RECURRING_SCHEDULER', 'Scheduler stopped', { correlationId, traceId });
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Core processing
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Query the database for all active schedules that are due and execute them.
   * @returns {Promise<void>}
   */
  async processSchedules() {
    if (!this.isRunning) return;

    return withBackgroundContext('process_schedules', async () => {
      const { correlationId, traceId } = getCorrelationSummary();
      try {
        const now = new Date().toISOString();

        const dueSchedules = await Database.query(
          `SELECT
            rd.id,
            rd.donorId,
            rd.recipientId,
            rd.amount,
            rd.frequency,
            rd.customIntervalDays,
            rd.maxExecutions,
            rd.webhookUrl,
            rd.failureCount,
            rd.nextExecutionDate,
            rd.executionCount,
            rd.lastExecutionDate,
            donor.publicKey  AS donorPublicKey,
            recipient.publicKey AS recipientPublicKey
           FROM recurring_donations rd
           JOIN users donor     ON rd.donorId    = donor.id
           JOIN users recipient ON rd.recipientId = recipient.id
           WHERE rd.status = ?
             AND rd.nextExecutionDate <= ?`,
          [SCHEDULE_STATUS.ACTIVE, now]
        );

        if (dueSchedules.length > 0) {
          log.info('RECURRING_SCHEDULER', 'Found due schedules', {
            count: dueSchedules.length,
            correlationId,
            traceId,
          });
    if (!this.isRunning) {
      return;
    }

    const correlation = getCorrelationSummary();

    try {
      const now = new Date().toISOString();

      const dueSchedules = await Database.query(
        `SELECT
          rd.id,
          rd.donorId,
          rd.recipientId,
          rd.amount,
          rd.frequency,
          rd.nextExecutionDate,
          rd.executionCount,
          rd.lastExecutionDate,
          donor.publicKey as donorPublicKey,
          recipient.publicKey as recipientPublicKey
         FROM recurring_donations rd
         JOIN users donor ON rd.donorId = donor.id
         JOIN users recipient ON rd.recipientId = recipient.id
         WHERE rd.status = ?
         AND rd.nextExecutionDate <= ?`,
        [SCHEDULE_STATUS.ACTIVE, now]
      );

      if (dueSchedules.length > 0) {
        log.info("RECURRING_SCHEDULER", "Found due schedules for execution", {
          count: dueSchedules.length,
          correlationId: correlation.correlationId,
          traceId: correlation.traceId,
        });
      }

      const promises = dueSchedules
        .filter((schedule) => !this.executingSchedules.has(schedule.id))
        .map((schedule) => this.executeScheduleWithRetry(schedule));

      await Promise.allSettled(promises);

      // Auto-revoke deprecated API keys whose grace period has elapsed
      try {
        const revokedCount = await revokeExpiredDeprecatedKeys();
        if (revokedCount > 0) {
          log.info('RECURRING_SCHEDULER', 'Auto-revoked expired deprecated API keys', { revokedCount });
        }
      } catch (revokeError) {
        log.error('RECURRING_SCHEDULER', 'Failed to auto-revoke expired API keys', { error: revokeError.message });
      }

      // Send expiry notifications for keys approaching or past their expiration date
      try {
        await ApiKeyExpirationNotifier.run();
      } catch (notifyError) {
        log.error('RECURRING_SCHEDULER', 'API key expiry notification job failed', { error: notifyError.message });
      }

      // Run data retention job once per cleanupInterval
      const now2 = Date.now();
      if (now2 - this.lastCleanupAt >= this.cleanupInterval) {
        this.lastCleanupAt = now2;
        try {
          const retentionService = require('./RetentionService');
          await retentionService.runAll();
        } catch (retentionError) {
          log.error('RECURRING_SCHEDULER', 'Retention job failed', { error: retentionError.message });
        }
      }

      // Run scheduled database backup once per backupInterval
      if (now2 - this.lastBackupAt >= this.backupInterval) {
        this.lastBackupAt = now2;
        try {
          const BackupService = require('./BackupService');
          const backupService = new BackupService();
          const result = await backupService.backup();
          log.info('RECURRING_SCHEDULER', 'Scheduled backup completed', { backupId: result.backupId });
        } catch (backupError) {
          log.error('RECURRING_SCHEDULER', 'Scheduled backup failed', { error: backupError.message });
        }
      }
    } catch (error) {
      log.error("RECURRING_SCHEDULER", "Error processing schedules", {
        error: error.message,
        correlationId: correlation.correlationId,
        traceId: correlation.traceId,
      });
      this.logFailure("PROCESS_SCHEDULES", null, error.message);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Retry wrapper
  // ─────────────────────────────────────────────────────

  /**
   * Execute a schedule with up to maxRetries attempts and exponential backoff.
   * Sends a webhook notification if all retries are exhausted.
   *
   * @param {Object} schedule - Schedule row from the database
   * @returns {Promise<void>}
   */
  async executeScheduleWithRetry(schedule) {
    return withAsyncContext(
      'execute_schedule_with_retry',
      async () => {
        if (this.executingSchedules.has(schedule.id)) return;
        this.executingSchedules.add(schedule.id);

        let lastError = null;

        try {
          for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
              await this.executeSchedule(schedule);
              return; // success – exit retry loop
            } catch (err) {
              lastError = err;
              log.warn('RECURRING_SCHEDULER', 'Schedule execution attempt failed', {
                scheduleId: schedule.id,
                attempt,
                maxRetries: this.maxRetries,
                error: err.message,
              });

              if (attempt < this.maxRetries) {
                await this.sleep(this.calculateBackoff(attempt));
              }
            }
          }

          await this.handleFailedExecution(schedule, lastError);
        } finally {
          this.executingSchedules.delete(schedule.id);
        }
      },
      { scheduleId: schedule.id }
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Single executin
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Execute one recurring donation cycle:
   *  1. Send payment via Stellar
   *  2. Record transaction in DB
   *  3. Advance nextExecutionDate
   *  4. Increment executionCount; mark completed if maxExecutions reached
   *  5. Reset failureCount on success
   *
   * @param {Object} schedule - Schedule row
   * @returns {Promise<void>}
   * @throws {Error} on Stellar or DB failure (triggers retry)
   */
  async executeSchedule(schedule) {
    return withAsyncContext('execute_schedule', async () => {
      const { correlationId, traceId } = getCorrelationSummary();

      try {
        // 1. Send payment
        const txResult = await this.stellarService.sendPayment(
          schedule.donorPublicKey,
          schedule.recipientPublicKey,
          schedule.amount,
          `Recurring donation (Schedule #${schedule.id})`
        );

        // 2. Record transaction
        await Database.run(
          `INSERT INTO transactrId, receiverId, amount, memo, timestamp)
           VALUES (?, ?, ?, ?, ?)`,
          [
            schedule.donorId,
            schedule.recipientId,
    return withAsyncContext(
      "execute_schedule",
      async () => {
        try {
          const transactionResult = await this.stellarService.sendPayment(
            schedule.donorPublicKey,
            schedule.recipientPublicKey,
            schedule.amount,
            `Recurring donation (Schedule #${schedule.id})`,
            new Date().toISOString(),
          ]
        );

        // 3. Calculate next execution date
        const nextDate = this.calculateNextExecutionDate(
          new Date(),
          schedule.frequency,
          schedule.customIntervalDays
        );

        const newCount = (schedule.executionCount || 0) + 1;
        const maxReached = schedule.maxExecutions && newCount >= schedule.maxExecutions;
        const newStatus = maxReached ? SCHEDULE_STATUS.COMPLETED : SCHEDULE_STATUS.ACTIVE;

        // 4. Update schedule
        await Database.run(
          `UPDATE recurring_donations
           SET lastExecutionDate = ?,
               nextExecutionDate = ?,
               executionCount    = ?,
               failureCount      = 0,
               lastFailureReason = NULL,
               status            = ?
           WHERE id = ?`,
          [
            new Date().toISOString(),
            nextDate.toISOString(),
            newCount,
            newStatus,
            schedule.id,
          ]
        );

        log.info('RECURRING_SCHEDULER', 'Donation executed successfully', {
          scheduleId: schedule.id,
          txHash: txResult.hash,
          nextExecution: nextDate.toISOString(),
          executionCount: newCount,
          status: newStatus,
          correlationId,
          traceId,
        });

        await this.logExecution(schedule.id, 'SUCCESS', txResult.hash, null, 1);
      } catch (error) {
        await this.logExecution(schedule.id, 'FAILED', null, error.message, 1);
        throw error;
      }
    }, { scheduleId: schedule.id });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Persistent failure handling
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Called when all retry attempts for a schedule have failed.
   * Increments failureCount, persists the last error, and fires a webhook.
   *
   * @param {Object} schedule - Schedule row
   * @param {Error}  error    - Last error from the final retry attempt
   * @returns {Promise<void>}
   */
  async handlePersistentFailure(schedule, error) {
    return withAsyncContext('handle_persistent_failure', async () => {
      const { correlationId, traceId } = getCorrelationSummary();
      const newFailureCount = (schedule.failureCount || 0) + 1;

      log.error('RECURRING_SCHEDULER', 'All retries exhausted for schedule', {
        scheduleId: schedule.id,
        failureCount: newFailureCount,
        error: error.message,
        correlationId,
        traceId,
      });

      // Persist failure info
      try {
        await Database.run(
          `UPDATE recurring_donations
           SET failureCount = ?, lastFailureReason = ?
           WHERE id = ?`,
          [newFailureCount, error.message, schedule.id]
        );
      } catch (dbErr) {
        log.error('RECURRING_SCHEDULER', 'Failed to update failure count', { error: dbErr.message });
      }

      // Log final failure
      await this.logExecution(schedule.id, 'FAILED', null, error.message, this.maxRetries);

      // Send webhook notification if configured
      if (schedule.webhookUrl) {
        const webhookPayload = {
          scheduleId: schedule.id,
          donorPublicKey: schedule.donorPublicKey,
          recipientPublicKey: schedule.recipientPublicKey,
          amount: String(schedule.amount),
          frequency: schedule.frequency,
          errorMessage: error.message,
          failureCount: newFailureCount,
          timestamp: new Date().toISOString(),
        };

        const result = await WebhookService.sendFailureNotification(
          schedule.webhookUrl,
          webhookPayload
        );

        log.info('RECURRING_SCHEDULER', 'Webhook notification result', {
          scheduleId: schedule.id,
          delivered: result.delivered,
          statusCode: result.statusCode,
          error: result.error,
        });
      }
    }, { scheduleId: schedule.id });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Execution logging
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Write an execution record to recurring_donation_logs.
   *
   * @param {number} scheduleId
   * @param {'SUCCESS'|'FAILED'} status
   * @param {string|null} transactionHash
   * @param {string|null} errorMessage
   * @param {number} attemptNumber
   * @returns {Promise<void>}
   */
  async logExecution(scheduleId, status, transactionHash = null, errorMessage = null, attemptNumber = 1) {
    return withAsyncContext('log_execution', async () => {
      const { correlationId, traceId } = getCorrelationSummary();
      try {
        await Database.run(
          `CREATE TABLE IF NOT EXISTS recurring_donation_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scheduleId INTEGER NO,
            status TEXT NOT NULL,
            transactionHash TEXT,
            errorMessage TEXT,
            attemptNumber INTEGER DEFAULT 1,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            correlationId TEXT,
            traceId TEXT,
            FOREIGN KEY (scheduleId) REFERENCES recurring_donations(id)
          )`
        );

        await Database.run(
          `INSERT INTO recurring_donation_logs
             (scheduleId,estamp, correlationId, traceId)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            scheduleId,
            status,
            transactionHash,
            errorMessage,
            attemptNumber,
            new Date().toISOString(),
            correlationId,
            traceId,
          ]
        );
      } catch (err) {
        log.error('RECURRING_SCHEDULER', 'Failed to write execution log', {
          error: err.message,
          scheduleId,
        });
      }
    }, { scheduleId, status });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Date calculation
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Calculate the next execution date based on frequency.
   *
   * @param {Date}   currentDate        - Reference date (usually now)
   * @param {string} frequency          - 'daily' | 'weekly' | 'monthly' | 'custom'
   * @param {number} [customIntervalDays] - Required when frequency === 'custom'
   * @returns {Date}
   * @throws {Error} for unknown frequency or missing customIntervalDays
   */
  calculateNextExecutionDate(currentDate, frequency, customIntervalDays) {
    const next = new Date(currentDate);

    switch ((frequency || '').toLowerCase()) {
      case DONATION_FREQUENCIES.DAILY:
        next.setDate(next.getDate() + 1);
        break;
      case DONATION_FREQUENCIES.WEEKLY:
        next.setDate(next.getDate() + 7);
        break;
      case DONATION_FREQUENCIES.MONTHLY:
        next.setMonth(next.getMonth() + 1);
        break;
      case DONATION_FREQUENCIES.CUSTOM: {
        const days = parseInt(customIntervalDays, 10);
        if (!days || days < 1) {
          throw new Error('customIntervalDays must be a positive integer for custom frequency');
        }
        next.setDate(next.getDate() + days);
        break;
      }
      default:
        throw new Error(`Invalid frequency: ${frequency}`);
    }

    return next;
  }

  // ──────────────────────────────────────────────────────
  // Utilities
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Exponential backoff with ±30 % jitter.
   * @param {number} attempt - 1-indexed attempt number
   * @returns {number} Delay in milliseconds
   */
  calculateBackoff(attempt) {
    const base = Math.min(
      this.initialBackoffMs * Math.pow(this.backoffMultiplier, attempt - 1),
      this.maxBackoffMs
    );
    const jitter = Math.random() * 0.3 * base;
    return Math.floor(base + jitter);
  }

  /**
   * @param {number} ms
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Check if a schedule was executed within the last 5 minutes (duplicate guard).
   * @param {Object} schedule
   * @returns {Promise<boolean>}
   */
  async wasRecentlyExecuted(schedule) {
    return withAsyncContext('check_recent_execution', async () => {
      if (!schedule.lastExecutionDate) return false;
      const elapsed = Date.now() - new Date(schedule.lastExecutionDate).getTime();
      return elapsed < 5 * 60 * 1000;
    }, { scheduleId: schedule.id });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Status / history helpers (used by API routes)
  // ─────────────────────────────────────────────────────────────────────────

  /** @returns {Object} Current scheduler status */
  getStatus() {
    const { correlationId, traceId } = getCorrelationSummary();
    return {
      isRunning: this.isRunning,
      checkInterval: this.checkInterval,
      maxRetries: this.maxRetries,
      executingSchedules: Array.from(this.executingSchedules),
      correlationId,
      traceId,
    };
  }

  /**
   * Fetch execution history for a specific schedule.
   * @param {number} scheduleId
   * @param {number} [limit=20]
   * @returns {Promise<Array>}
   */
  async getExecutionLogs(scheduleId, limit = 20) {
    try {
      return await Database.query(
        `SELECT * FROM recurring_donation_logs
         WHERE scheduleId = ?
     Y timestamp DESC
         LIMIT ?`,
        [scheduleId, limit]
      );
    } catch (err) {
      log.error('RECURRING_SCHEDULER', 'Failed to get execution logs', { error: err.message });
      return [];
    }
  }

  /**
   * Fetch recent failures across all schedules.
   * @param {number} [limit=20]
   * @returns {Promise<Array>}
   */
  async getRecentFailures(limit = 20) {
    return withAsyncContext('get_recent_failures', async () => {
      try {
        return await Database.query(
          `SELECT rdl.*, rd.amount, rd.frequency
           FROM recurring_donation_logs rdl
           JOIN recurring_donations rd ON rdl.scheduleId = rd.id
           WHERE rdl.status = 'FAILED'
           ORDER BY rdl.timestamp DESC
           LIMIT ?`,
          [limit]
        );
      } catch (err) {
        log.error('RECURRING_SCHEDULER', 'Failed to get recent failures', { error: err.message });
        return [];
      }
    }, { limit });
  }
}

// Export class for use with `new`, but also export a default instance
// so tests that expect `require(...)` to return an object work
const _instance = new RecurringDonationScheduler(null);
_instance.Class = RecurringDonationScheduler;
module.exports = _instance;
module.exports.Class = RecurringDonationScheduler;
