const Database = require('../utils/database');
const MockStellarService = require('./MockStellarService');

class RecurringDonationScheduler {
  constructor() {
    this.intervalId = null;
    this.isRunning = false;
    this.checkInterval = 60000; // Check every minute
    this.stellarService = new MockStellarService();
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
        console.log(`Found ${dueSchedules.length} schedule(s) due for execution`);
      }

      for (const schedule of dueSchedules) {
        await this.executeSchedule(schedule);
      }
    } catch (error) {
      console.error('Error processing schedules:', error);
    }
  }

  /**
   * Execute a single schedule
   */
  async executeSchedule(schedule) {
    try {
      console.log(`Executing schedule ${schedule.id}: ${schedule.amount} from ${schedule.donorPublicKey} to ${schedule.recipientPublicKey}`);

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

      console.log(`✓ Schedule ${schedule.id} executed successfully. Next execution: ${nextExecutionDate.toISOString()}`);
      console.log(`  Transaction hash: ${transactionResult.hash}`);
    } catch (error) {
      console.error(`✗ Failed to execute schedule ${schedule.id}:`, error.message);
      
      // Optionally mark schedule as failed or pause it
      // For now, we'll just log the error and try again next time
    }
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
      checkInterval: this.checkInterval
    };
  }
}

// Create singleton instance
const scheduler = new RecurringDonationScheduler();

module.exports = scheduler;
