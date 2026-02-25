const Database = require('../utils/database');
const MockStellarService = require('./MockStellarService');
const { SCHEDULE_STATUS, DONATION_FREQUENCIES } = require('../constants');
const log = require('../utils/log');

class RecurringDonationScheduler {
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
   */
  start() {
    if (this.isRunning) {
      log.info('RECURRING_SCHEDULER', 'Scheduler is already running');
      return;
    }

    log.info('RECURRING_SCHEDULER', 'Starting recurring donation scheduler');
    this.isRunning = true;
    
    // Run immediately on start
    this.processSchedules();
    
    // Then run at intervals
    this.intervalId = setInterval(() => {
      this.processSchedules();
    }, this.checkInterval);

    log.info('RECURRING_SCHEDULER', 'Scheduler started', { checkIntervalSeconds: this.checkInterval / 1000 });
  }

  /**
   * Stop the scheduler
   */
  stop() {
    if (!this.isRunning) {
      log.info('RECURRING_SCHEDULER', 'Scheduler is not running');
      return;
    }

    log.info('RECURRING_SCHEDULER', 'Stopping recurring donation scheduler');
    clearInterval(this.intervalId);
    this.isRunning = false;
    log.info('RECURRING_SCHEDULER', 'Scheduler stopped');
  }

  /**
   * Process all due schedules
   */
  async processSchedules() {
    if (!this.isRunning) {
      return;
    }

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
        log.info('RECURRING_SCHEDULER', 'Found due schedules for execution', { count: dueSchedules.length });
      }

      // Process schedules concurrently but with duplicate prevention
      const promises = dueSchedules
        .filter(schedule => !this.executingSchedules.has(schedule.id))
        .map(schedule => this.executeScheduleWithRetry(schedule));

