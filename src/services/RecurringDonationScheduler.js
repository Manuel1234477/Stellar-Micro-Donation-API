/**
 * Recurring Donation Scheduler
 * Automatically processes recurring donation schedules at regular intervals
 * 
 * Features:
 * - Automatic execution of due donations
 * - Retry logic with exponential backoff
 * - Duplicate execution prevention
 * - Execution logging and failure tracking
 * - Correlation ID propagation for end-to-end tracing
 */

const Database = require('../utils/database');
const MockStellarService = require('./MockStellarService');
const { SCHEDULE_STATUS, DONATION_FREQUENCIES } = require('../constants');
const log = require('../utils/log');
const {
  withBackgroundContext,
  withAsyncContext,
  getCorrelationSummary,
} = require("../utils/correlation");

class RecurringDonationScheduler {
  /**
   * Create a new RecurringDonationScheduler instance
   * Initializes with default configuration for retry logic and execution tracking
   */
  constructor() {
    this.intervalId = null;
    this.isRunning = false;
    this.checkInterval = 60000; // Check every minute
    this.stellarService = new MockStellarService();
    
    // Retry configuration
    this.maxRetries = 3;
    this.initialBackoffMs = 1000; // 1 second
    this.maxBackoffMs = 30000; // 30 seconds
    this.backoffMultiplier = 2;
    
    // Track in-progress executions to prevent duplicates
    this.executingSchedules = new Set();
  }

  /**
   * Start the scheduler
   * Begins processing recurring donation schedules at regular intervals
   * Runs immediately on start, then continues at configured intervals
   * @returns {void}
   */
  start() {
    if (this.isRunning) {
      return;
    }

    return withBackgroundContext("scheduler_start", () => {
      this.isRunning = true;

      // Run immediately on start
      this.processSchedules();

      // Then run at intervals
      this.intervalId = setInterval(() => {
        this.processSchedules();
      }, this.checkInterval);

      const correlation = getCorrelationSummary();
      log.info("RECURRING_SCHEDULER", "Scheduler started", {
        checkIntervalSeconds: this.checkInterval / 1000,
        correlationId: correlation.correlationId,
        traceId: correlation.traceId,
      });
    });
  }

  /**
   * Stop the scheduler
   * Stops processing recurring donation schedules
   * Does not interrupt currently executing donations
   * @returns {void}
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    return withBackgroundContext("scheduler_stop", () => {
      clearInterval(this.intervalId);
      this.isRunning = false;

      const correlation = getCorrelationSummary();
      log.info("RECURRING_SCHEDULER", "Scheduler stopped", {
        correlationId: correlation.correlationId,
        traceId: correlation.traceId,
      });
    });
  }

  /**
   * Process all due schedules
   * Queries database for active schedules with nextExecutionDate <= now
   * Executes them concurrently with duplicate prevention
   * @returns {Promise<void>}
   */
  async processSchedules() {
    return withAsyncContext("process_schedules", async () => {
      if (!this.isRunning) {
        return;
      }

      const correlation = getCorrelationSummary();

      try {
        const now = new Date().toISOString();
        
        // Find all active schedules that are due for execution
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

        // Process schedules concurrently but with duplicate prevention
        const promises = dueSchedules
          .filter((schedule) => !this.executingSchedules.has(schedule.id))
          .map((schedule) => this.executeScheduleWithRetry(schedule));

        await Promise.allSettled(promises);
      } catch (error) {
        log.error("RECURRING_SCHEDULER", "Error processing schedules", {
          error: error.message,
          correlationId: correlation.correlationId,
          traceId: correlation.traceId,
        });
        this.logFailure("PROCESS_SCHEDULES", null, error.message);
      }
    });
  }

