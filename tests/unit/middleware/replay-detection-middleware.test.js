/**
 * Unit tests for replay detection middleware
 * Tests core functionality, error handling, and non-blocking behavior
 */

const replayDetectionMiddleware = require('../../../src/middleware/replayDetection');
const { TrackingStore } = require('../../../src/utils/replayDetector');
const config = require('../../../src/config/replayDetection');

describe('Replay Detection Middleware', () => {
  let req, res, next, trackingStore;

  beforeEach(() => {
    // Clear the singleton tracking store before each test
    replayDetectionMiddleware.trackingStore.store.clear();
    
    // Mock request object
    req = {
      method: 'POST',
      path: '/api/test',
      body: { test: 'data' },
      headers: {}
    };

    // Mock response object with header tracking
    res = {
      headers: {},
      setHeader: jest.fn((key, value) => {
        res.headers[key] = value;
      })
    };

    // Mock next function
    next = jest.fn();
  });

  describe('Basic functionality', () => {
    test('should call next() for every request', () => {
      replayDetectionMiddleware(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    test('should record fingerprint in tracking store', () => {
      replayDetectionMiddleware(req, res, next);
      
      // Verify something was recorded in the module's tracking store
      const stats = replayDetectionMiddleware.trackingStore.getStats();
      expect(stats.totalFingerprints).toBe(1);
      expect(stats.totalTimestamps).toBe(1);
    });

    test('should not add headers when threshold not exceeded', () => {
      // Send request once (below threshold of 3)
      replayDetectionMiddleware(req, res, next);
      
      expect(res.setHeader).not.toHaveBeenCalled();
      expect(res.headers['X-Replay-Detected']).toBeUndefined();
    });

    test('should detect replay when threshold exceeded', () => {
      // Send same request multiple times to exceed threshold
      for (let i = 0; i < config.threshold + 1; i++) {
        replayDetectionMiddleware(req, res, next);
      }
      
      // Last request should trigger replay detection
      expect(res.setHeader).toHaveBeenCalledWith('X-Replay-Detected', 'true');
      expect(res.setHeader).toHaveBeenCalledWith('X-Replay-Count', (config.threshold + 1).toString());
      expect(res.setHeader).toHaveBeenCalledWith('X-Replay-Window', config.windowSeconds.toString());
    });
  });

  describe('Fingerprint tracking', () => {
    test('should track different requests separately', () => {
      const req1 = { ...req, path: '/api/test1' };
      const req2 = { ...req, path: '/api/test2' };
      
      replayDetectionMiddleware(req1, res, next);
      replayDetectionMiddleware(req2, res, next);
      
      const stats = replayDetectionMiddleware.trackingStore.getStats();
      expect(stats.totalFingerprints).toBe(2);
      expect(stats.totalTimestamps).toBe(2);
    });

    test('should track identical requests together', () => {
      replayDetectionMiddleware(req, res, next);
      replayDetectionMiddleware(req, res, next);
      replayDetectionMiddleware(req, res, next);
      
      const stats = replayDetectionMiddleware.trackingStore.getStats();
      expect(stats.totalFingerprints).toBe(1);
      expect(stats.totalTimestamps).toBe(3);
    });
  });

  describe('Response headers', () => {
    test('should add all required headers when replay detected', () => {
      // Exceed threshold
      for (let i = 0; i < config.threshold + 1; i++) {
        res.setHeader.mockClear();
        replayDetectionMiddleware(req, res, next);
      }
      
      expect(res.headers['X-Replay-Detected']).toBe('true');
      expect(res.headers['X-Replay-Count']).toBe((config.threshold + 1).toString());
      expect(res.headers['X-Replay-Window']).toBe(config.windowSeconds.toString());
    });

    test('should not add headers for different requests', () => {
      // Send different requests
      const req1 = { ...req, path: '/api/test1' };
      const req2 = { ...req, path: '/api/test2' };
      
      for (let i = 0; i < config.threshold + 1; i++) {
        replayDetectionMiddleware(req1, res, next);
      }
      
      res.setHeader.mockClear();
      replayDetectionMiddleware(req2, res, next);
      
      // req2 should not trigger replay detection
      expect(res.setHeader).not.toHaveBeenCalled();
    });
  });

  describe('API key logging', () => {
    test('should include API key in log metadata when present', () => {
      const logSpy = jest.spyOn(require('../../../src/utils/log'), 'warn');
      
      req.headers['x-api-key'] = 'test-api-key-123';
      
      // Exceed threshold to trigger logging
      for (let i = 0; i < config.threshold + 1; i++) {
        replayDetectionMiddleware(req, res, next);
      }
      
      expect(logSpy).toHaveBeenCalled();
      const logCall = logSpy.mock.calls[0];
      expect(logCall[2].apiKey).toBe('test-api-key-123');
      
      logSpy.mockRestore();
    });

    test('should not include API key when not present', () => {
      const logSpy = jest.spyOn(require('../../../src/utils/log'), 'warn');
      
      // No API key in headers
      
      // Exceed threshold to trigger logging
      for (let i = 0; i < config.threshold + 1; i++) {
        replayDetectionMiddleware(req, res, next);
      }
      
      expect(logSpy).toHaveBeenCalled();
      const logCall = logSpy.mock.calls[0];
      expect(logCall[2].apiKey).toBeUndefined();
      
      logSpy.mockRestore();
    });
  });

  describe('Error handling', () => {
    test('should call next() even when fingerprint computation fails', () => {
      // Create request that might cause issues
      const badReq = { ...req, body: undefined };
      
      replayDetectionMiddleware(badReq, res, next);
      
      // Should still call next()
      expect(next).toHaveBeenCalledTimes(1);
    });

    test('should log error when processing fails', () => {
      const logSpy = jest.spyOn(require('../../../src/utils/log'), 'error');
      
      // Force an error by making the singleton trackingStore.record throw
      const originalRecord = replayDetectionMiddleware.trackingStore.record;
      replayDetectionMiddleware.trackingStore.record = jest.fn(() => {
        throw new Error('Test error');
      });
      
      replayDetectionMiddleware(req, res, next);
      
      expect(logSpy).toHaveBeenCalled();
      expect(logSpy.mock.calls[0][1]).toContain('error');
      expect(next).toHaveBeenCalledTimes(1);
      
      // Restore
      replayDetectionMiddleware.trackingStore.record = originalRecord;
      logSpy.mockRestore();
    });

    test('should not add headers when error occurs', () => {
      // Force an error
      const originalRecord = replayDetectionMiddleware.trackingStore.record;
      replayDetectionMiddleware.trackingStore.record = jest.fn(() => {
        throw new Error('Test error');
      });
      
      replayDetectionMiddleware(req, res, next);
      
      expect(res.setHeader).not.toHaveBeenCalled();
      
      // Restore
      replayDetectionMiddleware.trackingStore.record = originalRecord;
    });
  });

  describe('Edge cases', () => {
    test('should handle empty request body', () => {
      req.body = '';
      
      replayDetectionMiddleware(req, res, next);
      
      expect(next).toHaveBeenCalledTimes(1);
      const stats = replayDetectionMiddleware.trackingStore.getStats();
      expect(stats.totalFingerprints).toBe(1);
    });

    test('should handle missing request body', () => {
      delete req.body;
      
      replayDetectionMiddleware(req, res, next);
      
      expect(next).toHaveBeenCalledTimes(1);
      const stats = replayDetectionMiddleware.trackingStore.getStats();
      expect(stats.totalFingerprints).toBe(1);
    });

    test('should handle requests at exact threshold', () => {
      // Send exactly threshold number of requests
      for (let i = 0; i < config.threshold; i++) {
        res.setHeader.mockClear();
        replayDetectionMiddleware(req, res, next);
      }
      
      // At threshold, should not trigger (needs to exceed)
      expect(res.setHeader).not.toHaveBeenCalled();
    });

    test('should handle requests just over threshold', () => {
      // Send threshold + 1 requests
      for (let i = 0; i < config.threshold + 1; i++) {
        res.setHeader.mockClear();
        replayDetectionMiddleware(req, res, next);
      }
      
      // Should trigger on the request that exceeds threshold
      expect(res.setHeader).toHaveBeenCalled();
    });
  });
});
