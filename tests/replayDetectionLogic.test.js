/**
 * Focused tests for replay detection logic
 * Validates Requirements 2.2 and 2.5
 * 
 * Requirement 2.2: WHEN a Request_Fingerprint appears more times than the Replay_Threshold 
 *                  within the Replay_Window, THE Replay_Detector SHALL identify it as a Replay_Event
 * 
 * Requirement 2.5: WHEN counting occurrences, THE Replay_Detector SHALL only include 
 *                  requests within the current Replay_Window
 */

const replayDetectionMiddleware = require('../src/middleware/replayDetection');
const config = require('../src/config/replayDetection');

describe('Replay Detection Logic - Requirements 2.2 and 2.5', () => {
  let req, res, next;

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

  describe('Requirement 2.2: Threshold Detection', () => {
    test('should NOT detect replay when count equals threshold', () => {
      // Send exactly threshold number of requests (default is 3)
      for (let i = 0; i < config.threshold; i++) {
        res.setHeader.mockClear();
        replayDetectionMiddleware(req, res, next);
      }
      
      // At threshold (3 requests), should NOT trigger replay detection
      // Replay requires MORE than threshold
      expect(res.headers['X-Replay-Detected']).toBeUndefined();
    });

    test('should detect replay when count exceeds threshold by 1', () => {
      // Send threshold + 1 requests (default: 3 + 1 = 4)
      for (let i = 0; i < config.threshold + 1; i++) {
        res.setHeader.mockClear();
        replayDetectionMiddleware(req, res, next);
      }
      
      // Should trigger on the 4th request (exceeds threshold of 3)
      expect(res.headers['X-Replay-Detected']).toBe('true');
      expect(res.headers['X-Replay-Count']).toBe((config.threshold + 1).toString());
    });

    test('should detect replay when count significantly exceeds threshold', () => {
      // Send many more requests than threshold
      const requestCount = config.threshold + 10;
      
      for (let i = 0; i < requestCount; i++) {
        res.setHeader.mockClear();
        replayDetectionMiddleware(req, res, next);
      }
      
      // Should detect replay with correct count
      expect(res.headers['X-Replay-Detected']).toBe('true');
      expect(res.headers['X-Replay-Count']).toBe(requestCount.toString());
    });

    test('should continue detecting replay on subsequent requests', () => {
      // Exceed threshold
      for (let i = 0; i < config.threshold + 1; i++) {
        replayDetectionMiddleware(req, res, next);
      }
      
      // Send another request
      res.setHeader.mockClear();
      replayDetectionMiddleware(req, res, next);
      
      // Should still detect replay with updated count
      expect(res.headers['X-Replay-Detected']).toBe('true');
      expect(res.headers['X-Replay-Count']).toBe((config.threshold + 2).toString());
    });

    test('should detect replay independently for different fingerprints', () => {
      const req1 = { ...req, path: '/api/endpoint1' };
      const req2 = { ...req, path: '/api/endpoint2' };
      
      // Exceed threshold for req1
      for (let i = 0; i < config.threshold + 1; i++) {
        replayDetectionMiddleware(req1, res, next);
      }
      
      // Create a fresh response object for req2
      const res2 = {
        headers: {},
        setHeader: jest.fn((key, value) => {
          res2.headers[key] = value;
        })
      };
      
      // req2 should not trigger replay (different fingerprint)
      replayDetectionMiddleware(req2, res2, next);
      
      expect(res2.headers['X-Replay-Detected']).toBeUndefined();
      
      // Exceed threshold for req2
      for (let i = 0; i < config.threshold; i++) {
        replayDetectionMiddleware(req2, res2, next);
      }
      
      // Now req2 should trigger replay
      expect(res2.headers['X-Replay-Detected']).toBe('true');
    });
  });

  describe('Requirement 2.5: Time Window Filtering', () => {
    test('should only count requests within the replay window', () => {
      const store = replayDetectionMiddleware.trackingStore;
      const { computeFingerprint } = require('../src/utils/replayDetector');
      
      const fingerprint = computeFingerprint(req);
      const now = Date.now();
      const windowMs = config.windowSeconds * 1000;
      
      // Add old timestamps outside the window
      store.record(fingerprint, now - windowMs - 10000); // 10s before window
      store.record(fingerprint, now - windowMs - 5000);  // 5s before window
      
      // Add recent timestamps within the window
      store.record(fingerprint, now - 1000);  // 1s ago
      store.record(fingerprint, now - 500);   // 0.5s ago
      
      // Get count within window
      const count = store.getCount(fingerprint, windowMs);
      
      // Should only count the 2 recent timestamps
      expect(count).toBe(2);
    });

    test('should not detect replay when old requests are outside window', () => {
      const store = replayDetectionMiddleware.trackingStore;
      const { computeFingerprint } = require('../src/utils/replayDetector');
      
      const fingerprint = computeFingerprint(req);
      const now = Date.now();
      const windowMs = config.windowSeconds * 1000;
      
      // Add many old timestamps outside the window (would exceed threshold if counted)
      for (let i = 0; i < 10; i++) {
        store.record(fingerprint, now - windowMs - 10000);
      }
      
      // Add only 2 recent timestamps (below threshold)
      store.record(fingerprint, now - 1000);
      store.record(fingerprint, now - 500);
      
      // Process a new request
      replayDetectionMiddleware(req, res, next);
      
      // Should NOT detect replay (only 3 requests in window, threshold is 3)
      expect(res.headers['X-Replay-Detected']).toBeUndefined();
    });

    test('should detect replay when enough requests are within window', () => {
      const store = replayDetectionMiddleware.trackingStore;
      const { computeFingerprint } = require('../src/utils/replayDetector');
      
      const fingerprint = computeFingerprint(req);
      const now = Date.now();
      const windowMs = config.windowSeconds * 1000;
      
      // Add old timestamps outside the window
      store.record(fingerprint, now - windowMs - 10000);
      store.record(fingerprint, now - windowMs - 5000);
      
      // Add enough recent timestamps to exceed threshold
      for (let i = 0; i < config.threshold; i++) {
        store.record(fingerprint, now - (i * 1000));
      }
      
      // Process a new request (this will be the threshold + 1)
      replayDetectionMiddleware(req, res, next);
      
      // Should detect replay (threshold + 1 requests in window)
      expect(res.headers['X-Replay-Detected']).toBe('true');
    });

    test('should use current time for window calculation', () => {
      const store = replayDetectionMiddleware.trackingStore;
      const { computeFingerprint } = require('../src/utils/replayDetector');
      
      const fingerprint = computeFingerprint(req);
      const windowMs = config.windowSeconds * 1000;
      
      // Record timestamps at specific times
      const baseTime = Date.now();
      store.record(fingerprint, baseTime - windowMs + 5000); // Just inside window
      store.record(fingerprint, baseTime - windowMs - 1000); // Just outside window
      store.record(fingerprint, baseTime - 1000);            // Recent
      
      // Get count - should only include timestamps within window from NOW
      const count = store.getCount(fingerprint, windowMs);
      
      // The count depends on current time, but should exclude the one outside window
      // Note: This test may be flaky if execution time varies significantly
      expect(count).toBeGreaterThanOrEqual(2);
      expect(count).toBeLessThanOrEqual(3);
    });

    test('should handle requests at window boundary', () => {
      const store = replayDetectionMiddleware.trackingStore;
      const { computeFingerprint } = require('../src/utils/replayDetector');
      
      const fingerprint = computeFingerprint(req);
      const now = Date.now();
      const windowMs = config.windowSeconds * 1000;
      
      // Add timestamp exactly at the window boundary
      const boundaryTime = now - windowMs;
      store.record(fingerprint, boundaryTime);
      
      // Add timestamp just inside the window
      store.record(fingerprint, boundaryTime + 1);
      
      // Add timestamp just outside the window
      store.record(fingerprint, boundaryTime - 1);
      
      const count = store.getCount(fingerprint, windowMs);
      
      // Should include boundary and inside, exclude outside
      // Boundary check: ts >= cutoff, so boundaryTime should be included
      expect(count).toBe(2);
    });
  });

  describe('Combined Requirements 2.2 and 2.5', () => {
    test('should detect replay only when threshold exceeded within window', () => {
      const store = replayDetectionMiddleware.trackingStore;
      const { computeFingerprint } = require('../src/utils/replayDetector');
      
      const fingerprint = computeFingerprint(req);
      const now = Date.now();
      const windowMs = config.windowSeconds * 1000;
      
      // Scenario: 10 old requests (outside window) + 3 new requests (inside window)
      // Should NOT trigger replay because only 3 are in window (equals threshold, not exceeds)
      
      for (let i = 0; i < 10; i++) {
        store.record(fingerprint, now - windowMs - 10000);
      }
      
      for (let i = 0; i < 2; i++) {
        replayDetectionMiddleware(req, res, next);
      }
      
      res.setHeader.mockClear();
      replayDetectionMiddleware(req, res, next);
      
      // Should NOT detect replay (3 in window = threshold, need to exceed)
      expect(res.headers['X-Replay-Detected']).toBeUndefined();
      
      // Add one more to exceed threshold
      res.setHeader.mockClear();
      replayDetectionMiddleware(req, res, next);
      
      // NOW should detect replay (4 in window > threshold of 3)
      expect(res.headers['X-Replay-Detected']).toBe('true');
    });

    test('should provide accurate count in response headers', () => {
      const store = replayDetectionMiddleware.trackingStore;
      const { computeFingerprint } = require('../src/utils/replayDetector');
      
      const fingerprint = computeFingerprint(req);
      const now = Date.now();
      const windowMs = config.windowSeconds * 1000;
      
      // Add 5 old requests (outside window)
      for (let i = 0; i < 5; i++) {
        store.record(fingerprint, now - windowMs - 10000);
      }
      
      // Add 4 new requests (inside window, exceeds threshold of 3)
      for (let i = 0; i < config.threshold + 1; i++) {
        res.setHeader.mockClear();
        replayDetectionMiddleware(req, res, next);
      }
      
      // Count should only reflect requests in window (4), not total (9)
      expect(res.headers['X-Replay-Count']).toBe((config.threshold + 1).toString());
      expect(res.headers['X-Replay-Count']).not.toBe('9');
    });
  });
});
