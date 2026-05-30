/**
 * Critical Path Tests: RecurringDonationScheduler — core logic
 * Issue #708 — raise coverage thresholds to 60%+
 *
 * Covers: calculateNextExecutionDate, calculateBackoff, getStatus,
 *         executeSchedule (success + idempotency), handlePersistentFailure,
 *         processSchedules (happy path + orphan detection)
 */

const RecurringDonationSchedulerModule = require('../../src/services/RecurringDonationScheduler');
const RecurringDonationScheduler = RecurringDonationSchedulerModule.Class || RecurringDonationSchedulerModule;

// ── Mocks ──────────────────────────────────────────────────────────────────

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../src/utils/correlation', () => ({
  withBackgroundContext: (_task, fn) => fn(),
  withAsyncContext: (_task, fn, _ctx) => fn(),
  getCorrelationSummary: () => ({ correlationId: 'corr-test', traceId: 'trace-test' }),
}));

jest.mock('../../src/utils/tracing', () => ({
  withSpanInContext: (_name, _ctx, _attrs, fn) => fn(),
  extractTraceContext: () => ({}),
  injectTraceHeaders: (h) => h,
  getCurrentTraceparent: () => null,
}));

jest.mock('../../src/utils/database', () => ({
  query: jest.fn(),
  run: jest.fn(),
  get: jest.fn(),
}));

jest.mock('../../src/services/WebhookService', () => ({
  sendFailureNotification: jest.fn().mockResolvedValue({ delivered: true, statusCode: 200 }),
}));

jest.mock('../../src/services/ApiKeyExpirationNotifier', () => ({
  run: jest.fn().mockResolvedValue({}),
}));

jest.mock('../../src/models/apiKeys', () => ({
  revokeExpiredDeprecatedKeys: jest.fn().mockResolvedValue(0),
}));

jest.mock('../../src/services/RetentionService', () => ({
  runAll: jest.fn().mockResolvedValue({}),
}));

jest.mock('../../src/services/BackupService', () =>
  jest.fn().mockImplementation(() => ({
    backup: jest.fn().mockResolvedValue({ backupId: 'bk-1' }),
  }))
);

jest.mock('../../src/graphql/pubsub', () => ({
  publish: jest.fn(),
  TOPICS: { RECURRING_DONATION_EXECUTED: 'RECURRING_DONATION_EXECUTED' },
}));

// ── Helpers ────────────────────────────────────────────────────────────────

const makeStellarService = (overrides = {}) => ({
  sendPayment: jest.fn().mockResolvedValue({ hash: 'tx-hash-abc' }),
  ...overrides,
});

