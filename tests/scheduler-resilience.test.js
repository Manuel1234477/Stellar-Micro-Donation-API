const RecurringDonationScheduler = require('../src/services/RecurringDonationScheduler');
const Database = require('../src/utils/database');
const MockStellarService = require('../src/services/MockStellarService');

// Mock Database
jest.mock('../src/utils/database');

// Mock MockStellarService
jest.mock('../src/services/MockStellarService');

describe('Recurring Donation Scheduler - Resilience Tests', () => {
  let scheduler;
  let mockStellarService;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Create new scheduler instance
    scheduler = Object.create(RecurringDonationScheduler);
    scheduler.intervalId = null;
    scheduler.isRunning = false;
    scheduler.checkInterval = 60000;
    scheduler.maxRetries = 3;
    scheduler.initialBackoffMs = 100; // Faster for testing
    scheduler.maxBackoffMs = 1000;
    scheduler.backoffMultiplier = 2;
    scheduler.executingSchedules = new Set();
    
    // Mock stellar service
    mockStellarService = {
      sendPayment: jest.fn()
    };
    scheduler.stellarService = mockStellarService;

    // Mock Database methods
    Database.query = jest.fn();
    Database.run = jest.fn();
  });

  afterEach(() => {
    if (scheduler.isRunning) {
      scheduler.stop();
    }
  });

  describe('Retry Mechanism with Exponential Backoff', () => {
    test('should retry failed execution up to maximum retry limit', async () => {
      const schedule = {
        id: 1,
        donorId: 1,
        recipientId: 2,
        amount: 100,
        frequency: 'daily',
        donorPublicKey: 'GDONOR',
        recipientPublicKey: 'GRECIPIENT',
        lastExecutionDate: null
      };

      // Mock stellar service to fail twice, then succeed
      mockStellarService.sendPayment
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockResolvedValueOnce({ hash: 'tx123' });

      Database.run.mockResolvedValue({});
      scheduler.logExecution = jest.fn().mockResolvedValue();

      await scheduler.executeScheduleWithRetry(schedule);

      expect(mockStellarService.sendPayment).toHaveBeenCalledTimes(3);
      expect(scheduler.logExecution).toHaveBeenCalledWith(1, 'SUCCESS', 'tx123');
    });

    test('should fail permanently after maxRetries attempts exhausted', async () => {
      const schedule = {
        id: 1,
        donorId: 1,
        recipientId: 2,
        amount: 100,
        frequency: 'daily',
        donorPublicKey: 'GDONOR',
        recipientPublicKey: 'GRECIPIENT',
        lastExecutionDate: null
      };

      // Mock stellar service to always fail
      mockStellarService.sendPayment.mockRejectedValue(new Error('Stellar unavailable'));
      
      scheduler.logExecution = jest.fn().mockResolvedValue();
      scheduler.handleFailedExecution = jest.fn().mockResolvedValue();

      await scheduler.executeScheduleWithRetry(schedule);

      expect(mockStellarService.sendPayment).toHaveBeenCalledTimes(3);
      expect(scheduler.handleFailedExecution).toHaveBeenCalledWith(
        schedule,
        expect.any(Error)
      );
    });

    test('should use exponential backoff between retries', async () => {
      const schedule = {
        id: 1,
        donorId: 1,
        recipientId: 2,
        amount: 100,
        frequency: 'daily',
        donorPublicKey: 'GDONOR',
        recipientPublicKey: 'GRECIPIENT',
        lastExecutionDate: null
      };

      mockStellarService.sendPayment.mockRejectedValue(new Error('Network error'));
      scheduler.logExecution = jest.fn().mockResolvedValue();
      scheduler.handleFailedExecution = jest.fn().mockResolvedValue();

      const sleepSpy = jest.spyOn(scheduler, 'sleep').mockResolvedValue();

      await scheduler.executeScheduleWithRetry(schedule);

      // Should sleep twice (between 3 attempts)
      expect(sleepSpy).toHaveBeenCalledTimes(2);
      
      // First backoff should be around 100ms (with jitter)
      const firstBackoff = sleepSpy.mock.calls[0][0];
      expect(firstBackoff).toBeGreaterThanOrEqual(100);
      expect(firstBackoff).toBeLessThanOrEqual(130);

      // Second backoff should be around 200ms (with jitter)
      const secondBackoff = sleepSpy.mock.calls[1][0];
      expect(secondBackoff).toBeGreaterThanOrEqual(200);
      expect(secondBackoff).toBeLessThanOrEqual(260);
    });
  });

  describe('Concurrent Execution Prevention and Deduplication', () => {
    test('should skip schedule already in progress to prevent duplicates', async () => {
      const schedule = {
        id: 1,
        donorId: 1,
        recipientId: 2,
        amount: 100,
        frequency: 'daily',
        donorPublicKey: 'GDONOR',
        recipientPublicKey: 'GRECIPIENT'
      };

      // Mark schedule as executing
      scheduler.executingSchedules.add(1);

      mockStellarService.sendPayment.mockResolvedValue({ hash: 'tx123' });

      await scheduler.executeScheduleWithRetry(schedule);

      // Should not call stellar service
      expect(mockStellarService.sendPayment).not.toHaveBeenCalled();
    });

    test('should prevent duplicate execution if recently executed', async () => {
      const recentTime = new Date(Date.now() - 2 * 60 * 1000); // 2 minutes ago
      
      const schedule = {
        id: 1,
        donorId: 1,
        recipientId: 2,
        amount: 100,
        frequency: 'daily',
        donorPublicKey: 'GDONOR',
        recipientPublicKey: 'GRECIPIENT',
        lastExecutionDate: recentTime.toISOString()
      };

      mockStellarService.sendPayment.mockResolvedValue({ hash: 'tx123' });
      Database.run.mockResolvedValue({});

      await scheduler.executeSchedule(schedule);

      // Should not execute
      expect(mockStellarService.sendPayment).not.toHaveBeenCalled();
    });

    test('should execute if last execution was more than 5 minutes ago', async () => {
      const oldTime = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago
      
      const schedule = {
        id: 1,
        donorId: 1,
        recipientId: 2,
        amount: 100,
        frequency: 'daily',
        donorPublicKey: 'GDONOR',
        recipientPublicKey: 'GRECIPIENT',
        lastExecutionDate: oldTime.toISOString()
      };

      mockStellarService.sendPayment.mockResolvedValue({ hash: 'tx123' });
      Database.run.mockResolvedValue({});
      scheduler.logExecution = jest.fn().mockResolvedValue();

      await scheduler.executeSchedule(schedule);

      // Should execute
      expect(mockStellarService.sendPayment).toHaveBeenCalled();
    });

    test('should remove schedule from executing set after completion', async () => {
      const schedule = {
        id: 1,
        donorId: 1,
        recipientId: 2,
        amount: 100,
        frequency: 'daily',
        donorPublicKey: 'GDONOR',
        recipientPublicKey: 'GRECIPIENT',
        lastExecutionDate: null
      };

      mockStellarService.sendPayment.mockResolvedValue({ hash: 'tx123' });
      Database.run.mockResolvedValue({});
      scheduler.logExecution = jest.fn().mockResolvedValue();

      await scheduler.executeScheduleWithRetry(schedule);

      expect(scheduler.executingSchedules.has(1)).toBe(false);
    });

    test('should remove schedule from executing set even on failure', async () => {
      const schedule = {
        id: 1,
        donorId: 1,
        recipientId: 2,
        amount: 100,
        frequency: 'daily',
        donorPublicKey: 'GDONOR',
        recipientPublicKey: 'GRECIPIENT',
        lastExecutionDate: null
      };

      mockStellarService.sendPayment.mockRejectedValue(new Error('Network error'));
      scheduler.logExecution = jest.fn().mockResolvedValue();
      scheduler.handleFailedExecution = jest.fn().mockResolvedValue();

      await scheduler.executeScheduleWithRetry(schedule);

      expect(scheduler.executingSchedules.has(1)).toBe(false);
    });
  });

  describe('Execution Logging and Audit Trail', () => {
    test('should log successful execution with transaction hash', async () => {
      const schedule = {
        id: 1,
        donorId: 1,
        recipientId: 2,
        amount: 100,
        frequency: 'daily',
        donorPublicKey: 'GDONOR',
        recipientPublicKey: 'GRECIPIENT',
        lastExecutionDate: null
      };

      mockStellarService.sendPayment.mockResolvedValue({ hash: 'tx123' });
      Database.run.mockResolvedValue({});

      await scheduler.executeSchedule(schedule);

      expect(Database.run).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO recurring_donation_logs'),
        expect.arrayContaining([1, 'SUCCESS', 'tx123', null, expect.any(String)])
      );
    });

    test('should log failed execution with error details', async () => {
      const schedule = {
        id: 1,
        donorId: 1,
        recipientId: 2,
        amount: 100,
        frequency: 'daily',
        donorPublicKey: 'GDONOR',
        recipientPublicKey: 'GRECIPIENT',
        lastExecutionDate: null
      };

      mockStellarService.sendPayment.mockRejectedValue(new Error('Network timeout'));
      Database.run.mockResolvedValue({});

      try {
        await scheduler.executeSchedule(schedule);
      } catch (error) {
        // Expected to throw
      }

      expect(Database.run).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO recurring_donation_logs'),
        expect.arrayContaining([1, 'FAILED', null, 'Network timeout', expect.any(String)])
      );
    });

    test('should create logs table if it does not exist', async () => {
      const schedule = {
        id: 1,
        donorId: 1,
        recipientId: 2,
        amount: 100,
        frequency: 'daily',
        donorPublicKey: 'GDONOR',
        recipientPublicKey: 'GRECIPIENT',
        lastExecutionDate: null
      };

      mockStellarService.sendPayment.mockResolvedValue({ hash: 'tx123' });
      Database.run.mockResolvedValue({});

      await scheduler.executeSchedule(schedule);

      expect(Database.run).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS recurring_donation_logs')
      );
    });
  });

  describe('Backoff Calculation with Jitter', () => {
    test('should calculate exponential backoff with proper timing', () => {
      const backoff1 = scheduler.calculateBackoff(1);
      const backoff2 = scheduler.calculateBackoff(2);
      const backoff3 = scheduler.calculateBackoff(3);

      // First attempt: ~100ms
      expect(backoff1).toBeGreaterThanOrEqual(100);
      expect(backoff1).toBeLessThanOrEqual(130);

      // Second attempt: ~200ms
      expect(backoff2).toBeGreaterThanOrEqual(200);
      expect(backoff2).toBeLessThanOrEqual(260);

      // Third attempt: ~400ms
      expect(backoff3).toBeGreaterThanOrEqual(400);
      expect(backoff3).toBeLessThanOrEqual(520);
    });

    test('should not exceed maxBackoffMs', () => {
      scheduler.maxBackoffMs = 500;
      
      const backoff = scheduler.calculateBackoff(10); // Very high attempt number
      
      expect(backoff).toBeLessThanOrEqual(650); // 500 + 30% jitter
    });

    test('should add jitter to prevent thundering herd', () => {
      const backoffs = [];
      for (let i = 0; i < 10; i++) {
        backoffs.push(scheduler.calculateBackoff(1));
      }

      // All backoffs should be different due to jitter
      const uniqueBackoffs = new Set(backoffs);
      expect(uniqueBackoffs.size).toBeGreaterThan(1);
    });
  });

  describe('Schedule Processing and Batch Execution', () => {
    test('should process multiple schedules concurrently without blocking', async () => {
      const schedules = [
        {
          id: 1,
          donorId: 1,
          recipientId: 2,
          amount: 100,
          frequency: 'daily',
          donorPublicKey: 'GDONOR1',
          recipientPublicKey: 'GRECIPIENT1',
          lastExecutionDate: null
        },
        {
          id: 2,
          donorId: 3,
          recipientId: 4,
          amount: 200,
          frequency: 'weekly',
          donorPublicKey: 'GDONOR2',
          recipientPublicKey: 'GRECIPIENT2',
          lastExecutionDate: null
        }
      ];

      Database.query.mockResolvedValue(schedules);
      mockStellarService.sendPayment.mockResolvedValue({ hash: 'tx123' });
      Database.run.mockResolvedValue({});
      scheduler.logExecution = jest.fn().mockResolvedValue();

      scheduler.isRunning = true;
      await scheduler.processSchedules();

      expect(mockStellarService.sendPayment).toHaveBeenCalledTimes(2);
    });

    test('should skip schedules already being executed', async () => {
      const schedules = [
        {
          id: 1,
          donorId: 1,
          recipientId: 2,
          amount: 100,
          frequency: 'daily',
          donorPublicKey: 'GDONOR1',
          recipientPublicKey: 'GRECIPIENT1',
          lastExecutionDate: null
        },
        {
          id: 2,
          donorId: 3,
          recipientId: 4,
          amount: 200,
          frequency: 'weekly',
          donorPublicKey: 'GDONOR2',
          recipientPublicKey: 'GRECIPIENT2',
          lastExecutionDate: null
        }
      ];

      // Mark schedule 1 as executing
      scheduler.executingSchedules.add(1);

      Database.query.mockResolvedValue(schedules);
      mockStellarService.sendPayment.mockResolvedValue({ hash: 'tx123' });
      Database.run.mockResolvedValue({});
      scheduler.logExecution = jest.fn().mockResolvedValue();

      scheduler.isRunning = true;
      await scheduler.processSchedules();

      // Should only execute schedule 2
      expect(mockStellarService.sendPayment).toHaveBeenCalledTimes(1);
      expect(mockStellarService.sendPayment).toHaveBeenCalledWith(
        'GDONOR2',
        'GRECIPIENT2',
        200,
        expect.any(String)
      );
    });

    test('should handle errors gracefully and continue processing', async () => {
      const schedules = [
        {
          id: 1,
          donorId: 1,
          recipientId: 2,
          amount: 100,
          frequency: 'daily',
          donorPublicKey: 'GDONOR1',
          recipientPublicKey: 'GRECIPIENT1',
          lastExecutionDate: null
        },
        {
          id: 2,
          donorId: 3,
          recipientId: 4,
          amount: 200,
          frequency: 'weekly',
          donorPublicKey: 'GDONOR2',
          recipientPublicKey: 'GRECIPIENT2',
          lastExecutionDate: null
        }
      ];

      Database.query.mockResolvedValue(schedules);
      
      // First schedule fails all 3 attempts, second succeeds eventually
      mockStellarService.sendPayment
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValue({ hash: 'tx123' }); // All subsequent calls succeed
      
      Database.run.mockResolvedValue({});
      scheduler.logExecution = jest.fn().mockResolvedValue();
      scheduler.handleFailedExecution = jest.fn().mockResolvedValue();

      scheduler.isRunning = true;
      await scheduler.processSchedules();

      // Both schedules should be attempted
      // First schedule: 3 failed attempts
      // Second schedule: at least 1 successful attempt
      expect(mockStellarService.sendPayment).toHaveBeenCalledTimes(4);
      
      // Verify first schedule failed
      expect(scheduler.handleFailedExecution).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1 }),
        expect.any(Error)
      );
      
      // Verify second schedule succeeded
      expect(scheduler.logExecution).toHaveBeenCalledWith(
        2,
        'SUCCESS',
        'tx123'
      );
    });
  });

  describe('Status Monitoring and Reporting', () => {
    test('should return accurate scheduler status with metrics', () => {
      scheduler.isRunning = true;
      scheduler.executingSchedules.add(1);
      scheduler.executingSchedules.add(2);

      const status = scheduler.getStatus();

      expect(status).toEqual({
        isRunning: true,
        checkInterval: 60000,
        maxRetries: 3,
        executingSchedules: [1, 2]
      });
    });

    test('should get execution logs for a schedule', async () => {
      const logs = [
        { id: 1, scheduleId: 1, status: 'SUCCESS', timestamp: '2024-02-20T10:00:00Z' },
        { id: 2, scheduleId: 1, status: 'FAILED', timestamp: '2024-02-20T09:00:00Z' }
      ];

      Database.query.mockResolvedValue(logs);

      const result = await scheduler.getExecutionLogs(1, 10);

      expect(result).toEqual(logs);
      expect(Database.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM recurring_donation_logs'),
        [1, 10]
      );
    });

    test('should get recent failures', async () => {
      const failures = [
        { id: 1, scheduleId: 1, status: 'FAILED', errorMessage: 'Network timeout' },
        { id: 2, scheduleId: 2, status: 'FAILED', errorMessage: 'Stellar unavailable' }
      ];

      Database.query.mockResolvedValue(failures);

      const result = await scheduler.getRecentFailures(20);

      expect(result).toEqual(failures);
      expect(Database.query).toHaveBeenCalledWith(
        expect.stringContaining("WHERE rdl.status = 'FAILED'"),
        [20]
      );
    });
  });
});
