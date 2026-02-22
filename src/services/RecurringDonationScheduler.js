const Database = require('../utils/database');
const MockStellarService = require('./MockStellarService');

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
      console.log('Scheduler is already running');
      return;
    }

    console.log('Starting recurring donation scheduler...');
    this.isRunning = true;
    
    // Run immediately on start
    this.processSchedules();
    
    // Then run at intervals
    this.intervalId = setInterval(() => {
      this.processSchedules();
    }, this.checkInterval);

    console.log(`Scheduler started. Checking every ${this.checkInterval / 1000} seconds.`);
  }

  /**
   * Stop the scheduler
   */
  stop() {
    if (!this.isRunning) {
      console.log('Scheduler is not running');
      return;
    }

    console.log('Stopping recurring donation scheduler...');
    clearInterval(this.intervalId);
    this.isRunning = false;
    console.log('Scheduler stopped.');
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
         WHERE rd.status = 'active' 
         AND rd.nextExecutionDate <= ?`,
        [now]
      );

      if (dueSchedules.length > 0) {
        console.log(`[Scheduler] Found ${dueSchedules.length} schedule(s) due for execution`);
      }

      // Process schedules concurrently but with duplicate prevention
      const promises = dueSchedules
        .filter(schedule => !this.executingSchedules.has(schedule.id))
        .map(schedule => this.executeScheduleWithRetry(schedule));

      await Promise.allSettled(promises);
    } catch (error) {
      console.error('[Scheduler] Error processing schedules:', error.message);
      this.logFailure('PROCESS_SCHEDULES', null, error.message);
    }
  }

  /**
   * Execute a schedule with retry logic
   */
  async executeScheduleWithRetry(schedule) {
    // Prevent duplicate execution
    if (this.executingSchedules.has(schedule.id)) {
      console.log(`[Scheduler] Schedule ${schedule.id} is already being executed, skipping`);
      return;
    }

    this.executingSchedules.add(schedule.id);

    try {
      let lastError = null;
      
      for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
        try {
          console.log(`[Scheduler] Executing schedule ${schedule.id} (attempt ${attempt}/${this.maxRetries})`);
          
          await this.executeSchedule(schedule);
          
          // Success - clear any previous failures
          console.log(`[Scheduler] ✓ Schedule ${schedule.id} executed successfully`);
          return;
        } catch (error) {
          lastError = error;
          console.error(`[Scheduler] ✗ Attempt ${attempt}/${this.maxRetries} failed for schedule ${schedule.id}: ${error.message}`);
          
          // If this isn't the last attempt, wait before retrying
          if (attempt < this.maxRetries) {
            const backoffTime = this.calculateBackoff(attempt);
            console.log(`[Scheduler] Retrying in ${backoffTime}ms...`);
            await this.sleep(backoffTime);
          }
        }
      }

      // All retries failed
      console.error(`[Scheduler] ✗ All ${this.maxRetries} attempts failed for schedule ${schedule.id}`);
      await this.handleFailedExecution(schedule, lastError);
    } finally {
      this.executingSchedules.delete(schedule.id);
    }
  }

  /**
   * Execute a single schedule
   */
  async executeSchedule(schedule) {
    const executionId = `${schedule.id}-${Date.now()}`;
    
    try {
      // Check if this schedule was already executed recently (duplicate prevention)
      if (await this.wasRecentlyExecuted(schedule)) {
        console.log(`[Scheduler] Schedule ${schedule.id} was recently executed, skipping to prevent duplicate`);
        return;
      }

      console.log(`[Scheduler] Sending ${schedule.amount} from ${schedule.donorPublicKey} to ${schedule.recipientPublicKey}`);

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

      console.log(`[Scheduler] Transaction hash: ${transactionResult.hash}`);
      console.log(`[Scheduler] Next execution: ${nextExecutionDate.toISOString()}`);
      
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
      console.error(`[Scheduler] Schedule ${schedule.id} will be retried on next cycle`);
    } catch (logError) {
      console.error(`[Scheduler] Failed to log execution failure:`, logError.message);
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
      console.error(`[Scheduler] Failed to log execution:`, error.message);
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
    
    console.error(`[Scheduler] ${logMessage}`);
    
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
      case 'daily':
        nextDate.setDate(nextDate.getDate() + 1);
        break;
      case 'weekly':
        nextDate.setDate(nextDate.getDate() + 7);
        break;
      case 'monthly':
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
      console.error(`[Scheduler] Failed to get execution logs:`, error.message);
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
      console.error(`[Scheduler] Failed to get recent failures:`, error.message);
      return [];
    }
  }
}

// Create singleton instance
const scheduler = new RecurringDonationScheduler();

module.exports = scheduler;
