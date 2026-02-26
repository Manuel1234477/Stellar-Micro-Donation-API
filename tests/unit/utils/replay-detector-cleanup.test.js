/**
 * Unit tests for cleanup timer process
 * Tests startCleanup() function that periodically cleans the tracking store
 */

const { TrackingStore, startCleanup } = require('../../../src/utils/replayDetector');
const log = require('../../../src/utils/log');

// Mock the log module
jest.mock('../../../src/utils/log', () => ({
  info: jest.fn(),
  error: jest.fn()
}));

describe('startCleanup()', () => {
  let store;
  let timer;

  beforeEach(() => {
    store = new TrackingStore();
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    if (timer) {
      clearInterval(timer);
    }
    jest.useRealTimers();
  });

  test('should return a timer reference', () => {
    const config = {
      cleanupIntervalSeconds: 60,
      windowSeconds: 60
    };

    timer = startCleanup(store, config);

    expect(timer).toBeDefined();
    expect(typeof timer).toBe('object');
  });

  test('should run cleanup at configured interval', () => {
    const config = {
      cleanupIntervalSeconds: 10, // 10 seconds
      windowSeconds: 60
    };

    timer = startCleanup(store, config);

    // Initially, no cleanup should have run
    expect(log.info).not.toHaveBeenCalled();

    // Advance time by 10 seconds
    jest.advanceTimersByTime(10000);

    // Cleanup should have run once
    expect(log.info).toHaveBeenCalledTimes(1);

    // Advance time by another 10 seconds
    jest.advanceTimersByTime(10000);

    // Cleanup should have run twice
    expect(log.info).toHaveBeenCalledTimes(2);
  });

  test('should log cleanup statistics after each run', () => {
    const config = {
      cleanupIntervalSeconds: 60,
      windowSeconds: 60
    };

    const now = Date.now();
    // Add some old timestamps that will be cleaned up
    store.record('fp1', now - 70000); // Old
    store.record('fp1', now - 80000); // Old
    store.record('fp2', now - 50000); // Recent

    timer = startCleanup(store, config);

    // Advance time to trigger cleanup
    jest.advanceTimersByTime(60000);

    // Verify log was called with correct scope and message
    expect(log.info).toHaveBeenCalledWith(
      'REPLAY_DETECTION_CLEANUP',
      'Replay detection cleanup completed',
      expect.objectContaining({
        fingerprintsRemoved: expect.any(Number),
        timestampsRemoved: expect.any(Number),
        fingerprintsBefore: expect.any(Number),
        fingerprintsAfter: expect.any(Number),
        timestampsBefore: expect.any(Number),
        timestampsAfter: expect.any(Number),
        windowSeconds: 60
      })
    );
  });

  test('should log correct statistics about removed entries', () => {
    const config = {
      cleanupIntervalSeconds: 60,
      windowSeconds: 60
    };

    const now = Date.now();
    // Add fingerprints that will be completely removed (older than 60s)
    store.record('old1', now - 70000);
    store.record('old1', now - 80000);
    store.record('old2', now - 90000);
    
    // Add fingerprint that will remain (within 60s window)
    store.record('recent', now - 30000);

    timer = startCleanup(store, config);

    // Advance time to trigger cleanup
    // Note: When we advance timers, Date.now() also advances, so the "recent" 
    // timestamp becomes 90s old (30s + 60s), which is outside the 60s window
    jest.advanceTimersByTime(60000);

    // Verify the logged statistics
    const logCall = log.info.mock.calls[0][2];
    // All fingerprints are removed because advancing time makes all timestamps old
    expect(logCall.fingerprintsRemoved).toBe(3); // old1, old2, and recent
    expect(logCall.timestampsRemoved).toBe(4); // 2 from old1, 1 from old2, 1 from recent
    expect(logCall.fingerprintsBefore).toBe(3);
    expect(logCall.fingerprintsAfter).toBe(0);
    expect(logCall.timestampsBefore).toBe(4);
    expect(logCall.timestampsAfter).toBe(0);
  });

  test('should handle cleanup errors gracefully', () => {
    const config = {
      cleanupIntervalSeconds: 60,
      windowSeconds: 60
    };

    // Mock cleanup to throw an error
    store.cleanup = jest.fn(() => {
      throw new Error('Cleanup failed');
    });

    timer = startCleanup(store, config);

    // Advance time to trigger cleanup
    jest.advanceTimersByTime(60000);

    // Verify error was logged
    expect(log.error).toHaveBeenCalledWith(
      'REPLAY_DETECTION_CLEANUP',
      'Cleanup operation failed',
      expect.objectContaining({
        error: 'Cleanup failed',
        stack: expect.any(String)
      })
    );

    // Timer should still be running (not crashed)
    expect(timer).toBeDefined();
  });

  test('should continue running after cleanup error', () => {
    const config = {
      cleanupIntervalSeconds: 60,
      windowSeconds: 60
    };

    let callCount = 0;
    store.cleanup = jest.fn(() => {
      callCount++;
      if (callCount === 1) {
        throw new Error('First cleanup failed');
      }
      return { fingerprintsRemoved: 0, timestampsRemoved: 0 };
    });

    timer = startCleanup(store, config);

    // First cleanup - should fail
    jest.advanceTimersByTime(60000);
    expect(log.error).toHaveBeenCalledTimes(1);

    // Second cleanup - should succeed
    jest.advanceTimersByTime(60000);
    expect(log.info).toHaveBeenCalledTimes(1);
  });

  test('should use correct window size for cleanup', () => {
    const config = {
      cleanupIntervalSeconds: 60,
      windowSeconds: 120 // 2 minutes
    };

    const cleanupSpy = jest.spyOn(store, 'cleanup');

    timer = startCleanup(store, config);

    // Advance time to trigger cleanup
    jest.advanceTimersByTime(60000);

    // Verify cleanup was called with correct window in milliseconds
    expect(cleanupSpy).toHaveBeenCalledWith(120000);
  });

  test('should handle empty store gracefully', () => {
    const config = {
      cleanupIntervalSeconds: 60,
      windowSeconds: 60
    };

    timer = startCleanup(store, config);

    // Advance time to trigger cleanup
    jest.advanceTimersByTime(60000);

    // Should log with zero counts
    const logCall = log.info.mock.calls[0][2];
    expect(logCall.fingerprintsRemoved).toBe(0);
    expect(logCall.timestampsRemoved).toBe(0);
    expect(logCall.fingerprintsBefore).toBe(0);
    expect(logCall.fingerprintsAfter).toBe(0);
  });

  test('should be stoppable via clearInterval', () => {
    const config = {
      cleanupIntervalSeconds: 60,
      windowSeconds: 60
    };

    timer = startCleanup(store, config);

    // Stop the timer
    clearInterval(timer);

    // Advance time
    jest.advanceTimersByTime(60000);

    // Cleanup should not have run
    expect(log.info).not.toHaveBeenCalled();
  });

  test('should handle different cleanup interval configurations', () => {
    const config = {
      cleanupIntervalSeconds: 30, // 30 seconds
      windowSeconds: 60
    };

    timer = startCleanup(store, config);

    // Advance time by 30 seconds
    jest.advanceTimersByTime(30000);
    expect(log.info).toHaveBeenCalledTimes(1);

    // Advance time by another 30 seconds
    jest.advanceTimersByTime(30000);
    expect(log.info).toHaveBeenCalledTimes(2);

    // Advance time by another 30 seconds
    jest.advanceTimersByTime(30000);
    expect(log.info).toHaveBeenCalledTimes(3);
  });
});
