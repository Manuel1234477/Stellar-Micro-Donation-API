/**
 * Replay Detection Middleware
 * 
 * This middleware provides observability into repeated identical requests that may indicate
 * client misconfiguration, replay attacks, or accidental duplicate submissions.
 * 
 * Key features:
 * - Non-blocking: Never rejects or delays requests
 * - Computes fingerprint from request body, endpoint, and method
 * - Tracks fingerprints in memory with timestamps
 * - Logs replay events when threshold is exceeded
 * - Adds response headers for client observability
 * 
 * Requirements: 4.1, 4.2, 4.3, 9.2
 */

const { computeFingerprint, TrackingStore } = require('../utils/replayDetector');
const config = require('../config/replayDetection');
const log = require('../utils/log');

// Singleton tracking store instance
const trackingStore = new TrackingStore();

/**
 * Replay detection middleware function
 * Processes each request to detect and log replay patterns
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
function replayDetectionMiddleware(req, res, next) {
  try {
    // 1. Compute request fingerprint
    const fingerprint = computeFingerprint(req);
    const timestamp = Date.now();
    
    // 2. Record fingerprint with timestamp in tracking store
    trackingStore.record(fingerprint, timestamp);
    
    // 3. Check if threshold exceeded within the replay window
    const windowMs = config.windowSeconds * 1000;
    const count = trackingStore.getCount(fingerprint, windowMs);
    const isReplay = count > config.threshold;
    
    // 4. If replay detected, log event and add response headers
    if (isReplay) {
      const timestamps = trackingStore.getTimestamps(fingerprint, windowMs);
      const timeElapsedMs = timestamps.length > 0 
        ? timestamp - timestamps[0] 
        : 0;
      
      // Build log metadata
      const logMeta = {
        fingerprint,
        count,
        threshold: config.threshold,
        method: req.method,
        path: req.path,
        windowSeconds: config.windowSeconds,
        timeElapsedMs,
        timestamps
      };
      
      // Include API key if present in request
      if (req.headers['x-api-key']) {
        logMeta.apiKey = req.headers['x-api-key'];
      }
      
      // Log replay event with warn level
      log.warn('REPLAY_DETECTION', 'Replay detected', logMeta);
      
      // Add response headers for client observability
      res.setHeader('X-Replay-Detected', 'true');
      res.setHeader('X-Replay-Count', count.toString());
      res.setHeader('X-Replay-Window', config.windowSeconds.toString());
    }
  } catch (error) {
    // Log error but always continue processing
    log.error('REPLAY_DETECTION', 'Replay detection error', {
      error: error.message,
      stack: error.stack,
      path: req.path,
      method: req.method
    });
  } finally {
    // Always call next() to ensure request processing continues
    // This is critical for non-blocking behavior (Requirement 4.1, 4.2, 4.3)
    next();
  }
}

// Export middleware function and tracking store for testing/admin access
module.exports = replayDetectionMiddleware;
module.exports.trackingStore = trackingStore;