  /**
   * Execute a schedule with retry logic
   * Attempts execution up to maxRetries times with exponential backoff
   * Prevents duplicate execution using in-memory tracking
   * @param {Object} schedule - Schedule object from database
   * @param {number} schedule.id - Schedule ID
   * @param {number} schedule.donorId - Donor user ID
   * @param {number} schedule.recipientId - Recipient user ID
   * @param {string} schedule.amount - Donation amount
   * @param {string} schedule.frequency - Donation frequency
   * @param {string} schedule.donorPublicKey - Donor's Stellar public key
   * @param {string} schedule.recipientPublicKey - Recipient's Stellar public key
   * @returns {Promise<void>}
   */
  async executeScheduleWithRetry(schedule) {
    return withAsyncContext(
      "execute_schedule_with_retry",
      async () => {
        // Prevent duplicate execution
        if (this.executingSchedules.has(schedule.id)) {
          return;
        }

        this.executingSchedules.add(schedule.id);
        const correlation = getCorrelationSummary();

        try {
          let lastError = null;

          for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
              await this.executeSchedule(schedule);
              return; // Success
            } catch (error) {
              lastError = error;
              log.error("RECURRING_SCHEDULER", "Schedule execution failed", {
                scheduleId: schedule.id,
                attempt,
                maxRetries: this.maxRetries,
                error: error.message,
                correlationId: correlation.correlationId,
                traceId: correlation.traceId,
              });

              // Wait before retrying (except on last attempt)
              if (attempt < this.maxRetries) {
                await this.sleep(this.calculateBackoff(attempt));
              }
            }
          }

          // All retries failed
          await this.handleFailedExecution(schedule, lastError);
        } finally {
          this.executingSchedules.delete(schedule.id);
        }
      },
      { scheduleId: schedule.id },
    );
  }

  /**
   * Execute a single schedule
   * Sends the donation transaction and updates the schedule in database
   * Records transaction and calculates next execution date
   * @param {Object} schedule - Schedule object from database
   * @returns {Promise<void>}
   * @throws {Error} If transaction fails or database update fails
   */
  async executeSchedule(schedule) {
    return withAsyncContext(
      "execute_schedule",
      async () => {
        const correlation = getCorrelationSummary();

        try {
          // Check if this schedule was already executed recently (duplicate prevention)
          if (await this.wasRecentlyExecuted(schedule)) {
            return;
          }

          // Send donation on Stellar network
          const transactionResult = await this.stellarService.sendPayment(
            schedule.donorPublicKey,
            schedule.recipientPublicKey,
            schedule.amount,
            `Recurring donation (Schedule #${schedule.id})`,
          );

          // Record the transaction in the database
          await Database.run(
            `INSERT INTO transactions (senderId, receiverId, amount, memo, timestamp)
           VALUES (?, ?, ?, ?, ?)`,
            [
              schedule.donorId,
              schedule.recipientId,
              schedule.amount,
              `Recurring donation (Schedule #${schedule.id})`,
              new Date().toISOString(),
            ],
          );

          // Calculate next execution date
          const nextExecutionDate = this.calculateNextExecutionDate(
            new Date(),
            schedule.frequency,
          );

          // Update the schedule
          await Database.run(
            `UPDATE recurring_donations 
           SET lastExecutionDate = ?,
               nextExecutionDate = ?,
               executionCount = executionCount + 1
           WHERE id = ?`,
            [
              new Date().toISOString(),
              nextExecutionDate.toISOString(),
              schedule.id,
            ],
          );

          log.info("RECURRING_SCHEDULER", "Donation executed", {
            scheduleId: schedule.id,
            txHash: transactionResult.hash,
            nextExecution: nextExecutionDate.toISOString(),
            correlationId: correlation.correlationId,
            traceId: correlation.traceId,
          });

          // Log successful execution
          await this.logExecution(
            schedule.id,
            "SUCCESS",
            transactionResult.hash,
          );
        } catch (error) {
          // Log failed execution
          await this.logExecution(schedule.id, "FAILED", null, error.message);
          throw error; // Re-throw for retry logic
        }
      },
      { scheduleId: schedule.id, amount: schedule.amount },
    );
  }

  /**
   * Check if schedule was recently executed to prevent duplicates
   * Considers execution "recent" if within last 5 minutes
   * @param {Object} schedule - Schedule object with lastExecutionDate
   * @param {string} [schedule.lastExecutionDate] - ISO timestamp of last execution
   * @returns {Promise<boolean>} True if executed within last 5 minutes
   */
  async wasRecentlyExecuted(schedule) {
    return withAsyncContext(
      "check_recent_execution",
      async () => {
        if (!schedule.lastExecutionDate) {
          return false;
        }

        const lastExecution = new Date(schedule.lastExecutionDate);
        const now = new Date();
        const timeSinceLastExecution = now - lastExecution;

        // Consider "recent" as within the last 5 minutes
        const recentThresholdMs = 5 * 60 * 1000;

        return timeSinceLastExecution < recentThresholdMs;
      },
      { scheduleId: schedule.id },
    );
  }

  /**
   * Handle failed execution after all retries exhausted
   * Logs the failure for monitoring and debugging
   * @param {Object} schedule - Schedule object
   * @param {Error} error - Error that caused the failure
   * @returns {Promise<void>}
   */
  async handleFailedExecution(schedule, error) {
    return withAsyncContext(
      "handle_failed_execution",
      async () => {
        try {
          await this.logFailure(schedule.id, schedule, error.message);
        } catch (logError) {
          const correlation = getCorrelationSummary();
          log.error("RECURRING_SCHEDULER", "Failed to log execution failure", {
            error: logError.message,
            correlationId: correlation.correlationId,
            traceId: correlation.traceId,
          });
        }
      },
      { scheduleId: schedule.id },
    );
  }

  /**
   * Log execution attempt to database
   * Creates execution log table if it doesn't exist
   * @param {number} scheduleId - Schedule ID
   * @param {string} status - Execution status ('SUCCESS' or 'FAILED')
   * @param {string} [transactionHash=null] - Transaction hash if successful
   * @param {string} [errorMessage=null] - Error message if failed
   * @returns {Promise<void>}
   */
  async logExecution(scheduleId, status, transactionHash = null, errorMessage = null) {
    return withAsyncContext(
      "log_execution",
      async () => {
        const correlation = getCorrelationSummary();

        try {
          // Create execution log table if it doesn't exist
          await Database.run(`
          CREATE TABLE IF NOT EXISTS recurring_donation_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scheduleId INTEGER NOT NULL,
            status TEXT NOT NULL,
            transactionHash TEXT,
            errorMessage TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            correlationId TEXT,
            traceId TEXT,
            FOREIGN KEY (scheduleId) REFERENCES recurring_donations(id)
          )
        `);

          await Database.run(
            `INSERT INTO recurring_donation_logs (scheduleId, status, transactionHash, errorMessage, timestamp, correlationId, traceId)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              scheduleId,
              status,
              transactionHash,
              errorMessage,
              new Date().toISOString(),
              correlation.correlationId,
              correlation.traceId,
            ],
          );
        } catch (error) {
          log.error("RECURRING_SCHEDULER", "Failed to write execution log", {
            error: error.message,
            scheduleId,
            correlationId: correlation.correlationId,
            traceId: correlation.traceId,
          });
        }
      },
      { scheduleId, status },
    );
  }

  /**
   * Log general failure
   * Logs error to console and database
   * @param {string} context - Context where failure occurred
   * @param {Object} [schedule] - Schedule object if applicable
   * @param {string} errorMessage - Error message
   * @returns {Promise<void>}
   */
  async logFailure(context, schedule, errorMessage) {
    return withAsyncContext(
      "log_failure",
      async () => {
        const correlation = getCorrelationSummary();
        const scheduleId = schedule ? schedule.id : null;
        const logMessage = schedule
          ? `Failed to execute schedule ${scheduleId}: ${errorMessage}`
          : `Scheduler error in ${context}: ${errorMessage}`;

        log.error("RECURRING_SCHEDULER", logMessage, {
          correlationId: correlation.correlationId,
          traceId: correlation.traceId,
          scheduleId,
        });

        if (scheduleId) {
          await this.logExecution(scheduleId, "FAILED", null, errorMessage);
        }
      },
      { context, scheduleId: schedule?.id },
    );
  }

  /**
   * Calculate exponential backoff time with jitter
   * Prevents thundering herd problem by adding randomness
   * @param {number} attempt - Current attempt number (1-indexed)
   * @returns {number} Backoff time in milliseconds
   */
  calculateBackoff(attempt) {
    const backoff = Math.min(
      this.initialBackoffMs * Math.pow(this.backoffMultiplier, attempt - 1),
      this.maxBackoffMs
    );
    
    // Add jitter to prevent thundering herd
    const jitter = Math.random() * 0.3 * backoff;
    return Math.floor(backoff + jitter);
  }

  /**
   * Sleep utility for async delays
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>} Resolves after specified time
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Calculate the next execution date based on frequency
   * Supports daily, weekly, and monthly frequencies
   * @param {Date} currentDate - Current execution date
   * @param {string} frequency - Frequency ('daily', 'weekly', or 'monthly')
   * @returns {Date} Next execution date
   */
  calculateNextExecutionDate(currentDate, frequency) {
    const nextDate = new Date(currentDate);
    
    switch (frequency.toLowerCase()) {
      case DONATION_FREQUENCIES.DAILY:
        nextDate.setDate(nextDate.getDate() + 1);
        break;
      case DONATION_FREQUENCIES.WEEKLY:
        nextDate.setDate(nextDate.getDate() + 7);
        break;
      case DONATION_FREQUENCIES.MONTHLY:
        nextDate.setMonth(nextDate.getMonth() + 1);
        break;
      default:
        throw new Error(`Invalid frequency: ${frequency}`);
    }
    
    return nextDate;
  }

  /**
   * Get scheduler status
   */
  getStatus() {
    const correlation = getCorrelationSummary();
    return {
      isRunning: this.isRunning,
      checkInterval: this.checkInterval,
      maxRetries: this.maxRetries,
      executingSchedules: Array.from(this.executingSchedules),
      correlationId: correlation.correlationId,
      traceId: correlation.traceId,
    };
  }

  /**
   * Get execution logs for a schedule
   */
  async getExecutionLogs(scheduleId, limit = 10) {
    return withAsyncContext(
      "get_execution_logs",
      async () => {
        const correlation = getCorrelationSummary();

        try {
          const logs = await Database.query(
            `SELECT * FROM recurring_donation_logs 
           WHERE scheduleId = ? 
           ORDER BY timestamp DESC 
           LIMIT ?`,
            [scheduleId, limit],
          );
          return logs;
        } catch (error) {
          log.error("RECURRING_SCHEDULER", "Failed to get execution logs", {
            error: error.message,
            scheduleId,
            correlationId: correlation.correlationId,
            traceId: correlation.traceId,
          });
          return [];
        }
      },
      { scheduleId, limit },
    );
  }

  /**
   * Get recent failures across all schedules
   */
  async getRecentFailures(limit = 20) {
    return withAsyncContext(
      "get_recent_failures",
      async () => {
        const correlation = getCorrelationSummary();

        try {
          const failures = await Database.query(
            `SELECT rdl.*, rd.amount, rd.frequency
           FROM recurring_donation_logs rdl
           JOIN recurring_donations rd ON rdl.scheduleId = rd.id
           WHERE rdl.status = 'FAILED'
           ORDER BY rdl.timestamp DESC
           LIMIT ?`,
            [limit],
          );
          return failures;
        } catch (error) {
          log.error("RECURRING_SCHEDULER", "Failed to get recent failures", {
            error: error.message,
            correlationId: correlation.correlationId,
            traceId: correlation.traceId,
          });
          return [];
        }
      },
      { limit },
    );
  }
}

// Create singleton instance
const scheduler = new RecurringDonationScheduler();

module.exports = scheduler;
