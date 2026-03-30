/**
 * Recurring Donation Scheduling – Flexible Intervals
 *
 * Tests: scheduling accuracy, retry logic, failure notifications,
 *        API endpoints, edge cases, and validation errors.
 * No live Stellar network required (MockStellarService used throughout).
 */

'use strict';

const request = require('supertest');
// RecurringDonationScheduler, MockStellarService, WebhookService, constants
// are required AFTER mocks below

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../src/utils/log', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

jest.mock('../src/utils/correlation', () => ({
  withBackgroundContext: (_n, fn) => fn(),
  withAsyncContext: (_n, fn, _ctx) => fn(),
  getCorrelationSummary: () => ({ correlationId: 'test-corr', traceId: 'test-trace' }),
}));

jest.mock('../src/utils/database');
const Database = require('../src/utils/database');

jest.mock('../src/services/WebhookService', () => ({
  sendFailureNotification: jest.fn().mockResolvedValue({ delivered: true, statusCode: 200 }),
}));

// Require these AFTER mocks are set up
const RecurringDonationScheduler = require('../src/services/RecurringDonationScheduler');
const MockStellarService = require('../src/services/MockStellarService');
const WebhookService = require('../src/services/WebhookService');
const { DONATION_FREQUENCIES, SCHEDULE_STATUS } = require('../src/constants');

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSchedule(overrides = {}) {
  return {
    id: 1,
    donorId: 10,
    recipientId: 20,
    amount: '5.00',
    frequency: 'daily',
    customIntervalDays: null,
    maxExecutions: null,
    webhookUrl: null,
    failureCount: 0,
    executionCount: 0,
    lastExecutionDate: null,
    nextExecutionDate: new Date(Date.now() - 1000).toISOString(),
    donorPublicKey: 'GDONOR1234567890123456789012345678901234567890123456',
    recipientPublicKey: 'GRECIP1234567890123456789012345678901234567890123456',
    ...overrides,
  };
}

function makeScheduler(stellarOverrides = {}) {
  const stellar = new MockStellarService();
  Object.assign(stellar, stellarOverrides);
  return new RecurringDonationScheduler(stellar);
}


// ═════════════════════════════════════════════════════════════════════════════
// 1. calculateNextExecutionDate
// ═════════════════════════════════════════════════════════════════════════════

