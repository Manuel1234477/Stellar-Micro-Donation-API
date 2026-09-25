/**
 * Request Lifecycle Timeline Middleware & Hooks System
 * 
 * RESPONSIBILITY: Track request lifecycle, execute extensibility hooks, and log latency
 * OWNER: Backend Team
 * DEPENDENCIES: Logger utility, Correlation utility
 * 
 * Provides hook slots for cross-cutting concerns:
 * - onRequestStart: Executed when request enters the lifecycle middleware
 * - onRequestEnd: Executed when response finishes
 * - onRequestError: Executed on lifecycle errors
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
 * Hook slots arrays for extensibility
 */
const onRequestStart = [];
const onRequestEnd = [];
const onRequestError = [];

/**
 * Helper to execute an array of hooks sequentially, preserving order for sync & async functions
 */
function executeHooks(hooks, ...args) {
  for (let i = 0; i < hooks.length; i++) {
    const hook = hooks[i];
    try {
      const res = hook(...args);
      if (res && typeof res.then === 'function') {
        return (async () => {
          await res;
          for (let j = i + 1; j < hooks.length; j++) {
            await hooks[j](...args);
          }
        })();
      }
    } catch (err) {
      return Promise.reject(err);
    }
  }
  return Promise.resolve();
}

/**
 * Dispatch error to onRequestError hooks
 */
async function handleLifecycleError(err, req, res) {
  for (const hook of onRequestError) {
    try {
      const result = hook(err, req, res);
      if (result && typeof result.then === 'function') {
        await result;
      }
    } catch (nestedErr) {
      log.error('REQUEST_LIFECYCLE', 'Error in onRequestError hook', {
        error: nestedErr && nestedErr.message ? nestedErr.message : String(nestedErr)
      });
    }
  }
}

/**
 * Built-in Hook: Timing Initialization
 */
function timingStartHook(req) {
  req.lifecycle = req.lifecycle || {
    [LIFECYCLE_STAGES.RECEIVED]: Date.now(),
    stages: {}
  };
  if (!req.lifecycle[LIFECYCLE_STAGES.RECEIVED]) {
    req.lifecycle[LIFECYCLE_STAGES.RECEIVED] = Date.now();
  }
  if (!req.lifecycle.stages) {
    req.lifecycle.stages = {};
  }
  req.markLifecycleStage = (stage) => {
    if (req.lifecycle && req.lifecycle.stages) {
      req.lifecycle.stages[stage] = Date.now();
    }
  };
}

/**
 * Built-in Hook: Correlation ID propagation
 */
function correlationHook(req) {
  if (!req.id) {
    try {
      const { getCorrelationContext } = require('../utils/correlation');
      const ctx = getCorrelationContext();
      if (ctx && ctx.correlationId) {
        req.id = ctx.correlationId;
      }
    } catch (_) {}
  }
}

/**
 * Built-in Hook: Timeline & Latency Logging on Response End
 */
function loggingEndHook(req, res) {
  const respondedAt = Date.now();
  const receivedAt = (req.lifecycle && req.lifecycle[LIFECYCLE_STAGES.RECEIVED]) || respondedAt;
  const validatedAt = (req.lifecycle && req.lifecycle.stages && req.lifecycle.stages[LIFECYCLE_STAGES.VALIDATED]) || receivedAt;
  const processedAt = (req.lifecycle && req.lifecycle.stages && req.lifecycle.stages[LIFECYCLE_STAGES.PROCESSED]) || validatedAt;

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
}

/**
 * Built-in Hook: Error Logging
 */
function errorLoggingHook(err, req) {
  log.error('REQUEST_LIFECYCLE', 'Request lifecycle error', {
    requestId: req ? req.id : undefined,
    method: req ? req.method : undefined,
    path: req ? req.path : undefined,
    error: err && err.message ? err.message : String(err)
  });
}

// Register built-in hooks as default pipeline
onRequestStart.push(timingStartHook);
onRequestStart.push(correlationHook);
onRequestEnd.push(loggingEndHook);
onRequestError.push(errorLoggingHook);

/**
 * Register a hook function into a specified hook slot
 * @param {'onRequestStart'|'onRequestEnd'|'onRequestError'} slot 
 * @param {Function} hookFn 
 */
function registerHook(slot, hookFn) {
  if (typeof hookFn !== 'function') {
    throw new TypeError('Hook must be a function');
  }
  if (slot === 'onRequestStart' || slot === 'start') {
    onRequestStart.push(hookFn);
  } else if (slot === 'onRequestEnd' || slot === 'end') {
    onRequestEnd.push(hookFn);
  } else if (slot === 'onRequestError' || slot === 'error') {
    onRequestError.push(hookFn);
  } else {
    throw new Error(`Unknown lifecycle hook slot: ${slot}`);
  }
}

/**
 * Attach lifecycle tracking and hook execution to request/response
 */
function attachLifecycleTracking(req, res, next) {
  // Baseline initialisation to guarantee req.lifecycle exists immediately
  req.lifecycle = req.lifecycle || {
    [LIFECYCLE_STAGES.RECEIVED]: Date.now(),
    stages: {}
  };
  req.markLifecycleStage = (stage) => {
    if (req.lifecycle && req.lifecycle.stages) {
      req.lifecycle.stages[stage] = Date.now();
    }
  };

  // Run onRequestStart hooks
  try {
    const startResult = executeHooks(onRequestStart, req, res);
    if (startResult && typeof startResult.catch === 'function') {
      startResult.catch(err => handleLifecycleError(err, req, res));
    }
  } catch (err) {
    handleLifecycleError(err, req, res);
  }

  // Capture response finish and close events
  let endCalled = false;
  const handleEnd = () => {
    if (endCalled) return;
    endCalled = true;
    try {
      const endResult = executeHooks(onRequestEnd, req, res);
      if (endResult && typeof endResult.catch === 'function') {
        endResult.catch(err => handleLifecycleError(err, req, res));
      }
    } catch (err) {
      handleLifecycleError(err, req, res);
    }
  };

  res.on('finish', handleEnd);
  res.on('close', () => {
    if (!res.writableEnded) {
      handleEnd();
    }
  });

  // Mark validated stage after middleware chain
  process.nextTick(() => {
    if (req.lifecycle && req.lifecycle.stages && !req.lifecycle.stages[LIFECYCLE_STAGES.VALIDATED] && req.markLifecycleStage) {
      req.markLifecycleStage(LIFECYCLE_STAGES.VALIDATED);
    }
  });

  if (typeof next === 'function') {
    next();
  }
}

/**
 * Express error-handling middleware adapter for lifecycle error hooks
 */
function lifecycleErrorHandler(err, req, res, next) {
  handleLifecycleError(err, req, res);
  if (typeof next === 'function') {
    next(err);
  }
}

module.exports = {
  attachLifecycleTracking,
  lifecycleErrorHandler,
  handleLifecycleError,
  LIFECYCLE_STAGES,
  onRequestStart,
  onRequestEnd,
  onRequestError,
  registerHook,
  builtInHooks: {
    timingStartHook,
    correlationHook,
    loggingEndHook,
    errorLoggingHook,
  }
};
