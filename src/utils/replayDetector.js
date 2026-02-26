const crypto = require('crypto');
const log = require('./log');

/**
 * TrackingStore - In-memory storage for request fingerprints and timestamps
 * Tracks fingerprint -> array of timestamps for replay detection
 */
class TrackingStore {
  constructor() {
    // Map: fingerprint (string) -> array of timestamps (numbers)
    this.store = new Map();
  }

  /**
   * Record a fingerprint with a timestamp
   * @param {string} fingerprint - Request fingerprint hash
   * @param {number} timestamp - Timestamp in milliseconds
   */
  record(fingerprint, timestamp) {
    if (!this.store.has(fingerprint)) {
      this.store.set(fingerprint, []);
    }
    
    const timestamps = this.store.get(fingerprint);
    timestamps.push(timestamp);
  }

  /**
   * Get count of timestamps within the time window for a fingerprint
   * @param {string} fingerprint - Request fingerprint hash
   * @param {number} windowMs - Time window in milliseconds
   * @returns {number} Count of timestamps within window
   */
  getCount(fingerprint, windowMs) {
    const timestamps = this.getTimestamps(fingerprint, windowMs);
    return timestamps.length;
  }

  /**
   * Get timestamps within the time window for a fingerprint
   * @param {string} fingerprint - Request fingerprint hash
   * @param {number} windowMs - Time window in milliseconds
   * @returns {Array<number>} Array of timestamps within window
   */
  getTimestamps(fingerprint, windowMs) {
    if (!this.store.has(fingerprint)) {
      return [];
    }

    const now = Date.now();
    const cutoff = now - windowMs;
    const timestamps = this.store.get(fingerprint);
    
    // Return only timestamps within the window
    return timestamps.filter(ts => ts >= cutoff);
  }

  /**
   * Cleanup old timestamps outside the window
   * Removes fingerprints with no remaining timestamps
   * @param {number} windowMs - Time window in milliseconds
   * @returns {Object} Statistics about cleanup operation
   */
  cleanup(windowMs) {
    const now = Date.now();
    const cutoff = now - windowMs;
    
    let fingerprintsRemoved = 0;
    let timestampsRemoved = 0;

    for (const [fingerprint, timestamps] of this.store.entries()) {
      const originalCount = timestamps.length;
      
      // Filter out old timestamps
      const recentTimestamps = timestamps.filter(ts => ts >= cutoff);
      timestampsRemoved += originalCount - recentTimestamps.length;

      if (recentTimestamps.length === 0) {
        // Remove fingerprint if no timestamps remain
        this.store.delete(fingerprint);
        fingerprintsRemoved++;
      } else if (recentTimestamps.length < originalCount) {
        // Update with filtered timestamps
        this.store.set(fingerprint, recentTimestamps);
      }
    }

    return {
      fingerprintsRemoved,
      timestampsRemoved
    };
  }

  /**
   * Get statistics about the tracking store
   * @param {Object} config - Optional configuration object with windowSeconds and threshold
   * @returns {Object} Statistics object
   */
  getStats(config = {}) {
    let totalTimestamps = 0;
    const fingerprintData = [];

    for (const [fingerprint, timestamps] of this.store.entries()) {
      totalTimestamps += timestamps.length;
      fingerprintData.push({
        fingerprint,
        count: timestamps.length,
        oldestTimestamp: timestamps.length > 0 ? Math.min(...timestamps) : null,
        newestTimestamp: timestamps.length > 0 ? Math.max(...timestamps) : null
      });
    }

    // Sort by count descending for top fingerprints
    fingerprintData.sort((a, b) => b.count - a.count);

    // Get overall oldest and newest timestamps
    let oldestTimestamp = null;
    let newestTimestamp = null;
    
    if (fingerprintData.length > 0) {
      const allOldest = fingerprintData
        .map(f => f.oldestTimestamp)
        .filter(t => t !== null);
      const allNewest = fingerprintData
        .map(f => f.newestTimestamp)
        .filter(t => t !== null);
      
      if (allOldest.length > 0) {
        oldestTimestamp = Math.min(...allOldest);
      }
      if (allNewest.length > 0) {
        newestTimestamp = Math.max(...allNewest);
      }
    }

    const stats = {
      totalFingerprints: this.store.size,
      totalTimestamps,
      topFingerprints: fingerprintData.slice(0, 10), // Top 10
      oldestTimestamp,
      newestTimestamp
    };

    // Include window and threshold if provided in config
    if (config.windowSeconds !== undefined) {
      stats.windowSeconds = config.windowSeconds;
    }
    if (config.threshold !== undefined) {
      stats.threshold = config.threshold;
    }

    return stats;
  }
}

/**
 * Recursively sort object keys for stable JSON serialization
 * @param {*} obj - Object to sort
 * @returns {*} Object with sorted keys
 */
function sortKeys(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(sortKeys);
  }
  
  const sorted = {};
  Object.keys(obj).sort().forEach(key => {
    sorted[key] = sortKeys(obj[key]);
  });
  
  return sorted;
}

/**
 * Compute a unique fingerprint for a request
 * Uses SHA-256 hash of JSON-serialized {method, path, body}
 * @param {Object} req - Express request object
 * @returns {string} 64-character hex string (SHA-256 hash)
 */
function computeFingerprint(req) {
  const components = {
    method: req.method,
    path: req.path,
    body: req.body || ''
  };
  
  // Sort keys recursively for stable serialization
  const sortedComponents = sortKeys(components);
  
  // Serialize to stable JSON string
  const payload = JSON.stringify(sortedComponents);
  
  // Compute SHA-256 hash
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Start the cleanup timer process
 * Periodically removes old timestamps from the tracking store
 * @param {TrackingStore} store - The tracking store instance
 * @param {Object} config - Configuration object with cleanupIntervalSeconds and windowSeconds
 * @returns {NodeJS.Timeout} Timer reference for shutdown
 */
function startCleanup(store, config) {
  const intervalMs = config.cleanupIntervalSeconds * 1000;
  const windowMs = config.windowSeconds * 1000;
  
  const timer = setInterval(() => {
    try {
      // Get stats before cleanup (pass config for complete stats)
      const before = store.getStats(config);
      
      // Run cleanup
      const cleanupResult = store.cleanup(windowMs);
      
      // Get stats after cleanup (pass config for complete stats)
      const after = store.getStats(config);
      
      // Log cleanup statistics
      log.info('REPLAY_DETECTION_CLEANUP', 'Replay detection cleanup completed', {
        fingerprintsRemoved: cleanupResult.fingerprintsRemoved,
        timestampsRemoved: cleanupResult.timestampsRemoved,
        fingerprintsBefore: before.totalFingerprints,
        fingerprintsAfter: after.totalFingerprints,
        timestampsBefore: before.totalTimestamps,
        timestampsAfter: after.totalTimestamps,
        windowSeconds: config.windowSeconds
      });
    } catch (error) {
      // Log error but continue - cleanup failures should not crash the process
      log.error('REPLAY_DETECTION_CLEANUP', 'Cleanup operation failed', {
        error: error.message,
        stack: error.stack
      });
    }
  }, intervalMs);
  
  // Return timer reference for shutdown
  return timer;
}

module.exports = { TrackingStore, computeFingerprint, startCleanup };
