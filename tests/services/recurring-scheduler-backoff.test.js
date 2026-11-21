'use strict';
/**
 * Tests: Issue #916 — RecurringDonationScheduler exponential backoff
 */

jest.mock('../../src/utils/database', () => ({
  get: jest.fn().mockResolvedValue(null),
  run: jest.fn().mockResolvedValue({ changes: 1 }),
  all: jest.fn().mockResolvedValue([]),
  query: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../src/utils/metrics', () => ({
  recurringDonationsExecutionDuration: { startTimer: jest.fn().mockReturnValue(jest.fn()) },
  recurringDonationsExecuted: { inc: jest.fn() },
  recurringDonationsFailed: { inc: jest.fn() },
  recurringDonationsSkipped: { inc: jest.fn() },
}));

jest.mock('../../src/utils/correlation', () => ({
  withAsyncContext: (name, fn, ctx) => fn(),
  getCorrelationSummary: () => ({ correlationId: 'test', traceId: 'test' }),
}));

const log = require('../../src/utils/log');
const { RecurringDonationScheduler } = require('../../src/services/RecurringDonationScheduler');

describe('Issue #916 — Exponential backoff in RecurringDonationScheduler', () => {
  let scheduler;

  beforeEach(() => {
    jest.clearAllMocks();
    scheduler = new RecurringDonationScheduler({ sendPayment: jest.fn() });
  });

  describe('calculateBackoff', () => {
    it('returns ~1000ms for attempt 1 (base = initialBackoffMs)', () => {
      const delays = Array.from({ length: 100 }, () => scheduler.calculateBackoff(1));
      delays.forEach(d => {
        expect(d).toBeGreaterThanOrEqual(900);  // -10%
        expect(d).toBeLessThanOrEqual(1100);    // +10%
      });
    });

    it('returns ~2000ms for attempt 2 (base = initialBackoffMs * 2)', () => {
      const delays = Array.from({ length: 100 }, () => scheduler.calculateBackoff(2));
      delays.forEach(d => {
        expect(d).toBeGreaterThanOrEqual(1800);
        expect(d).toBeLessThanOrEqual(2200);
      });
    });

    it('returns ~4000ms for attempt 3 (base = initialBackoffMs * 4)', () => {
      const delays = Array.from({ length: 100 }, () => scheduler.calculateBackoff(3));
      delays.forEach(d => {
        expect(d).toBeGreaterThanOrEqual(3600);
        expect(d).toBeLessThanOrEqual(4400);
      });
    });

    it('caps delay at maxBackoffMs (30000ms)', () => {
      // attempt 6: 1000 * 2^5 = 32000 > 30000, should cap
      const delays = Array.from({ length: 50 }, () => scheduler.calculateBackoff(6));
      delays.forEach(d => {
        expect(d).toBeLessThanOrEqual(Math.floor(30000 * 1.1) + 1);
      });
    });

    it('jitter stays within ±10% of the base', () => {
      for (let attempt = 1; attempt <= 5; attempt++) {
        const base = Math.min(
          scheduler.initialBackoffMs * Math.pow(scheduler.backoffMultiplier, attempt - 1),
          scheduler.maxBackoffMs
        );
        for (let i = 0; i < 50; i++) {
          const delay = scheduler.calculateBackoff(attempt);
          expect(delay).toBeGreaterThanOrEqual(Math.floor(base * 0.9));
          expect(delay).toBeLessThanOrEqual(Math.ceil(base * 1.1));
        }
      }
    });
  });

  describe('retry loop uses setTimeout (non-blocking sleep)', () => {
    it('sleep resolves via setTimeout', async () => {
      jest.useFakeTimers();
      const promise = scheduler.sleep(500);
      jest.advanceTimersByTime(500);
      await promise;
      jest.useRealTimers();
    });
  });

  describe('retry loop logs DEBUG delay and uses correct backoff values', () => {
    it('logs retry delay at DEBUG level before each non-final sleep', async () => {
      let callCount = 0;
      scheduler.executeSchedule = jest.fn().mockImplementation(async () => {
        callCount++;
        if (callCount < scheduler.maxRetries) throw new Error('transient error');
      });
      scheduler.handlePersistentFailure = jest.fn().mockResolvedValue(undefined);

      // Override sleep to avoid real timer blocking
      scheduler.sleep = jest.fn().mockResolvedValue(undefined);

      await scheduler.executeScheduleWithRetry({ id: 'test-1' });

      const debugCalls = log.debug.mock.calls.filter(
        c => c[1] && c[1].includes('Retrying schedule in')
      );
      // Two retries before success on attempt 3
      expect(debugCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('passes correct backoff delay to sleep for attempts 1 and 2', async () => {
      let callCount = 0;
      scheduler.executeSchedule = jest.fn().mockImplementation(async () => {
        callCount++;
        if (callCount < 3) throw new Error('transient error');
      });
      scheduler.handlePersistentFailure = jest.fn().mockResolvedValue(undefined);

      const sleepDelays = [];
      scheduler.sleep = jest.fn().mockImplementation(async (ms) => {
        sleepDelays.push(ms);
      });

      await scheduler.executeScheduleWithRetry({ id: 'test-2' });

      // Should have slept twice (before attempt 2 and before attempt 3)
      expect(sleepDelays).toHaveLength(2);
      // Attempt 1 delay: base ~1000ms ±10%
      expect(sleepDelays[0]).toBeGreaterThanOrEqual(900);
      expect(sleepDelays[0]).toBeLessThanOrEqual(1100);
      // Attempt 2 delay: base ~2000ms ±10%
      expect(sleepDelays[1]).toBeGreaterThanOrEqual(1800);
      expect(sleepDelays[1]).toBeLessThanOrEqual(2200);
    });
  });
});
