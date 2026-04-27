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

/** Paths that are always exempt from replay detection */
const EXEMPT_PATHS = new Set(['/health', '/health/live', '/health/ready']);

/** Hard timeout (ms) for the replay check — fail open if exceeded */
const TIMEOUT_MS = parseInt(process.env.REPLAY_DETECTION_TIMEOUT_MS, 10) || 200;

/**
 * Replay detection middleware function
 * Processes each request to detect and log replay patterns
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
function replayDetectionMiddleware(req, res, next) {
  // Exempt health-check endpoints so they always respond instantly
  if (EXEMPT_PATHS.has(req.path)) {
    return next();
  }

  let done = false;

  // Fail-open timeout: if the check hasn't finished within TIMEOUT_MS, call next() immediately
  const timer = setTimeout(() => {
    if (!done) {
      done = true;
      log.warn('REPLAY_DETECTION', 'Replay detection timed out — failing open', {
        path: req.path,
        method: req.method,
        timeoutMs: TIMEOUT_MS,
      });
      next();
    }
  }, TIMEOUT_MS);

  // Wrap core logic in a promise so it works whether the store is sync or async
  Promise.resolve()
    .then(() => runCheck(req, res))
    .catch((error) => {
      log.error('REPLAY_DETECTION', 'Replay detection error', {
        error: error.message,
        stack: error.stack,
        path: req.path,
        method: req.method,
      });
    })
    .finally(() => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        next();
      }
    });
}

/**
 * Core replay-check logic (sync today, may become async if store is replaced).
 */
function runCheck(req, res) {
  const fingerprint = computeFingerprint(req);
  const timestamp = Date.now();

  trackingStore.record(fingerprint, timestamp);

  const windowMs = config.windowSeconds * 1000;
  const count = trackingStore.getCount(fingerprint, windowMs);

  if (count > config.threshold) {
    const timestamps = trackingStore.getTimestamps(fingerprint, windowMs);
    const logMeta = {
      fingerprint,
      count,
      threshold: config.threshold,
      method: req.method,
      path: req.path,
      windowSeconds: config.windowSeconds,
      timeElapsedMs: timestamps.length > 0 ? timestamp - timestamps[0] : 0,
      timestamps,
    };
    if (req.headers['x-api-key']) logMeta.apiKey = req.headers['x-api-key'];
    log.warn('REPLAY_DETECTION', 'Replay detected', logMeta);

    res.setHeader('X-Replay-Detected', 'true');
    res.setHeader('X-Replay-Count', count.toString());
    res.setHeader('X-Replay-Window', config.windowSeconds.toString());
  }
}

// Export middleware function and tracking store for testing/admin access
module.exports = replayDetectionMiddleware;
module.exports.trackingStore = trackingStore;
module.exports.EXEMPT_PATHS = EXEMPT_PATHS;
module.exports.TIMEOUT_MS = TIMEOUT_MS;