      await Promise.allSettled(promises);
    } catch (error) {
      log.error('RECURRING_SCHEDULER', 'Error processing schedules', { error: error.message });
      this.logFailure('PROCESS_SCHEDULES', null, error.message);
    }
  }

  /**
   * Execute a schedule with retry logic
   */
  async executeScheduleWithRetry(schedule) {
    // Prevent duplicate execution
    if (this.executingSchedules.has(schedule.id)) {
      log.info('RECURRING_SCHEDULER', 'Schedule is already being executed, skipping', { scheduleId: schedule.id });
      return;
    }

    this.executingSchedules.add(schedule.id);

    try {
      let lastError = null;
      
      for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
        try {
          log.info('RECURRING_SCHEDULER', 'Executing schedule', {
            scheduleId: schedule.id,
            attempt,
            maxRetries: this.maxRetries,
          });
          
          await this.executeSchedule(schedule);
          
          // Success - clear any previous failures
          log.info('RECURRING_SCHEDULER', 'Schedule executed successfully', { scheduleId: schedule.id });
          return;
        } catch (error) {
          lastError = error;
          log.error('RECURRING_SCHEDULER', 'Schedule execution attempt failed', {
            scheduleId: schedule.id,
            attempt,
            maxRetries: this.maxRetries,
            error: error.message,
          });
          
          // If this isn't the last attempt, wait before retrying
          if (attempt < this.maxRetries) {
            const backoffTime = this.calculateBackoff(attempt);
            log.info('RECURRING_SCHEDULER', 'Retrying schedule execution after backoff', {
              scheduleId: schedule.id,
              backoffMs: backoffTime,
            });
            await this.sleep(backoffTime);
          }
        }
      }

      // All retries failed
      log.error('RECURRING_SCHEDULER', 'All retry attempts failed', {
        scheduleId: schedule.id,
        maxRetries: this.maxRetries,
      });
      await this.handleFailedExecution(schedule, lastError);
    } finally {
      this.executingSchedules.delete(schedule.id);
    }
  }

  /**
   * Execute a single schedule
   */
  async executeSchedule(schedule) {
    try {
      // Check if this schedule was already executed recently (duplicate prevention)
      if (await this.wasRecentlyExecuted(schedule)) {
        log.info('RECURRING_SCHEDULER', 'Schedule was recently executed, skipping duplicate', { scheduleId: schedule.id });
        return;
      }

      log.info('RECURRING_SCHEDULER', 'Sending recurring donation transaction', {
        scheduleId: schedule.id,
        amount: schedule.amount,
        donorPublicKey: schedule.donorPublicKey,
        recipientPublicKey: schedule.recipientPublicKey,
      });

      // Simulate sending donation on testnet using MockStellarService
      const transactionResult = await this.stellarService.sendPayment(
        schedule.donorPublicKey,
        schedule.recipientPublicKey,
        schedule.amount,
        `Recurring donation (Schedule #${schedule.id})`
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
          new Date().toISOString()
        ]
      );

      // Calculate next execution date
      const nextExecutionDate = this.calculateNextExecutionDate(
        new Date(),
        schedule.frequency
      );

      // Update the schedule
      await Database.run(
        `UPDATE recurring_donations 
         SET lastExecutionDate = ?,
             nextExecutionDate = ?,
             executionCount = executionCount + 1
         WHERE id = ?`,
        [new Date().toISOString(), nextExecutionDate.toISOString(), schedule.id]
      );

      log.info('RECURRING_SCHEDULER', 'Recurring donation executed', {
        scheduleId: schedule.id,
        transactionHash: transactionResult.hash,
        nextExecution: nextExecutionDate.toISOString(),
      });
      
      // Log successful execution
      await this.logExecution(schedule.id, 'SUCCESS', transactionResult.hash);
    } catch (error) {
      // Log failed execution
      await this.logExecution(schedule.id, 'FAILED', null, error.message);
      throw error; // Re-throw for retry logic
    }
  }

  /**
   * Check if schedule was recently executed to prevent duplicates
   */
  async wasRecentlyExecuted(schedule) {
    if (!schedule.lastExecutionDate) {
      return false;
    }

    const lastExecution = new Date(schedule.lastExecutionDate);
    const now = new Date();
    const timeSinceLastExecution = now - lastExecution;
    
    // Consider "recent" as within the last 5 minutes
    const recentThresholdMs = 5 * 60 * 1000;
    
    return timeSinceLastExecution < recentThresholdMs;
  }

  /**
   * Handle failed execution after all retries
   */
  async handleFailedExecution(schedule, error) {
    try {
      // Log the failure
      await this.logFailure(schedule.id, schedule, error.message);
      
      // Optionally pause the schedule after repeated failures
      // For now, we'll just log and let it retry on the next cycle
      log.error('RECURRING_SCHEDULER', 'Schedule will be retried on next cycle', { scheduleId: schedule.id });
    } catch (logError) {
      log.error('RECURRING_SCHEDULER', 'Failed to log execution failure', { error: logError.message });
    }
  }

  /**
   * Log execution attempt
   */
  async logExecution(scheduleId, status, transactionHash = null, errorMessage = null) {
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
          FOREIGN KEY (scheduleId) REFERENCES recurring_donations(id)
        )
      `);

      await Database.run(
        `INSERT INTO recurring_donation_logs (scheduleId, status, transactionHash, errorMessage, timestamp)
         VALUES (?, ?, ?, ?, ?)`,
        [scheduleId, status, transactionHash, errorMessage, new Date().toISOString()]
      );
    } catch (error) {
      log.error('RECURRING_SCHEDULER', 'Failed to write execution log', { error: error.message });
    }
  }

  /**
   * Log general failure
   */
  async logFailure(context, schedule, errorMessage) {
    const scheduleId = schedule ? schedule.id : null;
    const logMessage = schedule 
      ? `Failed to execute schedule ${scheduleId}: ${errorMessage}`
      : `Scheduler error in ${context}: ${errorMessage}`;
    
    log.error('RECURRING_SCHEDULER', logMessage);
    
    if (scheduleId) {
      await this.logExecution(scheduleId, 'FAILED', null, errorMessage);
    }
  }

  /**
   * Calculate exponential backoff time
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
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Calculate the next execution date based on frequency
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
    return {
      isRunning: this.isRunning,
      checkInterval: this.checkInterval,
      maxRetries: this.maxRetries,
      executingSchedules: Array.from(this.executingSchedules)
    };
  }

  /**
   * Get execution logs for a schedule
   */
  async getExecutionLogs(scheduleId, limit = 10) {
    try {
      const logs = await Database.query(
        `SELECT * FROM recurring_donation_logs 
         WHERE scheduleId = ? 
         ORDER BY timestamp DESC 
         LIMIT ?`,
        [scheduleId, limit]
      );
      return logs;
    } catch (error) {
      log.error('RECURRING_SCHEDULER', 'Failed to get execution logs', { error: error.message });
      return [];
    }
  }

  /**
   * Get recent failures across all schedules
   */
  async getRecentFailures(limit = 20) {
    try {
      const failures = await Database.query(
        `SELECT rdl.*, rd.amount, rd.frequency
         FROM recurring_donation_logs rdl
         JOIN recurring_donations rd ON rdl.scheduleId = rd.id
         WHERE rdl.status = 'FAILED'
         ORDER BY rdl.timestamp DESC
         LIMIT ?`,
        [limit]
      );
      return failures;
    } catch (error) {
      log.error('RECURRING_SCHEDULER', 'Failed to get recent failures', { error: error.message });
      return [];
    }
  }
}

// Create singleton instance
const scheduler = new RecurringDonationScheduler();

module.exports = scheduler;
