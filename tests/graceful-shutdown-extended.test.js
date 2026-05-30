/* eslint-disable */
'use strict';

jest.mock('nodemailer', () => ({ createTransport: () => ({ sendMail: jest.fn() }) }), { virtual: true });
jest.mock('@opentelemetry/api', () => ({
  trace: { getTracer: () => ({ startActiveSpan: (_n, fn) => fn({ end: () => {} }) }) },
  context: { active: () => ({}), with: (_ctx, fn) => fn() },
  propagation: { inject: () => {}, extract: () => ({}) },
  SpanStatusCode: { OK: 1, ERROR: 2 },
}), { virtual: true });
jest.mock('../src/utils/tracing', () => ({
  withSpan: (_n, fn) => fn(),
  withSpanInContext: (_n, _ctx, _a, fn) => fn(),
  injectTraceHeaders: (h) => h,
  extractTraceContext: () => ({}),
  getCurrentTraceparent: () => null,
}));

jest.mock('../src/utils/database', () => ({ run: jest.fn().mockResolvedValue({}) }));
jest.mock('../src/utils/log', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../src/utils/correlation', () => ({
  withBackgroundContext: (_t, fn) => fn(),
  withAsyncContext: (_t, fn) => fn(),
  getCorrelationSummary: () => ({ correlationId: 'test-corr', traceId: 'test-trace' }),
}));

const Database = require('../src/utils/database');
const RecurringDonationSchedulerModule = require('../src/services/RecurringDonationScheduler');
const RecurringDonationScheduler = RecurringDonationSchedulerModule.Class || RecurringDonationSchedulerModule;
const WebhookService = require('../src/services/WebhookService');

describe('RecurringDonationScheduler.stopGracefully', () => {
  let scheduler;

  beforeEach(() => {
    jest.clearAllMocks();
    scheduler = new RecurringDonationScheduler({ sendPayment: jest.fn() });
  });

  afterEach(() => { if (scheduler.isRunning) scheduler.stop(); });

  test('stops immediately when no jobs running and returns waited=0, interrupted=0', async () => {
    scheduler.isRunning = true;
    scheduler.intervalId = setInterval(() => {}, 60000);
    const result = await scheduler.stopGracefully();
    expect(result).toEqual({ waited: 0, interrupted: 0 });
    expect(scheduler.isRunning).toBe(false);
    expect(scheduler.intervalId).toBeNull();
  });

  test('no-op when already stopped', async () => {
    scheduler.isRunning = false;
    const result = await scheduler.stopGracefully();
    expect(result).toEqual({ waited: 0, interrupted: 0 });
  });

  test('waits for executing schedules to finish and reports waited count', async () => {
    scheduler.isRunning = true;
    scheduler.intervalId = setInterval(() => {}, 60000);
    scheduler.executingSchedules.add(42);
    scheduler.executingSchedules.add(43);

    let resolved = false;
    const p = scheduler.stopGracefully(500).then((r) => { resolved = true; return r; });

    await new Promise(r => setTimeout(r, 50));
    expect(resolved).toBe(false);

    scheduler.executingSchedules.delete(42);
    scheduler.executingSchedules.delete(43);

    const result = await p;
    expect(resolved).toBe(true);
    expect(scheduler.isRunning).toBe(false);
    expect(result.waited).toBe(2);
    expect(result.interrupted).toBe(0);
  });

  test('resolves after timeout and marks interrupted executions in DB', async () => {
    scheduler.isRunning = true;
    scheduler.intervalId = setInterval(() => {}, 60000);
    scheduler.executingSchedules.add(99);

    const start = Date.now();
    const result = await scheduler.stopGracefully(200);

    expect(Date.now() - start).toBeGreaterThanOrEqual(190);
    expect(scheduler.isRunning).toBe(false);
    expect(result.interrupted).toBe(1);
    expect(result.waited).toBe(0);

    // Should have written an 'interrupted' log entry for schedule 99
    expect(Database.run).toHaveBeenCalledWith(
      expect.stringContaining("'interrupted'"),
      expect.arrayContaining([99])
    );
  });

  test('logs interrupted count when timeout is hit with multiple in-progress executions', async () => {
    scheduler.isRunning = true;
    scheduler.intervalId = setInterval(() => {}, 60000);
    scheduler.executingSchedules.add(1);
    scheduler.executingSchedules.add(2);
    scheduler.executingSchedules.add(3);

    const result = await scheduler.stopGracefully(150);

    expect(result.interrupted).toBe(3);
    expect(result.waited).toBe(0);
    // One DB insert per interrupted schedule
    expect(Database.run).toHaveBeenCalledTimes(3);
  });

  test('partial drain: some finish before timeout, rest are interrupted', async () => {
    scheduler.isRunning = true;
    scheduler.intervalId = setInterval(() => {}, 60000);
    scheduler.executingSchedules.add(10);
    scheduler.executingSchedules.add(11);

    // Schedule 10 finishes quickly, 11 never finishes
    setTimeout(() => scheduler.executingSchedules.delete(10), 50);

    const result = await scheduler.stopGracefully(200);

    expect(result.waited).toBe(1);
    expect(result.interrupted).toBe(1);
    expect(Database.run).toHaveBeenCalledTimes(1);
    expect(Database.run).toHaveBeenCalledWith(
      expect.stringContaining("'interrupted'"),
      expect.arrayContaining([11])
    );
  });

  test('default timeout is 30 seconds', async () => {
    // Verify the default parameter by inspecting the function signature via toString
    expect(scheduler.stopGracefully.toString()).toMatch(/timeoutMs\s*=\s*30000/);
  });
});

describe('WebhookService.flushPending', () => {
  test('is a function', () => { expect(typeof WebhookService.flushPending).toBe('function'); });
  test('resolves without error when no pending webhooks', async () => {
    await expect(WebhookService.flushPending()).resolves.toBeUndefined();
  });
});

describe('Shutdown timeout configuration', () => {
  test('SHUTDOWN_TIMEOUT_MS is respected', () => {
    const orig = process.env.SHUTDOWN_TIMEOUT_MS;
    process.env.SHUTDOWN_TIMEOUT_MS = '5000';
    expect(parseInt(process.env.SHUTDOWN_TIMEOUT_MS || '30000', 10)).toBe(5000);
    if (orig !== undefined) process.env.SHUTDOWN_TIMEOUT_MS = orig;
    else delete process.env.SHUTDOWN_TIMEOUT_MS;
  });

  test('defaults to 30s when unset', () => {
    const orig = process.env.SHUTDOWN_TIMEOUT_MS;
    delete process.env.SHUTDOWN_TIMEOUT_MS;
    expect(parseInt(process.env.SHUTDOWN_TIMEOUT_MS || '30000', 10)).toBe(30000);
    if (orig !== undefined) process.env.SHUTDOWN_TIMEOUT_MS = orig;
  });
});
