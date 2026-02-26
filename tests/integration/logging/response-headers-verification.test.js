/**
 * Verification tests for Response Header Addition (Task 5.1)
 * 
 * This test file explicitly validates requirements 5.1, 5.2, 5.3, and 5.4
 * to ensure the middleware correctly adds response headers when replay is detected
 * and does not add them when replay is not detected.
 */

const replayDetectionMiddleware = require('../../../src/middleware/replayDetection');
const config = require('../../../src/config/replayDetection');

describe('Task 5.1: Response Header Addition', () => {
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

  describe('Requirement 5.1: X-Replay-Detected header', () => {
    test('WHEN a Replay_Event is detected, THEN X-Replay-Detected header SHALL be added with value "true"', () => {
      // Send requests to exceed threshold and trigger replay detection
      for (let i = 0; i < config.threshold + 1; i++) {
        res.setHeader.mockClear();
        res.headers = {};
        replayDetectionMiddleware(req, res, next);
      }
      
      // Verify X-Replay-Detected header is present with correct value
      expect(res.headers['X-Replay-Detected']).toBe('true');
      expect(res.setHeader).toHaveBeenCalledWith('X-Replay-Detected', 'true');
    });
  });

  describe('Requirement 5.2: X-Replay-Count header', () => {
    test('WHEN a Replay_Event is detected, THEN X-Replay-Count header SHALL indicate total occurrence count', () => {
      const expectedCount = config.threshold + 1;
      
      // Send requests to exceed threshold
      for (let i = 0; i < expectedCount; i++) {
        res.setHeader.mockClear();
        res.headers = {};
        replayDetectionMiddleware(req, res, next);
      }
      
      // Verify X-Replay-Count header is present with correct count
      expect(res.headers['X-Replay-Count']).toBe(expectedCount.toString());
      expect(res.setHeader).toHaveBeenCalledWith('X-Replay-Count', expectedCount.toString());
    });

    test('X-Replay-Count should reflect accurate count for multiple replays', () => {
      // Send 10 identical requests
      const totalRequests = 10;
      
      for (let i = 0; i < totalRequests; i++) {
        res.setHeader.mockClear();
        res.headers = {};
        replayDetectionMiddleware(req, res, next);
      }
      
      // Verify count is accurate
      expect(res.headers['X-Replay-Count']).toBe(totalRequests.toString());
    });
  });

  describe('Requirement 5.3: X-Replay-Window header', () => {
    test('WHEN a Replay_Event is detected, THEN X-Replay-Window header SHALL indicate time window in seconds', () => {
      // Send requests to exceed threshold
      for (let i = 0; i < config.threshold + 1; i++) {
        res.setHeader.mockClear();
        res.headers = {};
        replayDetectionMiddleware(req, res, next);
      }
      
      // Verify X-Replay-Window header is present with correct window value
      expect(res.headers['X-Replay-Window']).toBe(config.windowSeconds.toString());
      expect(res.setHeader).toHaveBeenCalledWith('X-Replay-Window', config.windowSeconds.toString());
    });
  });

  describe('Requirement 5.4: No headers when replay not detected', () => {
    test('WHEN no Replay_Event is detected, THEN replay-related headers SHALL NOT be added', () => {
      // Send single request (below threshold)
      replayDetectionMiddleware(req, res, next);
      
      // Verify no replay headers are present
      expect(res.headers['X-Replay-Detected']).toBeUndefined();
      expect(res.headers['X-Replay-Count']).toBeUndefined();
      expect(res.headers['X-Replay-Window']).toBeUndefined();
      expect(res.setHeader).not.toHaveBeenCalled();
    });

    test('WHEN requests are below threshold, THEN no headers should be added', () => {
      // Send requests just below threshold
      for (let i = 0; i < config.threshold; i++) {
        res.setHeader.mockClear();
        res.headers = {};
        replayDetectionMiddleware(req, res, next);
      }
      
      // Verify no replay headers are present
      expect(res.headers['X-Replay-Detected']).toBeUndefined();
      expect(res.headers['X-Replay-Count']).toBeUndefined();
      expect(res.headers['X-Replay-Window']).toBeUndefined();
      expect(res.setHeader).not.toHaveBeenCalled();
    });

    test('WHEN requests are different, THEN no headers should be added', () => {
      // Send different requests
      const req1 = { ...req, path: '/api/endpoint1' };
      const req2 = { ...req, path: '/api/endpoint2' };
      const req3 = { ...req, path: '/api/endpoint3' };
      
      replayDetectionMiddleware(req1, res, next);
      res.setHeader.mockClear();
      res.headers = {};
      
      replayDetectionMiddleware(req2, res, next);
      res.setHeader.mockClear();
      res.headers = {};
      
      replayDetectionMiddleware(req3, res, next);
      
      // Verify no replay headers are present (different requests don't trigger replay)
      expect(res.headers['X-Replay-Detected']).toBeUndefined();
      expect(res.headers['X-Replay-Count']).toBeUndefined();
      expect(res.headers['X-Replay-Window']).toBeUndefined();
      expect(res.setHeader).not.toHaveBeenCalled();
    });
  });

  describe('Comprehensive validation: All requirements together', () => {
    test('WHEN replay detected, THEN all three headers are present; WHEN not detected, THEN no headers present', () => {
      // Part 1: No replay scenario
      const req1 = { ...req, path: '/api/no-replay' };
      replayDetectionMiddleware(req1, res, next);
      
      expect(res.headers['X-Replay-Detected']).toBeUndefined();
      expect(res.headers['X-Replay-Count']).toBeUndefined();
      expect(res.headers['X-Replay-Window']).toBeUndefined();
      
      // Part 2: Replay scenario
      const req2 = { ...req, path: '/api/with-replay' };
      const expectedCount = config.threshold + 2;
      
      for (let i = 0; i < expectedCount; i++) {
        res.setHeader.mockClear();
        res.headers = {};
        replayDetectionMiddleware(req2, res, next);
      }
      
      // Verify all three headers are present with correct values
      expect(res.headers['X-Replay-Detected']).toBe('true');
      expect(res.headers['X-Replay-Count']).toBe(expectedCount.toString());
      expect(res.headers['X-Replay-Window']).toBe(config.windowSeconds.toString());
      
      // Verify exactly these three headers were set (no extra headers)
      const replayHeaders = Object.keys(res.headers).filter(h => h.startsWith('X-Replay'));
      expect(replayHeaders).toHaveLength(3);
      expect(replayHeaders).toContain('X-Replay-Detected');
      expect(replayHeaders).toContain('X-Replay-Count');
      expect(replayHeaders).toContain('X-Replay-Window');
    });
  });
});
