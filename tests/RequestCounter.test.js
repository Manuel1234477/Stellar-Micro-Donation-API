const RequestCounter = require('../src/middleware/RequestCounter');

describe('RequestCounter', () => {
  let counter;
  const windowMs = 1000; // 1 second for testing

  beforeEach(() => {
    counter = new RequestCounter(windowMs);
  });

  afterEach(() => {
    // Clean up any intervals to prevent test interference
    if (counter && counter.cleanupIntervalId) {
      counter.stopCleanup();
    }
  });

  describe('increment', () => {
    test('should start count at 1 for new API key', () => {
      const count = counter.increment('test-key');
      expect(count).toBe(1);
    });

    test('should increment count for subsequent requests', () => {
      counter.increment('test-key');
      const count = counter.increment('test-key');
      expect(count).toBe(2);
    });

    test('should maintain separate counts for different API keys', () => {
      counter.increment('key1');
      counter.increment('key1');
      counter.increment('key2');
      
      expect(counter.getCount('key1')).toBe(2);
      expect(counter.getCount('key2')).toBe(1);
    });

    test('should reset count after window expires', (done) => {
      counter.increment('test-key');
      counter.increment('test-key');
      expect(counter.getCount('test-key')).toBe(2);

      // Wait for window to expire
      setTimeout(() => {
        const count = counter.increment('test-key');
        expect(count).toBe(1);
        done();
      }, windowMs + 10);
    });
  });

  describe('getCount', () => {
    test('should return 0 for unknown API key', () => {
      expect(counter.getCount('unknown-key')).toBe(0);
    });

    test('should return current count for known API key', () => {
      counter.increment('test-key');
      counter.increment('test-key');
      expect(counter.getCount('test-key')).toBe(2);
    });

    test('should return 0 after window expires', (done) => {
      counter.increment('test-key');
      expect(counter.getCount('test-key')).toBe(1);

      setTimeout(() => {
        expect(counter.getCount('test-key')).toBe(0);
        done();
      }, windowMs + 10);
    });
  });

  describe('getTimeUntilReset', () => {
    test('should return 0 for unknown API key', () => {
      expect(counter.getTimeUntilReset('unknown-key')).toBe(0);
    });

    test('should return time remaining in window', () => {
      counter.increment('test-key');
      const timeRemaining = counter.getTimeUntilReset('test-key');
      
      expect(timeRemaining).toBeGreaterThan(0);
      expect(timeRemaining).toBeLessThanOrEqual(windowMs);
    });

    test('should return 0 after window expires', (done) => {
      counter.increment('test-key');

      setTimeout(() => {
        expect(counter.getTimeUntilReset('test-key')).toBe(0);
        done();
      }, windowMs + 10);
    });
  });

  describe('reset', () => {
    test('should clear all counters', () => {
      counter.increment('key1');
      counter.increment('key2');
      counter.increment('key3');

      counter.reset();

      expect(counter.getCount('key1')).toBe(0);
      expect(counter.getCount('key2')).toBe(0);
      expect(counter.getCount('key3')).toBe(0);
    });
  });

  describe('window isolation', () => {
    test('should not affect other keys when one key is incremented', () => {
      counter.increment('key1');
      counter.increment('key1');
      counter.increment('key2');

      expect(counter.getCount('key1')).toBe(2);
      expect(counter.getCount('key2')).toBe(1);
      expect(counter.getCount('key3')).toBe(0);
    });
  });

  describe('cleanup', () => {
    test('should remove expired entries', (done) => {
      counter.increment('key1');
      counter.increment('key2');
      counter.increment('key3');

      // Wait for window to expire
      setTimeout(() => {
        const removedCount = counter.cleanup();
        
        expect(removedCount).toBe(3);
        expect(counter.counters.size).toBe(0);
        done();
      }, windowMs + 10);
    });

    test('should not remove active entries', () => {
      counter.increment('key1');
      counter.increment('key2');
      
      const removedCount = counter.cleanup();
      
      expect(removedCount).toBe(0);
      expect(counter.counters.size).toBe(2);
    });

    test('should only remove expired entries, keeping active ones', (done) => {
      counter.increment('key1');
      counter.increment('key2');

      // Wait for window to expire
      setTimeout(() => {
        // Add a new entry after expiration
        counter.increment('key3');
        
        const removedCount = counter.cleanup();
        
        expect(removedCount).toBe(2);
        expect(counter.counters.size).toBe(1);
        expect(counter.getCount('key3')).toBe(1);
        done();
      }, windowMs + 10);
    });
  });

  describe('automatic cleanup', () => {
    test('should schedule automatic cleanup when interval provided', () => {
      const counterWithCleanup = new RequestCounter(windowMs, 100);
      
      expect(counterWithCleanup.cleanupIntervalId).not.toBeNull();
      
      counterWithCleanup.stopCleanup();
    });

    test('should not schedule cleanup when interval not provided', () => {
      const counterNoCleanup = new RequestCounter(windowMs);
      
      expect(counterNoCleanup.cleanupIntervalId).toBeNull();
    });

    test('should automatically remove expired entries', (done) => {
      const cleanupInterval = 50;
      const counterWithCleanup = new RequestCounter(windowMs, cleanupInterval);
      
      counterWithCleanup.increment('key1');
      counterWithCleanup.increment('key2');

      // Wait for window to expire and cleanup to run
      setTimeout(() => {
        expect(counterWithCleanup.counters.size).toBe(0);
        counterWithCleanup.stopCleanup();
        done();
      }, windowMs + cleanupInterval + 50);
    });
  });

  describe('stopCleanup', () => {
    test('should stop automatic cleanup', () => {
      const counterWithCleanup = new RequestCounter(windowMs, 100);
      
      expect(counterWithCleanup.cleanupIntervalId).not.toBeNull();
      
      counterWithCleanup.stopCleanup();
      
      expect(counterWithCleanup.cleanupIntervalId).toBeNull();
    });

    test('should be safe to call when no cleanup is scheduled', () => {
      const counterNoCleanup = new RequestCounter(windowMs);
      
      expect(() => counterNoCleanup.stopCleanup()).not.toThrow();
      expect(counterNoCleanup.cleanupIntervalId).toBeNull();
    });
  });
});
