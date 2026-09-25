'use strict';

/**
 * Tests: Request Lifecycle Timeline Logging (Issue #255)
 *
 * Tests the middleware directly without a live HTTP server to avoid
 * the supertest/superagent peer-dependency issue.
 */

jest.mock('../../src/config', () => ({
  app: { name: 'test-app', version: '1.0.0' },
  server: { env: 'test', port: 3000 },
  logging: { debugMode: false, level: 'INFO', format: 'text', sampleRate: 1.0 },
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  setContext: jest.fn(),
  getContext: jest.fn(() => ({})),
  isDebugMode: false,
}));

jest.mock('../../src/utils/sanitizer', () => ({ sanitizeForLogging: jest.fn(v => v) }));
jest.mock('../../src/utils/correlation', () => ({
  initializeRequestContext: jest.fn(),
  parseCorrelationHeaders: jest.fn(() => ({})),
  getCorrelationContext: jest.fn(() => ({})),
}));

const { attachLifecycleTracking, LIFECYCLE_STAGES } = require('../../src/middleware/requestLifecycle');
const log = require('../../src/utils/log');

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeReqRes(overrides = {}) {
  const finishListeners = [];
  const req = { id: 'req-test-1', method: 'GET', path: '/test', ...overrides };
  const res = {
    statusCode: 200,
    on(event, cb) { if (event === 'finish') finishListeners.push(cb); },
    _finish() { finishListeners.forEach(cb => cb()); },
  };
  return { req, res, next: jest.fn(), finish: () => res._finish() };
}

// ─── LIFECYCLE_STAGES constant ───────────────────────────────────────────────

describe('LIFECYCLE_STAGES', () => {
  test('exports the four expected stage keys', () => {
    expect(LIFECYCLE_STAGES.RECEIVED).toBe('received');
    expect(LIFECYCLE_STAGES.VALIDATED).toBe('validated');
    expect(LIFECYCLE_STAGES.PROCESSED).toBe('processed');
    expect(LIFECYCLE_STAGES.RESPONDED).toBe('responded');
  });
});

// ─── attachLifecycleTracking ─────────────────────────────────────────────────

describe('attachLifecycleTracking', () => {
  beforeEach(() => jest.clearAllMocks());

  test('calls next()', () => {
    const { req, res, next } = makeReqRes();
    attachLifecycleTracking(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('attaches req.lifecycle with received timestamp', () => {
    const before = Date.now();
    const { req, res, next } = makeReqRes();
    attachLifecycleTracking(req, res, next);
    expect(req.lifecycle).toBeDefined();
    expect(req.lifecycle.received).toBeGreaterThanOrEqual(before);
    expect(req.lifecycle.received).toBeLessThanOrEqual(Date.now());
  });

  test('attaches req.markLifecycleStage function', () => {
    const { req, res, next } = makeReqRes();
    attachLifecycleTracking(req, res, next);
    expect(typeof req.markLifecycleStage).toBe('function');
  });

  test('markLifecycleStage records timestamp in stages', () => {
    const { req, res, next } = makeReqRes();
    attachLifecycleTracking(req, res, next);
    const before = Date.now();
    req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);
    expect(req.lifecycle.stages[LIFECYCLE_STAGES.PROCESSED]).toBeGreaterThanOrEqual(before);
  });

  test('logs timeline on res finish', () => {
    const { req, res, next, finish } = makeReqRes();
    attachLifecycleTracking(req, res, next);
    finish();
    expect(log.info).toHaveBeenCalledWith(
      'REQUEST_LIFECYCLE',
      'Request timeline',
      expect.objectContaining({ method: 'GET', path: '/test', statusCode: 200 })
    );
  });

  test('log includes requestId', () => {
    const { req, res, next, finish } = makeReqRes({ id: 'abc-123' });
    attachLifecycleTracking(req, res, next);
    finish();
    const [, , meta] = log.info.mock.calls[0];
    expect(meta.requestId).toBe('abc-123');
  });

  test('log includes timeline object with all four timestamps', () => {
    const { req, res, next, finish } = makeReqRes();
    attachLifecycleTracking(req, res, next);
    req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);
    finish();
    const [, , meta] = log.info.mock.calls[0];
    expect(meta.timeline).toMatchObject({
      received: expect.any(Number),
      validated: expect.any(Number),
      processed: expect.any(Number),
      responded: expect.any(Number),
    });
  });

  test('log includes durations object with all four keys', () => {
    const { req, res, next, finish } = makeReqRes();
    attachLifecycleTracking(req, res, next);
    finish();
    const [, , meta] = log.info.mock.calls[0];
    expect(meta.durations).toMatchObject({
      total: expect.any(Number),
      validation: expect.any(Number),
      processing: expect.any(Number),
      response: expect.any(Number),
    });
  });

  test('all durations are non-negative', () => {
    const { req, res, next, finish } = makeReqRes();
    attachLifecycleTracking(req, res, next);
    req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);
    finish();
    const { durations } = log.info.mock.calls[0][2];
    expect(durations.total).toBeGreaterThanOrEqual(0);
    expect(durations.validation).toBeGreaterThanOrEqual(0);
    expect(durations.processing).toBeGreaterThanOrEqual(0);
    expect(durations.response).toBeGreaterThanOrEqual(0);
  });

  test('total ≈ sum of validation + processing + response', () => {
    const { req, res, next, finish } = makeReqRes();
    attachLifecycleTracking(req, res, next);
    req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);
    finish();
    const { durations } = log.info.mock.calls[0][2];
    const sum = durations.validation + durations.processing + durations.response;
    expect(Math.abs(durations.total - sum)).toBeLessThan(5);
  });

  test('falls back gracefully when processed stage is never marked', () => {
    const { req, res, next, finish } = makeReqRes();
    attachLifecycleTracking(req, res, next);
    // no markLifecycleStage call
    finish();
    const [, , meta] = log.info.mock.calls[0];
    expect(meta.timeline.processed).toBeDefined();
    expect(meta.durations.processing).toBeGreaterThanOrEqual(0);
  });

  test('logs correct statusCode for error responses', () => {
    const { req, res, next, finish } = makeReqRes();
    res.statusCode = 500;
    attachLifecycleTracking(req, res, next);
    finish();
    const [, , meta] = log.info.mock.calls[0];
    expect(meta.statusCode).toBe(500);
  });

  test('each request gets its own independent lifecycle', () => {
    const r1 = makeReqRes({ id: 'r1', path: '/a' });
    const r2 = makeReqRes({ id: 'r2', path: '/b' });

    attachLifecycleTracking(r1.req, r1.res, r1.next);
    attachLifecycleTracking(r2.req, r2.res, r2.next);

    r1.req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);
    r1.finish();
    r2.finish();

    const calls = log.info.mock.calls.filter(c => c[0] === 'REQUEST_LIFECYCLE');
    expect(calls).toHaveLength(2);
    expect(calls[0][2].requestId).toBe('r1');
    expect(calls[1][2].requestId).toBe('r2');
  });

  test('does not throw when req.markLifecycleStage is deleted before finish', () => {
    const { req, res, next, finish } = makeReqRes();
    attachLifecycleTracking(req, res, next);
    delete req.markLifecycleStage;
    expect(() => finish()).not.toThrow();
    expect(log.info).toHaveBeenCalled();
  });

  test('validated timestamp falls back to received when not set', () => {
    const { req, res, next, finish } = makeReqRes();
    attachLifecycleTracking(req, res, next);
    finish();
    const { timeline } = log.info.mock.calls[0][2];
    // validated should be >= received
    expect(timeline.validated).toBeGreaterThanOrEqual(timeline.received);
  });

  test('process.nextTick auto-marks validated stage before finish', async () => {
    const { req, res, next, finish } = makeReqRes();
    attachLifecycleTracking(req, res, next);
    // Wait for the nextTick to fire
    await new Promise(resolve => setImmediate(resolve));
    expect(req.lifecycle.stages[LIFECYCLE_STAGES.VALIDATED]).toBeDefined();
    finish();
  });
});

