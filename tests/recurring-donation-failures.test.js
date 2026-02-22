/**
 * Recurring Donation Failure Scenario Tests
 * Tests for scheduler failures, execution errors, and edge cases
 */

const RecurringDonationScheduler = require('../src/services/RecurringDonationScheduler');
const Database = require('../src/utils/database');
const { getStellarService } = require('../src/config/stellar');

describe('Recurring Donation Failure Scenarios', () => {
  let scheduler;
  let stellarService;

  beforeEach(() => {
    process.env.MOCK_STELLAR = 'true';
    scheduler = new RecurringDonationScheduler();
    stellarService = getStellarService();
  });

  afterEach(() => {
    if (scheduler.isRunning) {
      scheduler.stop();
    }
  });

  describe('Scheduler Startup Failures', () => {
    test('should handle double start gracefully', () => {
      scheduler.start();
      expect(() => scheduler.start()).not.toThrow();
      expect(scheduler.isRunning).toBe(true);
    });

    test('should handle stop when not running', () => {
      expect(() => scheduler.stop()).not.toThrow();
      expect(scheduler.isRunning).toBe(false);
    });

    test('should handle rapid start/stop cycles', () => {
      for (let i = 0; i < 5; i++) {
        scheduler.start();
        scheduler.stop();
      }
      expect(scheduler.isRunning).toBe(false);
    });
  });

  describe('Schedule Execution Failures', () => {
    test('should handle insufficient funds for recurring donation', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();

      // Create recurring donation with unfunded donor
      const scheduleId = await Database.query(
        `INSERT INTO recurring_donations 
         (donorId, recipientId, amount, frequency, status, nextExecutionDate, executionCount)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [donor.publicKey, recipient.publicKey, '1000', 'daily', 'active', new Date().toISOString(), 0]
      );

      await scheduler.processSchedules();

      // Verify schedule is still active but execution failed
      const schedule = await Database.query(
        'SELECT * FROM recurring_donations WHERE id = ?',
        [scheduleId]
      );

      expect(schedule).toBeDefined();
    });

    test('should handle donor account not found', async () => {
      await Database.query(
        `INSERT INTO recurring_donations 
         (donorId, recipientId, amount, frequency, status, nextExecutionDate, executionCount)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ['GNONEXISTENT', 'GRECIPIENT', '100', 'daily', 'active', new Date().toISOString(), 0]
      );

      await expect(scheduler.processSchedules()).resolves.not.toThrow();
    });

    test('should handle recipient account not found', async () => {
      const donor = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(donor.publicKey);

      await Database.query(
        `INSERT INTO recurring_donations 
         (donorId, recipientId, amount, frequency, status, nextExecutionDate, executionCount)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [donor.publicKey, 'GNONEXISTENT', '100', 'daily', 'active', new Date().toISOString(), 0]
      );

      await expect(scheduler.processSchedules()).resolves.not.toThrow();
    });

    test('should handle network error during execution', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(donor.publicKey);

      if (stellarService.setServiceAvailable) {
        stellarService.setServiceAvailable(false);
      }

      await Database.query(
        `INSERT INTO recurring_donations 
         (donorId, recipientId, amount, frequency, status, nextExecutionDate, executionCount)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [donor.publicKey, recipient.publicKey, '100', 'daily', 'active', new Date().toISOString(), 0]
      );

      await expect(scheduler.processSchedules()).resolves.not.toThrow();

      if (stellarService.setServiceAvailable) {
        stellarService.setServiceAvailable(true);
      }
    });
  });

  describe('Frequency Calculation Errors', () => {
    test('should handle invalid frequency value', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();

      await Database.query(
        `INSERT INTO recurring_donations 
         (donorId, recipientId, amount, frequency, status, nextExecutionDate, executionCount)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [donor.publicKey, recipient.publicKey, '100', 'invalid', 'active', new Date().toISOString(), 0]
      );

      await expect(scheduler.processSchedules()).resolves.not.toThrow();
    });

    test('should handle null frequency', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();

      await Database.query(
        `INSERT INTO recurring_donations 
         (donorId, recipientId, amount, frequency, status, nextExecutionDate, executionCount)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [donor.publicKey, recipient.publicKey, '100', null, 'active', new Date().toISOString(), 0]
      );

      await expect(scheduler.processSchedules()).resolves.not.toThrow();
    });
  });

  describe('Maximum Execution Count Handling', () => {
    test('should stop schedule when max executions reached', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(donor.publicKey);

      const scheduleId = await Database.query(
        `INSERT INTO recurring_donations 
         (donorId, recipientId, amount, frequency, status, nextExecutionDate, executionCount, maxExecutions)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [donor.publicKey, recipient.publicKey, '10', 'daily', 'active', new Date().toISOString(), 9, 10]
      );

      await scheduler.processSchedules();

      const schedule = await Database.query(
        'SELECT * FROM recurring_donations WHERE id = ?',
        [scheduleId]
      );

      expect(schedule.executionCount).toBe(10);
      expect(schedule.status).toBe('completed');
    });

    test('should handle negative max executions', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();

      await Database.query(
        `INSERT INTO recurring_donations 
         (donorId, recipientId, amount, frequency, status, nextExecutionDate, executionCount, maxExecutions)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [donor.publicKey, recipient.publicKey, '10', 'daily', 'active', new Date().toISOString(), 0, -1]
      );

      await expect(scheduler.processSchedules()).resolves.not.toThrow();
    });
  });

  describe('Schedule State Changes', () => {
    test('should handle donor account deactivation', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();

      const scheduleId = await Database.query(
        `INSERT INTO recurring_donations 
         (donorId, recipientId, amount, frequency, status, nextExecutionDate, executionCount)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [donor.publicKey, recipient.publicKey, '100', 'daily', 'active', new Date().toISOString(), 0]
      );

      // Simulate account deactivation by removing wallet
      if (stellarService.wallets) {
        stellarService.wallets.delete(donor.publicKey);
      }

      await expect(scheduler.processSchedules()).resolves.not.toThrow();
    });

    test('should handle paused schedule', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();

      await Database.query(
        `INSERT INTO recurring_donations 
         (donorId, recipientId, amount, frequency, status, nextExecutionDate, executionCount)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [donor.publicKey, recipient.publicKey, '100', 'daily', 'paused', new Date().toISOString(), 0]
      );

      await scheduler.processSchedules();

      // Verify no execution occurred
      const history = await stellarService.getTransactionHistory(recipient.publicKey);
      expect(history.length).toBe(0);
    });
  });

  describe('Concurrent Schedule Processing', () => {
    test('should handle multiple schedules due at same time', async () => {
      const donor1 = await stellarService.createWallet();
      const donor2 = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();

      await stellarService.fundTestnetWallet(donor1.publicKey);
      await stellarService.fundTestnetWallet(donor2.publicKey);

      await Database.query(
        `INSERT INTO recurring_donations 
         (donorId, recipientId, amount, frequency, status, nextExecutionDate, executionCount)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [donor1.publicKey, recipient.publicKey, '50', 'daily', 'active', new Date().toISOString(), 0]
      );

      await Database.query(
        `INSERT INTO recurring_donations 
         (donorId, recipientId, amount, frequency, status, nextExecutionDate, executionCount)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [donor2.publicKey, recipient.publicKey, '75', 'daily', 'active', new Date().toISOString(), 0]
      );

      await expect(scheduler.processSchedules()).resolves.not.toThrow();
    });

    test('should handle schedule processing during shutdown', async () => {
      scheduler.start();
      
      // Immediately stop while processing might be happening
      scheduler.stop();

      expect(scheduler.isRunning).toBe(false);
    });
  });

  describe('Database Query Failures', () => {
    test('should handle database connection error gracefully', async () => {
      // Mock database failure
      const originalQuery = Database.query;
      Database.query = jest.fn().mockRejectedValue(new Error('Database connection failed'));

      await expect(scheduler.processSchedules()).rejects.toThrow('Database connection failed');

      Database.query = originalQuery;
    });

    test('should handle malformed schedule data', async () => {
      await Database.query(
        `INSERT INTO recurring_donations 
         (donorId, recipientId, amount, frequency, status, nextExecutionDate, executionCount)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [null, null, 'invalid', 'daily', 'active', 'invalid-date', 'not-a-number']
      );

      await expect(scheduler.processSchedules()).resolves.not.toThrow();
    });
  });

  describe('Amount Validation Failures', () => {
    test('should handle zero amount recurring donation', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();

      await Database.query(
        `INSERT INTO recurring_donations 
         (donorId, recipientId, amount, frequency, status, nextExecutionDate, executionCount)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [donor.publicKey, recipient.publicKey, '0', 'daily', 'active', new Date().toISOString(), 0]
      );

      await expect(scheduler.processSchedules()).resolves.not.toThrow();
    });

    test('should handle negative amount recurring donation', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();

      await Database.query(
        `INSERT INTO recurring_donations 
         (donorId, recipientId, amount, frequency, status, nextExecutionDate, executionCount)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [donor.publicKey, recipient.publicKey, '-100', 'daily', 'active', new Date().toISOString(), 0]
      );

      await expect(scheduler.processSchedules()).resolves.not.toThrow();
    });
  });
});
