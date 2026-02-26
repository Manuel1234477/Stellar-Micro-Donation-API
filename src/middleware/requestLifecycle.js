/**
 * Request Lifecycle Timeline Middleware
 * 
 * RESPONSIBILITY: Track and log request lifecycle timestamps for latency analysis
 * OWNER: Backend Team
 * DEPENDENCIES: Logger utility
 * 
 * Tracks key lifecycle stages with minimal overhead:
 * - received: Request enters the system
 * - validated: Authentication/validation complete
 * - processed: Business logic execution complete
 * - responded: Response sent to client
 */

const log = require('../utils/log');

/**
 * Lifecycle stages enum
 */
const LIFECYCLE_STAGES = {
  RECEIVED: 'received',
  VALIDATED: 'validated',
  PROCESSED: 'processed',
  RESPONDED: 'responded'
};

/**
 * Attach lifecycle tracking to request object
 * Minimal overhead - only stores timestamps
 */
function attachLifecycleTracking(req, res, next) {
  // Initialize timeline with received timestamp
  req.lifecycle = {
    [LIFECYCLE_STAGES.RECEIVED]: Date.now(),
    stages: {}
  };

  // Helper to mark lifecycle stages
  req.markLifecycleStage = (stage) => {
    req.lifecycle.stages[stage] = Date.now();
  };

  // Capture response finish event
  res.on('finish', () => {
    const respondedAt = Date.now();
    const receivedAt = req.lifecycle[LIFECYCLE_STAGES.RECEIVED];
    const validatedAt = req.lifecycle.stages[LIFECYCLE_STAGES.VALIDATED] || receivedAt;
    const processedAt = req.lifecycle.stages[LIFECYCLE_STAGES.PROCESSED] || validatedAt;

    // Calculate durations
    const totalDuration = respondedAt - receivedAt;
    const validationDuration = validatedAt - receivedAt;
    const processingDuration = processedAt - validatedAt;
    const responseDuration = respondedAt - processedAt;

    // Log timeline (lightweight structured log)
    log.info('REQUEST_LIFECYCLE', 'Request timeline', {
      requestId: req.id,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      timeline: {
        received: receivedAt,
        validated: validatedAt,
        processed: processedAt,
        responded: respondedAt
      },
      durations: {
        total: totalDuration,
        validation: validationDuration,
        processing: processingDuration,
        response: responseDuration
      }
    });
  });

  // Mark validated stage after middleware chain
  process.nextTick(() => {
    if (req.lifecycle && !req.lifecycle.stages[LIFECYCLE_STAGES.VALIDATED]) {
      req.markLifecycleStage(LIFECYCLE_STAGES.VALIDATED);
    }
  });

  next();
}

module.exports = {
  attachLifecycleTracking,
  LIFECYCLE_STAGES
};
