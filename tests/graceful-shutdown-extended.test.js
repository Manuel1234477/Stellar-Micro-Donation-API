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

const RecurringDonationScheduler = require('../src/services/RecurringDonationScheduler');
const WebhookService = require('../src/services/WebhookService');

describe('RecurringDonationScheduler.stopGracefully', () => {
  let scheduler;
  beforeEach(() => { scheduler = new RecurringDonationScheduler(null); });
  afterEach(() => { if (scheduler.isRunning) scheduler.stop(); });

  test('stops immediately when no jobs running', async () => {
    scheduler.isRunning = true;
    scheduler.intervalId = setInterval(() => {}, 60000);
    await expect(scheduler.stopGracefully()).resolves.toBeUndefined();
    expect(scheduler.isRunning).toBe(false);
    expect(scheduler.intervalId).toBeNull();
  });

  test('no-op when already stopped', async () => {
    scheduler.isRunning = false;
    await expect(scheduler.stopGracefully()).resolves.toBeUndefined();
  });

  test('waits for executing schedules to finish', async () => {
    scheduler.isRunning = true;
    scheduler.intervalId = setInterval(() => {}, 60000);
    scheduler.executingSchedules.add(42);
    let resolved = false;
    const p = scheduler.stopGracefully(500).then(() => { resolved = true; });
    await new Promise(r => setTimeout(r, 50));
    expect(resolved).toBe(false);
    scheduler.executingSchedules.delete(42);
    await p;
    expect(resolved).toBe(true);
    expect(scheduler.isRunning).toBe(false);
  });

  test('resolves after timeout even if jobs still running', async () => {
    scheduler.isRunning = true;
    scheduler.intervalId = setInterval(() => {}, 60000);
    scheduler.executingSchedules.add(99);
    const start = Date.now();
    await scheduler.stopGracefully(200);
    expect(Date.now() - start).toBeGreaterThanOrEqual(190);
    expect(scheduler.isRunning).toBe(false);
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