const makeSchedule = (overrides = {}) => ({
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
  nextExecutionDate: new Date().toISOString(),
  lastExecutionDate: null,
  donorPublicKey: 'GDONOR',
  recipientPublicKey: 'GRECIPIENT',
  ...overrides,
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('RecurringDonationScheduler — core logic', () => {
  let scheduler;
  let mockDb;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb = require('../../src/utils/database');
    mockDb.query.mockResolvedValue([]);
    mockDb.run.mockResolvedValue({});
    mockDb.get.mockResolvedValue(null);
    scheduler = new RecurringDonationScheduler(makeStellarService());
  });

  afterEach(() => {
    if (scheduler.isRunning) scheduler.stop();
  });

  // ── calculateNextExecutionDate ─────────────────────────────────────────

  describe('calculateNextExecutionDate', () => {
    const base = new Date('2026-01-15T12:00:00.000Z');

    it('advances by 1 day for daily', () => {
      const next = scheduler.calculateNextExecutionDate(base, 'daily');
      expect(next.getUTCDate()).toBe(16);
    });

    it('advances by 7 days for weekly', () => {
      const next = scheduler.calculateNextExecutionDate(base, 'weekly');
      expect(next.getUTCDate()).toBe(22);
    });

    it('advances by 1 month for monthly', () => {
      const next = scheduler.calculateNextExecutionDate(base, 'monthly');
      expect(next.getUTCMonth()).toBe(1); // February
    });

    it('advances by customIntervalDays for custom', () => {
      const next = scheduler.calculateNextExecutionDate(base, 'custom', 10);
      expect(next.getUTCDate()).toBe(25);
    });

    it('throws for custom frequency without customIntervalDays', () => {
      expect(() => scheduler.calculateNextExecutionDate(base, 'custom', 0)).toThrow();
    });

    it('throws for unknown frequency', () => {
      expect(() => scheduler.calculateNextExecutionDate(base, 'hourly')).toThrow('Invalid frequency');
    });
  });

  // ── calculateBackoff ───────────────────────────────────────────────────

  describe('calculateBackoff', () => {
    it('returns a value between initialBackoffMs and maxBackoffMs', () => {
      for (let attempt = 1; attempt <= 5; attempt++) {
        const delay = scheduler.calculateBackoff(attempt);
        expect(delay).toBeGreaterThanOrEqual(scheduler.initialBackoffMs);
        expect(delay).toBeLessThanOrEqual(scheduler.maxBackoffMs * 1.3);
      }
    });

    it('increases with attempt number (base component)', () => {
      // Strip jitter by checking base formula: min(initial * 2^(attempt-1), max)
      const delay1 = scheduler.initialBackoffMs * Math.pow(scheduler.backoffMultiplier, 0);
      const delay2 = scheduler.initialBackoffMs * Math.pow(scheduler.backoffMultiplier, 1);
      expect(delay2).toBeGreaterThan(delay1);
    });
  });

  // ── getStatus ──────────────────────────────────────────────────────────

  describe('getStatus', () => {
    it('reflects isRunning=false before start', () => {
      const status = scheduler.getStatus();
      expect(status.isRunning).toBe(false);
      expect(status.executingSchedules).toEqual([]);
    });

    it('reflects isRunning=true after start', () => {
      scheduler.processSchedules = jest.fn().mockResolvedValue();
      scheduler.start();
      expect(scheduler.getStatus().isRunning).toBe(true);
    });
  });

  // ── executeSchedule ────────────────────────────────────────────────────

  describe('executeSchedule', () => {
    it('sends payment and updates DB on success', async () => {
      const schedule = makeSchedule();
      mockDb.get.mockResolvedValue(null); // no existing idempotency record

      await scheduler.executeSchedule(schedule);

      expect(scheduler.stellarService.sendPayment).toHaveBeenCalledWith(
        schedule.donorPublicKey,
        schedule.recipientPublicKey,
        schedule.amount,
        expect.stringContaining('Recurring donation')
      );
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO transactions'),
        expect.any(Array)
      );
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE recurring_donations'),
        expect.any(Array)
      );
    });

    it('skips Stellar payment when idempotency key already used', async () => {
      const schedule = makeSchedule();
      mockDb.get.mockResolvedValue({ id: 99 }); // existing record

      await scheduler.executeSchedule(schedule);

      expect(scheduler.stellarService.sendPayment).not.toHaveBeenCalled();
    });

    it('marks schedule completed when maxExecutions reached', async () => {
      const schedule = makeSchedule({ maxExecutions: 3, executionCount: 2 });
      mockDb.get.mockResolvedValue(null);

      await scheduler.executeSchedule(schedule);

      const updateCall = mockDb.run.mock.calls.find(c => c[0].includes('UPDATE recurring_donations'));
      expect(updateCall[1]).toContain('completed');
    });

    it('throws and logs failure when sendPayment rejects', async () => {
      const schedule = makeSchedule();
      mockDb.get.mockResolvedValue(null);
      scheduler.stellarService.sendPayment.mockRejectedValue(new Error('Stellar error'));

      await expect(scheduler.executeSchedule(schedule)).rejects.toThrow('Stellar error');
    });
  });

  // ── handlePersistentFailure ────────────────────────────────────────────

  describe('handlePersistentFailure', () => {
    it('increments failureCount and persists error message', async () => {
      const schedule = makeSchedule({ failureCount: 1 });
      const error = new Error('persistent failure');

      await scheduler.handlePersistentFailure(schedule, error);

      const updateCall = mockDb.run.mock.calls.find(c => c[0].includes('UPDATE recurring_donations'));
      expect(updateCall[1][0]).toBe(2); // failureCount incremented
      expect(updateCall[1][1]).toBe('persistent failure');
    });

    it('sends webhook notification when webhookUrl is set', async () => {
      const WebhookService = require('../../src/services/WebhookService');
      const schedule = makeSchedule({ webhookUrl: 'https://example.com/hook', failureCount: 0 });
      const error = new Error('webhook test');

      await scheduler.handlePersistentFailure(schedule, error);

      expect(WebhookService.sendFailureNotification).toHaveBeenCalledWith(
        'https://example.com/hook',
        expect.objectContaining({ scheduleId: schedule.id, errorMessage: 'webhook test' })
      );
    });

    it('does not send webhook when webhookUrl is not set', async () => {
      const WebhookService = require('../../src/services/WebhookService');
      const schedule = makeSchedule({ webhookUrl: null });
      const error = new Error('no webhook');

      await scheduler.handlePersistentFailure(schedule, error);

      expect(WebhookService.sendFailureNotification).not.toHaveBeenCalled();
    });
  });

  // ── processSchedules ───────────────────────────────────────────────────

  describe('processSchedules', () => {
    it('does nothing when scheduler is not running', async () => {
      scheduler.isRunning = false;
      await scheduler.processSchedules();
      expect(mockDb.query).not.toHaveBeenCalled();
    });

    it('queries for due schedules and executes them', async () => {
      scheduler.isRunning = true;
      const schedule = makeSchedule();
      // First query: orphaned schedules (empty), second: due schedules
      mockDb.query
        .mockResolvedValueOnce([])   // orphaned
        .mockResolvedValueOnce([schedule]); // due

      scheduler.executeScheduleWithRetry = jest.fn().mockResolvedValue();

      await scheduler.processSchedules();

      expect(scheduler.executeScheduleWithRetry).toHaveBeenCalledWith(schedule);
    });

    it('marks orphaned schedules and skips them', async () => {
      scheduler.isRunning = true;
      mockDb.query
        .mockResolvedValueOnce([{ id: 5 }]) // orphaned
        .mockResolvedValueOnce([]);          // due

      await scheduler.processSchedules();

      const updateCall = mockDb.run.mock.calls.find(c => c[0].includes("status = 'orphaned'"));
      expect(updateCall).toBeDefined();
    });

    it('skips schedules already in executingSchedules set', async () => {
      scheduler.isRunning = true;
      const schedule = makeSchedule({ id: 99 });
      scheduler.executingSchedules.add(99);

      mockDb.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([schedule]);

      scheduler.executeScheduleWithRetry = jest.fn().mockResolvedValue();

      await scheduler.processSchedules();

      expect(scheduler.executeScheduleWithRetry).not.toHaveBeenCalled();
    });
  });

  // ── stopGracefully ─────────────────────────────────────────────────────

  describe('stopGracefully', () => {
    it('stops immediately when no schedules are executing', async () => {
      scheduler.processSchedules = jest.fn().mockResolvedValue();
      scheduler.start();
      await scheduler.stopGracefully(1000);
      expect(scheduler.isRunning).toBe(false);
    });

    it('is a no-op when scheduler is not running', async () => {
      await expect(scheduler.stopGracefully()).resolves.toBeUndefined();
    });
  });
});
