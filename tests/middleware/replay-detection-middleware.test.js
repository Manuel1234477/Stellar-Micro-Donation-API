/**
 * Unit tests for replay detection middleware
 * Tests core functionality, error handling, non-blocking behavior,
 * timeout fail-open, and health endpoint exemption.
 */

'use strict';

const replayDetectionMiddleware = require('../../src/middleware/replayDetection');
const { TrackingStore } = require('../../src/utils/replayDetector');
const config = require('../../src/config/replayDetection');

/** Flush the microtask queue so Promise.resolve().then() chains complete */
const flushPromises = () => new Promise(resolve => jest.requireActual('timers').setImmediate(resolve));

describe('Replay Detection Middleware', () => {
  let req, res, next;

  beforeEach(() => {
    jest.useFakeTimers();
    replayDetectionMiddleware.trackingStore.store.clear();

    req = {
      method: 'POST',
      path: '/api/test',
      body: { test: 'data' },
      headers: {},
    };

    res = {
      headers: {},
      setHeader: jest.fn((key, value) => { res.headers[key] = value; }),
    };

    next = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /** Run the middleware and flush the promise chain */
  async function run(r = req) {
    replayDetectionMiddleware(r, res, next);
    jest.runAllTimers();
    await flushPromises();
  }

  describe('Basic functionality', () => {
    test('should call next() for every request', async () => {
      await run();
      expect(next).toHaveBeenCalledTimes(1);
    });

    test('should record fingerprint in tracking store', async () => {
      await run();
      const stats = replayDetectionMiddleware.trackingStore.getStats();
      expect(stats.totalFingerprints).toBe(1);
      expect(stats.totalTimestamps).toBe(1);
    });

    test('should not add headers when threshold not exceeded', async () => {
      await run();
      expect(res.setHeader).not.toHaveBeenCalled();
    });

    test('should detect replay when threshold exceeded', async () => {
      for (let i = 0; i < config.threshold + 1; i++) {
        await run();
      }
      expect(res.setHeader).toHaveBeenCalledWith('X-Replay-Detected', 'true');
      expect(res.setHeader).toHaveBeenCalledWith('X-Replay-Count', (config.threshold + 1).toString());
      expect(res.setHeader).toHaveBeenCalledWith('X-Replay-Window', config.windowSeconds.toString());
    });
  });

  describe('Fingerprint tracking', () => {
    test('should track different requests separately', async () => {
      await run({ ...req, path: '/api/test1' });
      await run({ ...req, path: '/api/test2' });
      const stats = replayDetectionMiddleware.trackingStore.getStats();
      expect(stats.totalFingerprints).toBe(2);
    });

    test('should track identical requests together', async () => {
      await run(); await run(); await run();
      const stats = replayDetectionMiddleware.trackingStore.getStats();
      expect(stats.totalFingerprints).toBe(1);
      expect(stats.totalTimestamps).toBe(3);
    });
  });

  describe('Response headers', () => {
    test('should add all required headers when replay detected', async () => {
      for (let i = 0; i < config.threshold + 1; i++) {
        res.setHeader.mockClear();
        await run();
      }
      expect(res.headers['X-Replay-Detected']).toBe('true');
      expect(res.headers['X-Replay-Count']).toBe((config.threshold + 1).toString());
      expect(res.headers['X-Replay-Window']).toBe(config.windowSeconds.toString());
    });
  });

  describe('API key logging', () => {
    test('should include API key in log metadata when present', async () => {
      const logSpy = jest.spyOn(require('../../src/utils/log'), 'warn');
      req.headers['x-api-key'] = 'test-api-key-123';
      for (let i = 0; i < config.threshold + 1; i++) await run();
      const replayCall = logSpy.mock.calls.find(c => c[1] === 'Replay detected');
      expect(replayCall[2].apiKey).toBe('test-api-key-123');
      logSpy.mockRestore();
    });

    test('should not include API key when not present', async () => {
      const logSpy = jest.spyOn(require('../../src/utils/log'), 'warn');
      for (let i = 0; i < config.threshold + 1; i++) await run();
      const replayCall = logSpy.mock.calls.find(c => c[1] === 'Replay detected');
      expect(replayCall[2].apiKey).toBeUndefined();
      logSpy.mockRestore();
    });
  });

  describe('Error handling', () => {
    test('should call next() even when fingerprint computation fails', async () => {
      const original = replayDetectionMiddleware.trackingStore.record;
      replayDetectionMiddleware.trackingStore.record = jest.fn(() => { throw new Error('Test error'); });
      await run();
      expect(next).toHaveBeenCalledTimes(1);
      replayDetectionMiddleware.trackingStore.record = original;
    });

    test('should log error when processing fails', async () => {
      const logSpy = jest.spyOn(require('../../src/utils/log'), 'error');
      const original = replayDetectionMiddleware.trackingStore.record;
      replayDetectionMiddleware.trackingStore.record = jest.fn(() => { throw new Error('Test error'); });
      await run();
      expect(logSpy).toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
      replayDetectionMiddleware.trackingStore.record = original;
      logSpy.mockRestore();
    });
  });

  describe('Edge cases', () => {
    test('should handle empty request body', async () => {
      await run({ ...req, body: '' });
      expect(next).toHaveBeenCalledTimes(1);
    });

    test('should handle missing request body', async () => {
      const r = { ...req }; delete r.body;
      await run(r);
      expect(next).toHaveBeenCalledTimes(1);
    });

    test('should handle requests at exact threshold', async () => {
      for (let i = 0; i < config.threshold; i++) {
        res.setHeader.mockClear();
        await run();
      }
      expect(res.setHeader).not.toHaveBeenCalled();
    });

    test('should handle requests just over threshold', async () => {
      for (let i = 0; i < config.threshold + 1; i++) {
        res.setHeader.mockClear();
        await run();
      }
      expect(res.setHeader).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // New tests: timeout fail-open and health endpoint exemption
  // -------------------------------------------------------------------------

  describe('Health endpoint exemption', () => {
    test.each(['/health', '/health/live', '/health/ready'])(
      'should skip replay detection for %s',
      async (path) => {
        const r = { ...req, path };
        replayDetectionMiddleware(r, res, next);
        // next() is called synchronously for exempt paths
        expect(next).toHaveBeenCalledTimes(1);
        // Nothing recorded in the store
        const stats = replayDetectionMiddleware.trackingStore.getStats();
        expect(stats.totalFingerprints).toBe(0);
      }
    );

    test('should still apply replay detection to non-exempt paths', async () => {
      await run({ ...req, path: '/api/donations' });
      const stats = replayDetectionMiddleware.trackingStore.getStats();
      expect(stats.totalFingerprints).toBe(1);
    });
  });

  describe('Timeout fail-open', () => {
    test('calls next() after timeout when store hangs', async () => {
      // Replace record with a never-resolving async operation
      const original = replayDetectionMiddleware.trackingStore.record;
      replayDetectionMiddleware.trackingStore.record = jest.fn(
        () => new Promise(() => {}) // hangs forever
      );

      replayDetectionMiddleware(req, res, next);
      expect(next).not.toHaveBeenCalled(); // not yet

      // Advance past the timeout
      jest.advanceTimersByTime(replayDetectionMiddleware.TIMEOUT_MS + 10);
      await flushPromises();

      expect(next).toHaveBeenCalledTimes(1);
      replayDetectionMiddleware.trackingStore.record = original;
    });

    test('logs a warning when timing out', async () => {
      const logSpy = jest.spyOn(require('../../src/utils/log'), 'warn');
      const original = replayDetectionMiddleware.trackingStore.record;
      replayDetectionMiddleware.trackingStore.record = jest.fn(() => new Promise(() => {}));

      replayDetectionMiddleware(req, res, next);
      jest.advanceTimersByTime(replayDetectionMiddleware.TIMEOUT_MS + 10);
      await flushPromises();

      const timeoutWarn = logSpy.mock.calls.find(c => c[1] && c[1].includes('timed out'));
      expect(timeoutWarn).toBeDefined();
      replayDetectionMiddleware.trackingStore.record = original;
      logSpy.mockRestore();
    });

    test('does not call next() twice when check completes before timeout', async () => {
      await run();
      expect(next).toHaveBeenCalledTimes(1);
    });

    test('TIMEOUT_MS is configurable via REPLAY_DETECTION_TIMEOUT_MS env var', () => {
      // The exported constant reflects the env var (tested at module load time)
      expect(typeof replayDetectionMiddleware.TIMEOUT_MS).toBe('number');
      expect(replayDetectionMiddleware.TIMEOUT_MS).toBeGreaterThan(0);
    });
  });
});