describe('calculateNextExecutionDate', () => {
  let scheduler;
  const base = new Date('2026-01-15T12:00:00.000Z');

  beforeEach(() => { scheduler = makeScheduler(); });

  test('daily adds 1 day', () => {
    const next = scheduler.calculateNextExecutionDate(base, 'daily');
    expect(next.toISOString()).toBe('2026-01-16T12:00:00.000Z');
  });

  test('weekly adds 7 days', () => {
    const next = scheduler.calculateNextExecutionDate(base, 'weekly');
    expect(next.toISOString()).toBe('2026-01-22T12:00:00.000Z');
  });

  test('monthly advances month', () => {
    const next = scheduler.calculateNextExecutionDate(base, 'monthly');
    expect(next.getMonth()).toBe(1); // February
    expect(next.getDate()).toBe(15);
  });

  test('custom adds specified days', () => {
    const next = scheduler.calculateNextExecutionDate(base, 'custom', 10);
    expect(next.toISOString()).toBe('2026-01-25T12:00:00.000Z');
  });

  test('custom with 1 day', () => {
    const next = scheduler.calculateNextExecutionDate(base, 'custom', 1);
    expect(next.toISOString()).toBe('2026-01-16T12:00:00.000Z');
  });

  test('custom throws when customIntervalDays missing', () => {
    expect(() => scheduler.calculateNextExecutionDate(base, 'custom')).toThrow();
  });

  test('custom throws when customIntervalDays < 1', () => {
    expect(() => scheduler.calculateNextExecutionDate(base, 'custom', 0)).toThrow();
  });

  test('invalid frequency throws', () => {
    expect(() => scheduler.calculateNextExecutionDate(base, 'hourly')).toThrow('Invalid frequency');
  });

  test('case-insensitive frequency', () => {
    const next = scheduler.calculateNextExecutionDate(base, 'DAILY');
    expect(next.toISOString()).toBe('2026-01-16T12:00:00.000Z');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Retry logic & backoff
// ═════════════════════════════════════════════════════════════════════════════

describe('Retry logic', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-02-01T10:00:00.000Z'));
    Database.query.mockResolvedValue([]);
    Database.run.mockResolvedValue({ id: 1, changes: 1 });
    Database.get.mockResolvedValue(null);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  test('succeeds on first attempt without retrying', async () => {
    const scheduler = makeScheduler();
    scheduler.executeSchedule = jest.fn().mockResolvedValue();
    scheduler.sleep = jest.fn().mockResolvedValue();

    await scheduler.executeScheduleWithRetry(makeSchedule());

    expect(scheduler.executeSchedule).toHaveBeenCalledTimes(1);
    expect(scheduler.sleep).not.toHaveBeenCalled();
  });

  test('retries up to maxRetries on failure then calls handlePersistentFailure', async () => {
    const scheduler = makeScheduler();
    scheduler.executeSchedule = jest.fn().mockRejectedValue(new Error('network error'));
    scheduler.sleep = jest.fn().mockResolvedValue();
    scheduler.handlePersistentFailure = jest.fn().mockResolvedValue();

    await scheduler.executeScheduleWithRetry(makeSchedule());

    expect(scheduler.executeSchedule).toHaveBeenCalledTimes(3);
    expect(scheduler.handlePersistentFailure).toHaveBeenCalledTimes(1);
  });

  test('succeeds on second attempt', async () => {
    const scheduler = makeScheduler();
    scheduler.executeSchedule = jest.fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce();
    scheduler.sleep = jest.fn().mockResolvedValue();
    scheduler.handlePersistentFailure = jest.fn();

    await scheduler.executeScheduleWithRetry(makeSchedule());

    expect(scheduler.executeSchedule).toHaveBeenCalledTimes(2);
    expect(scheduler.handlePersistentFailure).not.toHaveBeenCalled();
  });

  test('calculateBackoff returns value within expected range', () => {
    const scheduler = makeScheduler();
    const delay = scheduler.calculateBackoff(1);
    expect(delay).toBeGreaterThanOrEqual(1000);
    expect(delay).toBeLessThanOrEqual(1300); // 1000 + 30% jitter
  });

  test('backoff increases with attempt number', () => {
    const scheduler = makeScheduler();
    // Use deterministic jitter by mocking Math.random
    jest.spyOn(Math, 'random').mockReturnValue(0);
    expect(scheduler.calculateBackoff(1)).toBe(1000);
    expect(scheduler.calculateBackoff(2)).toBe(2000);
    expect(scheduler.calculateBackoff(3)).toBe(4000);
    jest.spyOn(Math, 'random').mockRestore();
  });

  test('backoff is capped at maxBackoffMs', () => {
    const scheduler = makeScheduler();
    jest.spyOn(Math, 'random').mockReturnValue(0);
    expect(scheduler.calculateBackoff(10)).toBe(30000);
    jest.spyOn(Math, 'random').mockRestore();
  });

  test('duplicate execution is prevented', async () => {
    const scheduler = makeScheduler();
    const schedule = makeSchedule();
    scheduler.executingSchedules.add(schedule.id);
    scheduler.executeSchedule = jest.fn();

    await scheduler.executeScheduleWithRetry(schedule);

    expect(scheduler.executeSchedule).not.toHaveBeenCalled();
  });
});


// ═════════════════════════════════════════════════════════════════════════════
// 3. executeSchedule – success path
// ═════════════════════════════════════════════════════════════════════════════

describe('executeSchedule – success', () => {
  beforeEach(() => {
    Database.run.mockResolvedValue({ id: 99, changes: 1 });
    Database.get.mockResolvedValue(null);
    Database.query.mockResolvedValue([]);
  });

  afterEach(() => jest.clearAllMocks());

  test('calls sendPayment with correct args', async () => {
    const stellar = new MockStellarService();
    stellar.sendPayment = jest.fn().mockResolvedValue({ hash: 'abc123', ledger: 1 });
    const scheduler = new RecurringDonationScheduler(stellar);
    const schedule = makeSchedule();

    await scheduler.executeSchedule(schedule);

    expect(stellar.sendPayment).toHaveBeenCalledWith(
      schedule.donorPublicKey,
      schedule.recipientPublicKey,
      schedule.amount,
      expect.stringContaining(`Schedule #${schedule.id}`)
    );
  });

  test('inserts transaction record', async () => {
    const stellar = new MockStellarService();
    stellar.sendPayment = jest.fn().mockResolvedValue({ hash: 'tx1', ledger: 1 });
    const scheduler = new RecurringDonationScheduler(stellar);

    await scheduler.executeSchedule(makeSchedule());

    const allSqls = Database.run.mock.calls.map(c => c[0]);
    const hasInsert = allSqls.some(sql =>
      typeof sql === 'string' && sql.toUpperCase().includes('INSERT')
    );
    expect(hasInsert).toBe(true);
  });

  test('updates schedule with new nextExecutionDate', async () => {
    const stellar = new MockStellarService();
    stellar.sendPayment = jest.fn().mockResolvedValue({ hash: 'tx2', ledger: 1 });
    const scheduler = new RecurringDonationScheduler(stellar);

    await scheduler.executeSchedule(makeSchedule());

    const updateCall = Database.run.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('UPDATE recurring_donations')
    );
    expect(updateCall).toBeDefined();
  });

  test('marks schedule completed when maxExecutions reached', async () => {
    const stellar = new MockStellarService();
    stellar.sendPayment = jest.fn().mockResolvedValue({ hash: 'tx3', ledger: 1 });
    const scheduler = new RecurringDonationScheduler(stellar);
    const schedule = makeSchedule({ maxExecutions: 3, executionCount: 2 });

    await scheduler.executeSchedule(schedule);

    const updateCall = Database.run.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('UPDATE recurring_donations')
    );
    expect(updateCall[1]).toContain(SCHEDULE_STATUS.COMPLETED);
  });

  test('keeps schedule active when maxExecutions not reached', async () => {
    const stellar = new MockStellarService();
    stellar.sendPayment = jest.fn().mockResolvedValue({ hash: 'tx4', ledger: 1 });
    const scheduler = new RecurringDonationScheduler(stellar);
    const schedule = makeSchedule({ maxExecutions: 5, executionCount: 2 });

    await scheduler.executeSchedule(schedule);

    const updateCall = Database.run.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('UPDATE recurring_donations')
    );
    expect(updateCall[1]).toContain(SCHEDULE_STATUS.ACTIVE);
  });

  test('resets failureCount to 0 on success', async () => {
    const stellar = new MockStellarService();
    stellar.sendPayment = jest.fn().mockResolvedValue({ hash: 'tx5', ledger: 1 });
    const scheduler = new RecurringDonationScheduler(stellar);
    const schedule = makeSchedule({ failureCount: 2 });

    await scheduler.executeSchedule(schedule);

    // failureCount = 0 is hardcoded in the SQL string, not a parameter
    const updateCall = Database.run.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('UPDATE recurring_donations')
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[0]).toContain('failureCount');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. executeSchedule – failure path
// ═════════════════════════════════════════════════════════════════════════════

describe('executeSchedule – failure', () => {
  afterEach(() => jest.clearAllMocks());

  test('throws when sendPayment fails', async () => {
    const stellar = new MockStellarService();
    stellar.sendPayment = jest.fn().mockRejectedValue(new Error('Stellar down'));
    Database.run.mockResolvedValue({ id: 1, changes: 1 });
    const scheduler = new RecurringDonationScheduler(stellar);

    await expect(scheduler.executeSchedule(makeSchedule())).rejects.toThrow('Stellar down');
  });

  test('logs FAILED execution on error', async () => {
    const stellar = new MockStellarService();
    stellar.sendPayment = jest.fn().mockRejectedValue(new Error('fail'));
    Database.run.mockResolvedValue({ id: 1, changes: 1 });
    const scheduler = new RecurringDonationScheduler(stellar);
    scheduler.logExecution = jest.fn().mockResolvedValue();

    await expect(scheduler.executeSchedule(makeSchedule())).rejects.toThrow();
    expect(scheduler.logExecution).toHaveBeenCalledWith(
      expect.any(Number), 'FAILED', null, expect.any(String), 1
    );
  });
});


// ═════════════════════════════════════════════════════════════════════════════
// 5. handlePersistentFailure & webhook notifications
// ═════════════════════════════════════════════════════════════════════════════

describe('handlePersistentFailure', () => {
  beforeEach(() => {
    Database.run.mockResolvedValue({ id: 1, changes: 1 });
    WebhookService.sendFailureNotification.mockResolvedValue({ delivered: true, statusCode: 200 });
  });

  afterEach(() => jest.clearAllMocks());

  test('increments failureCount in DB', async () => {
    const scheduler = makeScheduler();
    scheduler.logExecution = jest.fn().mockResolvedValue();
    const schedule = makeSchedule({ failureCount: 1 });

    await scheduler.handlePersistentFailure(schedule, new Error('boom'));

    const updateCall = Database.run.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('UPDATE recurring_donations')
    );
    expect(updateCall[1][0]).toBe(2); // failureCount incremented
  });

  test('sends webhook when webhookUrl is set', async () => {
    const scheduler = makeScheduler();
    scheduler.logExecution = jest.fn().mockResolvedValue();
    const schedule = makeSchedule({ webhookUrl: 'https://example.com/hook' });

    await scheduler.handlePersistentFailure(schedule, new Error('network'));

    expect(WebhookService.sendFailureNotification).toHaveBeenCalledWith(
      'https://example.com/hook',
      expect.objectContaining({
        scheduleId: schedule.id,
        errorMessage: 'network',
      })
    );
  });

  test('does NOT send webhook when webhookUrl is null', async () => {
    const scheduler = makeScheduler();
    scheduler.logExecution = jest.fn().mockResolvedValue();

    await scheduler.handlePersistentFailure(makeSchedule({ webhookUrl: null }), new Error('x'));

    expect(WebhookService.sendFailureNotification).not.toHaveBeenCalled();
  });

  test('webhook payload contains all required fields', async () => {
    const scheduler = makeScheduler();
    scheduler.logExecution = jest.fn().mockResolvedValue();
    const schedule = makeSchedule({ webhookUrl: 'https://hook.test/notify', failureCount: 2 });

    await scheduler.handlePersistentFailure(schedule, new Error('err'));

    const [, payload] = WebhookService.sendFailureNotification.mock.calls[0];
    expect(payload).toMatchObject({
      scheduleId: schedule.id,
      donorPublicKey: schedule.donorPublicKey,
      recipientPublicKey: schedule.recipientPublicKey,
      amount: String(schedule.amount),
      frequency: schedule.frequency,
      failureCount: 3,
    });
    expect(payload.timestamp).toBeDefined();
  });

  test('continues gracefully when webhook delivery fails', async () => {
    WebhookService.sendFailureNotification.mockResolvedValue({ delivered: false, error: 'timeout' });
    const scheduler = makeScheduler();
    scheduler.logExecution = jest.fn().mockResolvedValue();
    const schedule = makeSchedule({ webhookUrl: 'https://bad.host/hook' });

    await expect(
      scheduler.handlePersistentFailure(schedule, new Error('err'))
    ).resolves.not.toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. WebhookService unit tests
// ═════════════════════════════════════════════════════════════════════════════

describe('WebhookService', () => {
  // Use the real WebhookService (not mocked) for these tests
  let RealWebhookService;

  beforeAll(() => {
    // Get the real module by bypassing the mock
    jest.isolateModules(() => {
      RealWebhookService = require('../src/services/WebhookService');
    });
  });

  test('returns error for invalid URL', async () => {
    const result = await RealWebhookService.sendFailureNotification('not-a-url', { scheduleId: 1 });
    expect(result.delivered).toBe(false);
    expect(result.error).toBeDefined();
  });

  test('returns error when no URL provided', async () => {
    const result = await RealWebhookService.sendFailureNotification(null, { scheduleId: 1 });
    expect(result.delivered).toBe(false);
  });
});


// ═════════════════════════════════════════════════════════════════════════════
// 7. processSchedules
// ═════════════════════════════════════════════════════════════════════════════

describe('processSchedules', () => {
  afterEach(() => jest.clearAllMocks());

  test('does nothing when scheduler is not running', async () => {
    const scheduler = makeScheduler();
    // isRunning defaults to false
    await scheduler.processSchedules();
    expect(Database.query).not.toHaveBeenCalled();
  });

  test('queries only ACTIVE schedules due now', async () => {
    const scheduler = makeScheduler();
    scheduler.isRunning = true;
    Database.query.mockResolvedValue([]);

    await scheduler.processSchedules();

    expect(Database.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE rd.status = ?'),
      expect.arrayContaining([SCHEDULE_STATUS.ACTIVE])
    );
  });

  test('skips schedules already executing', async () => {
    const scheduler = makeScheduler();
    scheduler.isRunning = true;
    const schedule = makeSchedule();
    scheduler.executingSchedules.add(schedule.id);
    Database.query.mockResolvedValue([schedule]);
    scheduler.executeScheduleWithRetry = jest.fn();

    await scheduler.processSchedules();

    expect(scheduler.executeScheduleWithRetry).not.toHaveBeenCalled();
  });

  test('executes all due schedules concurrently', async () => {
    const scheduler = makeScheduler();
    scheduler.isRunning = true;
    const schedules = [makeSchedule({ id: 1 }), makeSchedule({ id: 2 })];
    Database.query.mockResolvedValue(schedules);
    scheduler.executeScheduleWithRetry = jest.fn().mockResolvedValue();

    await scheduler.processSchedules();

    expect(scheduler.executeScheduleWithRetry).toHaveBeenCalledTimes(2);
  });

  test('handles DB error gracefully without throwing', async () => {
    const scheduler = makeScheduler();
    scheduler.isRunning = true;
    Database.query.mockRejectedValue(new Error('DB down'));

    await expect(scheduler.processSchedules()).resolves.not.toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. Scheduler lifecycle
// ═════════════════════════════════════════════════════════════════════════════

describe('Scheduler lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    Database.query.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  test('start sets isRunning to true', () => {
    const scheduler = makeScheduler();
    scheduler.processSchedules = jest.fn();
    scheduler.start();
    expect(scheduler.isRunning).toBe(true);
    scheduler.stop();
  });

  test('start is idempotent', () => {
    const scheduler = makeScheduler();
    scheduler.processSchedules = jest.fn();
    scheduler.start();
    scheduler.start();
    expect(scheduler.processSchedules).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  test('stop sets isRunning to false', () => {
    const scheduler = makeScheduler();
    scheduler.processSchedules = jest.fn();
    scheduler.start();
    scheduler.stop();
    expect(scheduler.isRunning).toBe(false);
  });

  test('stop is idempotent', () => {
    const scheduler = makeScheduler();
    expect(() => scheduler.stop()).not.toThrow();
  });

  test('processSchedules fires on each interval tick', () => {
    const scheduler = makeScheduler();
    scheduler.processSchedules = jest.fn();
    scheduler.checkInterval = 60_000;
    scheduler.start();
    expect(scheduler.processSchedules).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(180_000);
    expect(scheduler.processSchedules).toHaveBeenCalledTimes(4);
    scheduler.stop();
  });

  test('constructor throws without stellarService', () => {
    expect(() => new RecurringDonationScheduler(null)).toThrow('stellarService is required');
  });
});


// ═════════════════════════════════════════════════════════════════════════════
// 9. wasRecentlyExecuted
// ═════════════════════════════════════════════════════════════════════════════

describe('wasRecentlyExecuted', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-02-01T10:00:00.000Z')));
  afterEach(() => jest.useRealTimers());

  test('returns false when lastExecutionDate is null', async () => {
    const scheduler = makeScheduler();
    expect(await scheduler.wasRecentlyExecuted(makeSchedule({ lastExecutionDate: null }))).toBe(false);
  });

  test('returns true within 5-minute window', async () => {
    const scheduler = makeScheduler();
    const recent = new Date(Date.now() - 4 * 60 * 1000).toISOString();
    expect(await scheduler.wasRecentlyExecuted(makeSchedule({ lastExecutionDate: recent }))).toBe(true);
  });

  test('returns false outside 5-minute window', async () => {
    const scheduler = makeScheduler();
    const old = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    expect(await scheduler.wasRecentlyExecuted(makeSchedule({ lastExecutionDate: old }))).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 10. getExecutionLogs / getRecentFailures
// ═════════════════════════════════════════════════════════════════════════════

describe('getExecutionLogs and getRecentFailures', () => {
  afterEach(() => jest.clearAllMocks());

  test('getExecutionLogs returns logs for schedule', async () => {
    const mockLogs = [{ id: 1, scheduleId: 1, status: 'SUCCESS' }];
    Database.query.mockResolvedValue(mockLogs);
    const scheduler = makeScheduler();

    const result = await scheduler.getExecutionLogs(1);
    expect(result).toEqual(mockLogs);
  });

  test('getExecutionLogs returns [] on DB error', async () => {
    Database.query.mockRejectedValue(new Error('DB error'));
    const scheduler = makeScheduler();

    const result = await scheduler.getExecutionLogs(1);
    expect(result).toEqual([]);
  });

  test('getRecentFailures returns failed logs', async () => {
    const mockFailures = [{ id: 2, status: 'FAILED', amount: '10', frequency: 'daily' }];
    Database.query.mockResolvedValue(mockFailures);
    const scheduler = makeScheduler();

    const result = await scheduler.getRecentFailures();
    expect(result).toEqual(mockFailures);
  });

  test('getRecentFailures returns [] on DB error', async () => {
    Database.query.mockRejectedValue(new Error('DB error'));
    const scheduler = makeScheduler();

    const result = await scheduler.getRecentFailures();
    expect(result).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 11. API Routes – POST /donations/recurring
// ═════════════════════════════════════════════════════════════════════════════

// Mock heavy middleware dependencies for route tests
jest.mock('../src/middleware/rbac', () => ({
  checkPermission: () => (req, res, next) => next(),
  requireAdmin: () => (req, res, next) => next(),
  attachUserRole: () => (req, res, next) => { req.user = { role: 'admin' }; next(); },
}));
jest.mock('../src/config/serviceContainer', () => ({
  getRecurringDonationScheduler: () => ({
    calculateNextExecutionDate: (date, freq, days) => {
      const next = new Date(date);
      if (freq === 'custom') next.setDate(next.getDate() + (days || 1));
      else if (freq === 'daily') next.setDate(next.getDate() + 1);
      else if (freq === 'weekly') next.setDate(next.getDate() + 7);
      else next.setMonth(next.getMonth() + 1);
      return next;
    },
  }),
  getStellarService: () => ({}),
  getTransactionReconciliationService: () => ({ start: jest.fn(), stop: jest.fn(), getStatus: jest.fn() }),
}));

describe('POST /donations/recurring', () => {
  let app;

  beforeAll(() => {
    // Build a minimal Express app with the recurring routes
    const express = require('express');
    const recurringRoutes = require('../src/routes/recurringDonation');
    app = express();
    app.use(express.json());
    // Bypass auth for route tests
    app.use((req, _res, next) => { req.user = { role: 'admin' }; next(); });
    app.use('/donations/recurring', recurringRoutes);
    // Error handler for debugging
    app.use((err, req, res, _next) => {
      res.status(err.status || 500).json({ success: false, error: err.message });
    });
  });

  beforeEach(() => {
    Database.get.mockImplementation(async (sql, params) => {
      if (sql && sql.includes('users') && params && params[0] && typeof params[0] === 'string' && params[0].startsWith('G')) {
        const isRecipient = params[0] === 'GRECIP1234567890123456789012345678901234567890123456';
        return { id: isRecipient ? 20 : 10, publicKey: params[0] };
      }
      if (sql && sql.includes('recurring_donations')) {
        return {
          id: 1, amount: 5, frequency: 'daily', customIntervalDays: null,
          maxExecutions: null, webhookUrl: null, nextExecutionDate: new Date().toISOString(),
          status: 'active', executionCount: 0, failureCount: 0,
          donorPublicKey: 'GDONOR1234567890123456789012345678901234567890123456',
          recipientPublicKey: 'GRECIP1234567890123456789012345678901234567890123456',
        };
      }
      return null;
    });
    Database.run.mockResolvedValue({ id: 1, changes: 1 });
  });

  afterEach(() => jest.clearAllMocks());

  test('201 on valid daily schedule', async () => {
    const res = await request(app)
      .post('/donations/recurring')
      .send({
        donorPublicKey: 'GDONOR1234567890123456789012345678901234567890123456',
        recipientPublicKey: 'GRECIP1234567890123456789012345678901234567890123456',
        amount: '5.00',
        frequency: 'daily',
      });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.frequency).toBe('daily');
  });

  test('201 on valid custom schedule', async () => {
    const res = await request(app)
      .post('/donations/recurring')
      .send({
        donorPublicKey: 'GDONOR1234567890123456789012345678901234567890123456',
        recipientPublicKey: 'GRECIP1234567890123456789012345678901234567890123456',
        amount: '10',
        frequency: 'custom',
        customIntervalDays: 14,
      });
    expect(res.status).toBe(201);
  });

  test('400 when amount missing', async () => {
    const res = await request(app)
      .post('/donations/recurring')
      .send({
        donorPublicKey: 'GDONOR1234567890123456789012345678901234567890123456',
        recipientPublicKey: 'GRECIP1234567890123456789012345678901234567890123456',
        frequency: 'daily',
      });
    expect(res.status).toBe(400);
  });

  test('400 for invalid frequency', async () => {
    const res = await request(app)
      .post('/donations/recurring')
      .send({
        donorPublicKey: 'GDONOR1234567890123456789012345678901234567890123456',
        recipientPublicKey: 'GRECIP1234567890123456789012345678901234567890123456',
        amount: '5',
        frequency: 'hourly',
      });
    expect(res.status).toBe(400);
  });

  test('400 for custom frequency without customIntervalDays', async () => {
    const res = await request(app)
      .post('/donations/recurring')
      .send({
        donorPublicKey: 'GDONOR1234567890123456789012345678901234567890123456',
        recipientPublicKey: 'GRECIP1234567890123456789012345678901234567890123456',
        amount: '5',
        frequency: 'custom',
      });
    expect(res.status).toBe(400);
  });

  test('400 for negative amount', async () => {
    const res = await request(app)
      .post('/donations/recurring')
      .send({
        donorPublicKey: 'GDONOR1234567890123456789012345678901234567890123456',
        recipientPublicKey: 'GRECIP1234567890123456789012345678901234567890123456',
        amount: '-5',
        frequency: 'daily',
      });
    expect(res.status).toBe(400);
  });

  test('404 when donor not found', async () => {
    Database.get.mockResolvedValue(null);
    const res = await request(app)
      .post('/donations/recurring')
      .send({
        donorPublicKey: 'GDONOR1234567890123456789012345678901234567890123456',
        recipientPublicKey: 'GRECIP1234567890123456789012345678901234567890123456',
        amount: '5',
        frequency: 'daily',
      });
    expect(res.status).toBe(404);
  });

  test('400 when donor === recipient', async () => {
    Database.get.mockResolvedValue({ id: 10, publicKey: 'GSAME1234567890123456789012345678901234567890123456' });
    const res = await request(app)
      .post('/donations/recurring')
      .send({
        donorPublicKey: 'GSAME1234567890123456789012345678901234567890123456',
        recipientPublicKey: 'GSAME1234567890123456789012345678901234567890123456',
        amount: '5',
        frequency: 'daily',
      });
    expect(res.status).toBe(400);
  });
});


// ═════════════════════════════════════════════════════════════════════════════
// 12. API Routes – GET /donations/recurring
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /donations/recurring', () => {
  let app;

  beforeAll(() => {
    const express = require('express');
    const recurringRoutes = require('../src/routes/recurringDonation');
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { role: 'admin' }; next(); });
    app.use('/donations/recurring', recurringRoutes);
  });

  afterEach(() => jest.clearAllMocks());

  test('200 returns list of schedules', async () => {
    Database.query.mockResolvedValue([
      { id: 1, amount: 5, frequency: 'daily', status: 'active', executionCount: 0, failureCount: 0,
        donorPublicKey: 'GDONOR', recipientPublicKey: 'GRECIP' },
    ]);
    const res = await request(app).get('/donations/recurring');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('200 with status filter', async () => {
    Database.query.mockResolvedValue([]);
    const res = await request(app).get('/donations/recurring?status=active');
    expect(res.status).toBe(200);
  });

  test('400 for invalid status filter', async () => {
    const res = await request(app).get('/donations/recurring?status=unknown');
    expect(res.status).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 13. API Routes – GET /donations/recurring/:id
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /donations/recurring/:id', () => {
  let app;

  beforeAll(() => {
    const express = require('express');
    const recurringRoutes = require('../src/routes/recurringDonation');
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { role: 'admin' }; next(); });
    app.use('/donations/recurring', recurringRoutes);
  });

  afterEach(() => jest.clearAllMocks());

  test('200 returns schedule', async () => {
    Database.get.mockResolvedValue({
      id: 1, amount: 5, frequency: 'daily', status: 'active', executionCount: 0, failureCount: 0,
      donorPublicKey: 'GDONOR', recipientPublicKey: 'GRECIP',
    });
    const res = await request(app).get('/donations/recurring/1');
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(1);
  });

  test('404 when schedule not found', async () => {
    Database.get.mockResolvedValue(null);
    const res = await request(app).get('/donations/recurring/999');
    expect(res.status).toBe(404);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 14. API Routes – DELETE /donations/recurring/:id
// ═════════════════════════════════════════════════════════════════════════════

describe('DELETE /donations/recurring/:id', () => {
  let app;

  beforeAll(() => {
    const express = require('express');
    const recurringRoutes = require('../src/routes/recurringDonation');
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { role: 'admin' }; next(); });
    app.use('/donations/recurring', recurringRoutes);
  });

  afterEach(() => jest.clearAllMocks());

  test('200 cancels active schedule', async () => {
    Database.get.mockResolvedValue({ id: 1, status: 'active' });
    Database.run.mockResolvedValue({ changes: 1 });
    const res = await request(app).delete('/donations/recurring/1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('404 when schedule not found', async () => {
    Database.get.mockResolvedValue(null);
    const res = await request(app).delete('/donations/recurring/999');
    expect(res.status).toBe(404);
  });

  test('409 when already cancelled', async () => {
    Database.get.mockResolvedValue({ id: 1, status: 'cancelled' });
    const res = await request(app).delete('/donations/recurring/1');
    expect(res.status).toBe(409);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 15. API Routes – GET /donations/recurring/:id/history
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /donations/recurring/:id/history', () => {
  let app;

  beforeAll(() => {
    const express = require('express');
    const recurringRoutes = require('../src/routes/recurringDonation');
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { role: 'admin' }; next(); });
    app.use('/donations/recurring', recurringRoutes);
  });

  afterEach(() => jest.clearAllMocks());

  test('200 returns execution history', async () => {
    Database.get.mockImplementation(async (sql) => {
      if (sql.includes('COUNT')) return { count: 2 };
      return { id: 1 };
    });
    Database.query.mockResolvedValue([
      { id: 1, scheduleId: 1, status: 'SUCCESS', timestamp: new Date().toISOString() },
      { id: 2, scheduleId: 1, status: 'FAILED', timestamp: new Date().toISOString() },
    ]);
    const res = await request(app).get('/donations/recurring/1/history');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.total).toBe(2);
  });

  test('404 when schedule not found', async () => {
    Database.get.mockResolvedValue(null);
    const res = await request(app).get('/donations/recurring/999/history');
    expect(res.status).toBe(404);
  });

  test('respects limit query param', async () => {
    Database.get.mockImplementation(async (sql) => {
      if (sql.includes('COUNT')) return { count: 0 };
      return { id: 1 };
    });
    Database.query.mockResolvedValue([]);
    const res = await request(app).get('/donations/recurring/1/history?limit=5');
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(5);
  });

  test('400 for invalid limit', async () => {
    Database.get.mockResolvedValue({ id: 1 });
    const res = await request(app).get('/donations/recurring/1/history?limit=0');
    expect(res.status).toBe(400);
  });
});

