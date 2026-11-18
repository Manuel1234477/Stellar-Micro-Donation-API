'use strict';

/**
 * Tests for explicit per-route timeouts and cancellation propagation (issue #1207).
 */

const { withTimeout, TimeoutError } = require('../src/utils/timeoutHandler');
const { runWithAbortController, getCurrentAbortSignal } = require('../src/utils/abortContext');
const { TIMEOUTS } = require('../src/middleware/requestTimeout');

describe('withTimeout — abort propagation', () => {
  test('aborts the supplied AbortController when the timeout fires', async () => {
    const controller = new AbortController();
    const neverResolves = new Promise(() => {});

    await expect(withTimeout(neverResolves, 20, 'slow_op', controller)).rejects.toThrow(TimeoutError);
    expect(controller.signal.aborted).toBe(true);
  });

  test('does not abort when the operation resolves before the timeout', async () => {
    const controller = new AbortController();
    const fast = Promise.resolve('ok');

    await expect(withTimeout(fast, 50, 'fast_op', controller)).resolves.toBe('ok');
    expect(controller.signal.aborted).toBe(false);
  });

  test('works without an AbortController (backward compatible)', async () => {
    const neverResolves = new Promise(() => {});
    await expect(withTimeout(neverResolves, 20, 'slow_op')).rejects.toThrow(TimeoutError);
  });
});

describe('abortContext', () => {
  test('getCurrentAbortSignal is undefined outside any context', () => {
    expect(getCurrentAbortSignal()).toBeUndefined();
  });

  test('getCurrentAbortSignal returns the active controller signal inside the context', () => {
    const controller = new AbortController();
    const signal = runWithAbortController(controller, () => getCurrentAbortSignal());
    expect(signal).toBe(controller.signal);
  });

  test('the signal is reachable across an await inside the context', async () => {
    const controller = new AbortController();
    const signal = await runWithAbortController(controller, async () => {
      await new Promise((resolve) => setImmediate(resolve));
      return getCurrentAbortSignal();
    });
    expect(signal).toBe(controller.signal);
  });

  test('context does not leak outside of runWithAbortController', async () => {
    const controller = new AbortController();
    await runWithAbortController(controller, async () => {
      await new Promise((resolve) => setImmediate(resolve));
    });
    expect(getCurrentAbortSignal()).toBeUndefined();
  });
});

describe('TIMEOUTS presets', () => {
  test('exports an export preset for synchronous large exports', () => {
    expect(TIMEOUTS.export).toBe(45_000);
  });

  test('donation timeout remains the slowest non-streaming preset below stream', () => {
    expect(TIMEOUTS.donation).toBeLessThan(TIMEOUTS.export);
    expect(TIMEOUTS.export).toBeLessThan(TIMEOUTS.stream);
  });
});

describe('StellarService HTTP client — abort signal forwarding', () => {
  let originalFetch;
  let fetchCalls;

  beforeEach(() => {
    fetchCalls = [];
    originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      fetchCalls.push(opts);
      return { ok: true, json: async () => ({}) };
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function buildClient() {
    const StellarService = require('../src/services/StellarService');
    const service = Object.create(StellarService.prototype);
    return service._createHttpClient();
  }

  test('fetch is called with the current abort signal when one is active', async () => {
    const client = buildClient();
    const controller = new AbortController();

    await runWithAbortController(controller, () => client.request('GET', 'https://example.invalid/x'));

    expect(fetchCalls[0].signal).toBe(controller.signal);
  });

  test('fetch is called without a signal option when no abort context is active', async () => {
    const client = buildClient();

    await client.request('GET', 'https://example.invalid/x');

    expect(fetchCalls[0].signal).toBeUndefined();
  });
});
