/**
 * Verification test for Task 4.1: Replay Event Logging
 * 
 * This test verifies that all logging requirements (3.1-3.5, 9.1) are satisfied:
 * - 3.1: Log with level "warn"
 * - 3.2: Include fingerprint, count, method, path, window
 * - 3.3: Conditionally include API key if present
 * - 3.4: Include time elapsed between first and most recent occurrence
 * - 3.5: Include timestamps of all occurrences
 * - 9.1: Use existing structured logging utility
 */

const replayDetectionMiddleware = require('../../../src/middleware/replayDetection');
const log = require('../../../src/utils/log');
const config = require('../../../src/config/replayDetection');

describe('Task 4.1: Replay Event Logging Verification', () => {
  let req, res, next, logWarnSpy;

  beforeEach(() => {
    // Clear tracking store
    replayDetectionMiddleware.trackingStore.store.clear();
    
    // Spy on log.warn to capture logging calls
    logWarnSpy = jest.spyOn(log, 'warn');
    
    // Mock request
    req = {
      method: 'POST',
      path: '/api/users',
      body: { name: 'John', email: 'john@example.com' },
      headers: {}
    };

    // Mock response
    res = {
      setHeader: jest.fn()
    };

    // Mock next
    next = jest.fn();
  });

  afterEach(() => {
    logWarnSpy.mockRestore();
  });

  test('Requirement 3.1: Should log with level "warn" when replay detected', () => {
    // Trigger replay detection by exceeding threshold
    for (let i = 0; i < config.threshold + 1; i++) {
      replayDetectionMiddleware(req, res, next);
    }

    // Verify log.warn was called (not log.info or log.error)
    expect(logWarnSpy).toHaveBeenCalled();
    expect(logWarnSpy.mock.calls[0][0]).toBe('REPLAY_DETECTION');
    expect(logWarnSpy.mock.calls[0][1]).toBe('Replay detected');
  });

  test('Requirement 3.2: Should include fingerprint, count, method, path, and window', () => {
    // Trigger replay detection
    for (let i = 0; i < config.threshold + 1; i++) {
      replayDetectionMiddleware(req, res, next);
    }

    const logMeta = logWarnSpy.mock.calls[0][2];
    
    // Verify all required fields are present
    expect(logMeta.fingerprint).toBeDefined();
    expect(typeof logMeta.fingerprint).toBe('string');
    expect(logMeta.fingerprint.length).toBe(64); // SHA-256 hex string
    
    expect(logMeta.count).toBe(config.threshold + 1);
    expect(logMeta.method).toBe('POST');
    expect(logMeta.path).toBe('/api/users');
    expect(logMeta.windowSeconds).toBe(config.windowSeconds);
  });

  test('Requirement 3.3: Should include API key if present in request', () => {
    req.headers['x-api-key'] = 'key_abc123xyz';
    
    // Trigger replay detection
    for (let i = 0; i < config.threshold + 1; i++) {
      replayDetectionMiddleware(req, res, next);
    }

    const logMeta = logWarnSpy.mock.calls[0][2];
    expect(logMeta.apiKey).toBe('key_abc123xyz');
  });

  test('Requirement 3.3: Should NOT include API key if not present in request', () => {
    // No API key in headers
    
    // Trigger replay detection
    for (let i = 0; i < config.threshold + 1; i++) {
      replayDetectionMiddleware(req, res, next);
    }

    const logMeta = logWarnSpy.mock.calls[0][2];
    expect(logMeta.apiKey).toBeUndefined();
  });

  test('Requirement 3.4: Should include time elapsed between first and most recent occurrence', () => {
    // Trigger replay detection with small delays
    for (let i = 0; i < config.threshold + 1; i++) {
      replayDetectionMiddleware(req, res, next);
    }

    const logMeta = logWarnSpy.mock.calls[0][2];
    
    // Verify timeElapsedMs is present and is a number
    expect(logMeta.timeElapsedMs).toBeDefined();
    expect(typeof logMeta.timeElapsedMs).toBe('number');
    expect(logMeta.timeElapsedMs).toBeGreaterThanOrEqual(0);
  });

  test('Requirement 3.5: Should include timestamps of all occurrences within window', () => {
    // Trigger replay detection
    for (let i = 0; i < config.threshold + 1; i++) {
      replayDetectionMiddleware(req, res, next);
    }

    const logMeta = logWarnSpy.mock.calls[0][2];
    
    // Verify timestamps array is present
    expect(logMeta.timestamps).toBeDefined();
    expect(Array.isArray(logMeta.timestamps)).toBe(true);
    expect(logMeta.timestamps.length).toBe(config.threshold + 1);
    
    // Verify all timestamps are numbers
    logMeta.timestamps.forEach(ts => {
      expect(typeof ts).toBe('number');
      expect(ts).toBeGreaterThan(0);
    });
    
    // Verify timestamps are in chronological order
    for (let i = 1; i < logMeta.timestamps.length; i++) {
      expect(logMeta.timestamps[i]).toBeGreaterThanOrEqual(logMeta.timestamps[i - 1]);
    }
  });

  test('Requirement 9.1: Should use existing structured logging utility', () => {
    // Verify that the log module is the one from src/utils/log.js
    expect(log.warn).toBeDefined();
    expect(typeof log.warn).toBe('function');
    
    // Trigger replay detection
    for (let i = 0; i < config.threshold + 1; i++) {
      replayDetectionMiddleware(req, res, next);
    }

    // Verify the structured logging utility was called
    expect(logWarnSpy).toHaveBeenCalledWith(
      'REPLAY_DETECTION',
      'Replay detected',
      expect.any(Object)
    );
  });

  test('Complete logging verification: All requirements together', () => {
    req.headers['x-api-key'] = 'key_test_complete';
    
    // Trigger replay detection
    for (let i = 0; i < config.threshold + 1; i++) {
      replayDetectionMiddleware(req, res, next);
    }

    // Verify log.warn was called with correct structure
    expect(logWarnSpy).toHaveBeenCalledTimes(1);
    
    const [scope, message, meta] = logWarnSpy.mock.calls[0];
    
    // Verify scope and message
    expect(scope).toBe('REPLAY_DETECTION');
    expect(message).toBe('Replay detected');
    
    // Verify all required metadata fields
    expect(meta).toMatchObject({
      fingerprint: expect.any(String),
      count: config.threshold + 1,
      threshold: config.threshold,
      method: 'POST',
      path: '/api/users',
      windowSeconds: config.windowSeconds,
      timeElapsedMs: expect.any(Number),
      timestamps: expect.any(Array),
      apiKey: 'key_test_complete'
    });
    
    // Verify fingerprint format (SHA-256 hex)
    expect(meta.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    
    // Verify timestamps array
    expect(meta.timestamps.length).toBe(config.threshold + 1);
  });
});