describe('Request Lifecycle Hooks System (#1600)', () => {
  const {
    onRequestStart,
    onRequestEnd,
    onRequestError,
    registerHook,
    handleLifecycleError,
    attachLifecycleTracking: tracking,
  } = require('../../src/middleware/requestLifecycle');

  test('exposes hook slots as arrays', () => {
    expect(Array.isArray(onRequestStart)).toBe(true);
    expect(Array.isArray(onRequestEnd)).toBe(true);
    expect(Array.isArray(onRequestError)).toBe(true);
  });

  test('registerHook adds hooks to appropriate slots', () => {
    const customStart = jest.fn();
    const customEnd = jest.fn();
    const customError = jest.fn();

    registerHook('onRequestStart', customStart);
    registerHook('onRequestEnd', customEnd);
    registerHook('onRequestError', customError);

    expect(onRequestStart).toContain(customStart);
    expect(onRequestEnd).toContain(customEnd);
    expect(onRequestError).toContain(customError);

    // Clean up
    onRequestStart.splice(onRequestStart.indexOf(customStart), 1);
    onRequestEnd.splice(onRequestEnd.indexOf(customEnd), 1);
    onRequestError.splice(onRequestError.indexOf(customError), 1);
  });

  test('executes onRequestStart hooks in sequential order', async () => {
    const executionOrder = [];
    const hook1 = jest.fn(async () => { executionOrder.push('hook1'); });
    const hook2 = jest.fn(async () => { executionOrder.push('hook2'); });

    onRequestStart.push(hook1, hook2);

    const { req, res, next } = makeReqRes();
    tracking(req, res, next);

    await new Promise(resolve => setImmediate(resolve));

    expect(hook1).toHaveBeenCalledWith(req, res);
    expect(hook2).toHaveBeenCalledWith(req, res);
    expect(executionOrder).toEqual(['hook1', 'hook2']);

    // Clean up
    onRequestStart.splice(onRequestStart.indexOf(hook1), 1);
    onRequestStart.splice(onRequestStart.indexOf(hook2), 1);
  });

  test('executes onRequestEnd hooks in sequential order on response finish', async () => {
    const executionOrder = [];
    const endHook1 = jest.fn(async () => { executionOrder.push('end1'); });
    const endHook2 = jest.fn(async () => { executionOrder.push('end2'); });

    onRequestEnd.push(endHook1, endHook2);

    const { req, res, next, finish } = makeReqRes();
    tracking(req, res, next);
    finish();

    await new Promise(resolve => setImmediate(resolve));

    expect(endHook1).toHaveBeenCalledWith(req, res);
    expect(endHook2).toHaveBeenCalledWith(req, res);
    expect(executionOrder).toEqual(['end1', 'end2']);

    // Clean up
    onRequestEnd.splice(onRequestEnd.indexOf(endHook1), 1);
    onRequestEnd.splice(onRequestEnd.indexOf(endHook2), 1);
  });

  test('propagates errors to onRequestError hooks', async () => {
    const errorHook = jest.fn();
    onRequestError.push(errorHook);

    const testError = new Error('Hook failure');
    const { req, res } = makeReqRes();

    await handleLifecycleError(testError, req, res);

    expect(errorHook).toHaveBeenCalledWith(testError, req, res);

    // Clean up
    onRequestError.splice(onRequestError.indexOf(errorHook), 1);
  });
});

