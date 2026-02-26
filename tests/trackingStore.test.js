/**
 * Unit tests for TrackingStore class
 * Tests recording, counting, timestamp retrieval, cleanup, and statistics
 */

const { TrackingStore } = require('../src/utils/replayDetector');

describe('TrackingStore', () => {
  let store;

  beforeEach(() => {
    store = new TrackingStore();
  });

  describe('record()', () => {
    test('should record a fingerprint with timestamp', () => {
      const fingerprint = 'abc123';
      const timestamp = Date.now();

      store.record(fingerprint, timestamp);

      const timestamps = store.getTimestamps(fingerprint, 60000);
      expect(timestamps).toContain(timestamp);
    });

    test('should record multiple timestamps for same fingerprint', () => {
      const fingerprint = 'abc123';
      const timestamp1 = Date.now();
      const timestamp2 = Date.now() + 1000;
      const timestamp3 = Date.now() + 2000;

      store.record(fingerprint, timestamp1);
      store.record(fingerprint, timestamp2);
      store.record(fingerprint, timestamp3);

      const timestamps = store.getTimestamps(fingerprint, 60000);
      expect(timestamps).toHaveLength(3);
      expect(timestamps).toContain(timestamp1);
      expect(timestamps).toContain(timestamp2);
      expect(timestamps).toContain(timestamp3);
    });

    test('should record different fingerprints independently', () => {
      const fingerprint1 = 'abc123';
      const fingerprint2 = 'def456';
      const timestamp1 = Date.now();
      const timestamp2 = Date.now() + 1000;

      store.record(fingerprint1, timestamp1);
      store.record(fingerprint2, timestamp2);

      const timestamps1 = store.getTimestamps(fingerprint1, 60000);
      const timestamps2 = store.getTimestamps(fingerprint2, 60000);

      expect(timestamps1).toHaveLength(1);
      expect(timestamps2).toHaveLength(1);
      expect(timestamps1).toContain(timestamp1);
      expect(timestamps2).toContain(timestamp2);
    });
  });

  describe('getCount()', () => {
    test('should return 0 for non-existent fingerprint', () => {
      const count = store.getCount('nonexistent', 60000);
      expect(count).toBe(0);
    });

    test('should return correct count for fingerprint within window', () => {
      const fingerprint = 'abc123';
      const now = Date.now();

      store.record(fingerprint, now - 5000);
      store.record(fingerprint, now - 3000);
      store.record(fingerprint, now - 1000);

      const count = store.getCount(fingerprint, 10000);
      expect(count).toBe(3);
    });

    test('should exclude timestamps outside window', () => {
      const fingerprint = 'abc123';
      const now = Date.now();

      store.record(fingerprint, now - 70000); // Outside 60s window
      store.record(fingerprint, now - 50000); // Inside window
      store.record(fingerprint, now - 30000); // Inside window

      const count = store.getCount(fingerprint, 60000);
      expect(count).toBe(2);
    });

    test('should return 0 when all timestamps are outside window', () => {
      const fingerprint = 'abc123';
      const now = Date.now();

      store.record(fingerprint, now - 70000);
      store.record(fingerprint, now - 80000);

      const count = store.getCount(fingerprint, 60000);
      expect(count).toBe(0);
    });
  });

  describe('getTimestamps()', () => {
    test('should return empty array for non-existent fingerprint', () => {
      const timestamps = store.getTimestamps('nonexistent', 60000);
      expect(timestamps).toEqual([]);
    });

    test('should return timestamps within window', () => {
      const fingerprint = 'abc123';
      const now = Date.now();
      const ts1 = now - 5000;
      const ts2 = now - 3000;
      const ts3 = now - 1000;

      store.record(fingerprint, ts1);
      store.record(fingerprint, ts2);
      store.record(fingerprint, ts3);

      const timestamps = store.getTimestamps(fingerprint, 10000);
      expect(timestamps).toHaveLength(3);
      expect(timestamps).toContain(ts1);
      expect(timestamps).toContain(ts2);
      expect(timestamps).toContain(ts3);
    });

    test('should exclude timestamps outside window', () => {
      const fingerprint = 'abc123';
      const now = Date.now();
      const oldTs = now - 70000;
      const recentTs1 = now - 50000;
      const recentTs2 = now - 30000;

      store.record(fingerprint, oldTs);
      store.record(fingerprint, recentTs1);
      store.record(fingerprint, recentTs2);

      const timestamps = store.getTimestamps(fingerprint, 60000);
      expect(timestamps).toHaveLength(2);
      expect(timestamps).not.toContain(oldTs);
      expect(timestamps).toContain(recentTs1);
      expect(timestamps).toContain(recentTs2);
    });

    test('should return empty array when all timestamps are outside window', () => {
      const fingerprint = 'abc123';
      const now = Date.now();

      store.record(fingerprint, now - 70000);
      store.record(fingerprint, now - 80000);

      const timestamps = store.getTimestamps(fingerprint, 60000);
      expect(timestamps).toEqual([]);
    });
  });

  describe('cleanup()', () => {
    test('should remove timestamps outside window', () => {
      const fingerprint = 'abc123';
      const now = Date.now();

      store.record(fingerprint, now - 70000); // Old
      store.record(fingerprint, now - 50000); // Recent
      store.record(fingerprint, now - 30000); // Recent

      const result = store.cleanup(60000);

      expect(result.timestampsRemoved).toBe(1);
      const timestamps = store.getTimestamps(fingerprint, 100000);
      expect(timestamps).toHaveLength(2);
    });

    test('should remove fingerprint when all timestamps are removed', () => {
      const fingerprint = 'abc123';
      const now = Date.now();

      store.record(fingerprint, now - 70000);
      store.record(fingerprint, now - 80000);

      const result = store.cleanup(60000);

      expect(result.fingerprintsRemoved).toBe(1);
      expect(result.timestampsRemoved).toBe(2);
      
      const stats = store.getStats();
      expect(stats.totalFingerprints).toBe(0);
    });

    test('should not remove fingerprints with recent timestamps', () => {
      const fingerprint = 'abc123';
      const now = Date.now();

      store.record(fingerprint, now - 50000);
      store.record(fingerprint, now - 30000);

      const result = store.cleanup(60000);

      expect(result.fingerprintsRemoved).toBe(0);
      expect(result.timestampsRemoved).toBe(0);
      
      const stats = store.getStats();
      expect(stats.totalFingerprints).toBe(1);
    });

    test('should handle multiple fingerprints during cleanup', () => {
      const now = Date.now();

      // Fingerprint with all old timestamps - should be removed
      store.record('old', now - 70000);
      store.record('old', now - 80000);

      // Fingerprint with mixed timestamps - should keep recent ones
      store.record('mixed', now - 70000);
      store.record('mixed', now - 30000);

      // Fingerprint with all recent timestamps - should keep all
      store.record('recent', now - 50000);
      store.record('recent', now - 30000);

      const result = store.cleanup(60000);

      expect(result.fingerprintsRemoved).toBe(1); // 'old' removed
      expect(result.timestampsRemoved).toBe(3); // 2 from 'old', 1 from 'mixed'
      
      const stats = store.getStats();
      expect(stats.totalFingerprints).toBe(2); // 'mixed' and 'recent' remain
    });

    test('should return zero counts when store is empty', () => {
      const result = store.cleanup(60000);

      expect(result.fingerprintsRemoved).toBe(0);
      expect(result.timestampsRemoved).toBe(0);
    });
  });

  describe('getStats()', () => {
    test('should return empty stats for empty store', () => {
      const stats = store.getStats();

      expect(stats.totalFingerprints).toBe(0);
      expect(stats.totalTimestamps).toBe(0);
      expect(stats.topFingerprints).toEqual([]);
      expect(stats.oldestTimestamp).toBeNull();
      expect(stats.newestTimestamp).toBeNull();
    });

    test('should return correct stats for single fingerprint', () => {
      const fingerprint = 'abc123';
      const ts1 = 1000;
      const ts2 = 2000;
      const ts3 = 3000;

      store.record(fingerprint, ts1);
      store.record(fingerprint, ts2);
      store.record(fingerprint, ts3);

      const stats = store.getStats();

      expect(stats.totalFingerprints).toBe(1);
      expect(stats.totalTimestamps).toBe(3);
      expect(stats.oldestTimestamp).toBe(1000);
      expect(stats.newestTimestamp).toBe(3000);
      expect(stats.topFingerprints).toHaveLength(1);
      expect(stats.topFingerprints[0]).toMatchObject({
        fingerprint: 'abc123',
        count: 3,
        oldestTimestamp: 1000,
        newestTimestamp: 3000
      });
    });

    test('should return correct stats for multiple fingerprints', () => {
      store.record('fp1', 1000);
      store.record('fp1', 2000);
      store.record('fp2', 1500);
      store.record('fp2', 2500);
      store.record('fp2', 3500);
      store.record('fp3', 500);

      const stats = store.getStats();

      expect(stats.totalFingerprints).toBe(3);
      expect(stats.totalTimestamps).toBe(6);
      expect(stats.oldestTimestamp).toBe(500);
      expect(stats.newestTimestamp).toBe(3500);
    });

    test('should sort topFingerprints by count descending', () => {
      store.record('fp1', 1000);
      store.record('fp2', 1000);
      store.record('fp2', 2000);
      store.record('fp2', 3000);
      store.record('fp3', 1000);
      store.record('fp3', 2000);

      const stats = store.getStats();

      expect(stats.topFingerprints).toHaveLength(3);
      expect(stats.topFingerprints[0].fingerprint).toBe('fp2');
      expect(stats.topFingerprints[0].count).toBe(3);
      expect(stats.topFingerprints[1].count).toBe(2);
      expect(stats.topFingerprints[2].count).toBe(1);
    });

    test('should limit topFingerprints to 10 entries', () => {
      // Create 15 fingerprints
      for (let i = 0; i < 15; i++) {
        store.record(`fp${i}`, Date.now());
      }

      const stats = store.getStats();

      expect(stats.topFingerprints).toHaveLength(10);
    });

    test('should include correct oldest and newest timestamps per fingerprint', () => {
      store.record('fp1', 1000);
      store.record('fp1', 5000);
      store.record('fp1', 3000);

      const stats = store.getStats();

      expect(stats.topFingerprints[0].oldestTimestamp).toBe(1000);
      expect(stats.topFingerprints[0].newestTimestamp).toBe(5000);
    });

    test('should include windowSeconds when provided in config', () => {
      store.record('fp1', 1000);

      const stats = store.getStats({ windowSeconds: 60 });

      expect(stats.windowSeconds).toBe(60);
    });

    test('should include threshold when provided in config', () => {
      store.record('fp1', 1000);

      const stats = store.getStats({ threshold: 3 });

      expect(stats.threshold).toBe(3);
    });

    test('should include both windowSeconds and threshold when provided', () => {
      store.record('fp1', 1000);

      const stats = store.getStats({ windowSeconds: 60, threshold: 3 });

      expect(stats.windowSeconds).toBe(60);
      expect(stats.threshold).toBe(3);
    });

    test('should not include windowSeconds or threshold when not provided', () => {
      store.record('fp1', 1000);

      const stats = store.getStats();

      expect(stats.windowSeconds).toBeUndefined();
      expect(stats.threshold).toBeUndefined();
    });

    test('should work with empty config object', () => {
      store.record('fp1', 1000);

      const stats = store.getStats({});

      expect(stats.totalFingerprints).toBe(1);
      expect(stats.windowSeconds).toBeUndefined();
      expect(stats.threshold).toBeUndefined();
    });
  });

  describe('Edge Cases', () => {
    test('should handle very large timestamp values', () => {
      const fingerprint = 'abc123';
      const largeTimestamp = Date.now() + 1000000000;

      store.record(fingerprint, largeTimestamp);

      const count = store.getCount(fingerprint, 60000);
      expect(count).toBe(1);
    });

    test('should handle zero window size', () => {
      const fingerprint = 'abc123';
      const now = Date.now();
      store.record(fingerprint, now - 1000); // 1 second ago

      const count = store.getCount(fingerprint, 0);
      expect(count).toBe(0); // Should not count timestamps from the past
    });

    test('should handle very large window size', () => {
      const fingerprint = 'abc123';
      const now = Date.now();

      store.record(fingerprint, now - 1000000);
      store.record(fingerprint, now);

      const count = store.getCount(fingerprint, 10000000);
      expect(count).toBe(2);
    });

    test('should handle long fingerprint strings', () => {
      const longFingerprint = 'a'.repeat(1000);
      store.record(longFingerprint, Date.now());

      const count = store.getCount(longFingerprint, 60000);
      expect(count).toBe(1);
    });
  });
});
