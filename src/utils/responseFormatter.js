/**
 * Response Formatter - Standard Envelope Utility
 *
 * RESPONSIBILITY: Build consistent { success, data|error, meta } response envelopes
 * OWNER: Backend Team
 * DEPENDENCIES: None
 *
 * All API responses should use these helpers so clients always receive:
 *   Success: { success: true,  data:  <payload>, meta: { requestId, timestamp, duration } }
 *   Failure: { success: false, error: <details>,  meta: { requestId, timestamp, duration } }
 */

/**
 * Build the meta block common to every response.
 * @param {string} requestId  - Unique request identifier (from req.id)
 * @param {number} startTime  - Unix ms timestamp when the request started (from req._startTime)
 * @returns {{ requestId: string, timestamp: string, duration: number }}
 */
function buildMeta(requestId, startTime) {
  return {
    requestId: requestId || null,
    timestamp: new Date().toISOString(),
    duration: startTime ? Date.now() - startTime : 0,
  };
}

/**
 * Create a success response envelope.
 * @param {*}      data       - Response payload
 * @param {string} requestId  - Unique request identifier
 * @param {number} [startTime] - Request start time in ms (for duration calculation)
 * @returns {{ success: true, data: *, meta: Object }}
 */
function successResponse(data, requestId, startTime) {
  return {
    success: true,
    data,
    meta: buildMeta(requestId, startTime),
  };
}

/**
 * Create an error response envelope.
 * @param {string} code       - Machine-readable error code
 * @param {string} message    - Human-readable error message
 * @param {string} requestId  - Unique request identifier
 * @param {number} [startTime] - Request start time in ms (for duration calculation)
 * @param {*}      [details]  - Optional additional error details
 * @returns {{ success: false, error: Object, meta: Object }}
 */
function errorResponse(code, message, requestId, startTime, details) {
  return {
    success: false,
    error: {
      code,
      message,
      ...(details !== undefined && { details }),
    },
    meta: buildMeta(requestId, startTime),
  };
}

/**
 * Express middleware that:
 *  1. Stamps req._startTime for duration tracking
 *  2. Attaches res.success(data, status?) and res.failure(code, message, status?, details?) helpers
 *
 * @returns {Function} Express middleware
 */
function responseFormatterMiddleware() {
  return (req, res, next) => {
    req._startTime = Date.now();

    /**
     * Send a standardised success response.
     * @param {*}      data       - Payload to include in data field
     * @param {number} [status=200] - HTTP status code
     */
    res.success = (data, status = 200) => {
      res.status(status).json(successResponse(data, req.id, req._startTime));
    };

    /**
     * Send a standardised error response.
     * @param {string} code         - Machine-readable error code
     * @param {string} message      - Human-readable message
     * @param {number} [status=400] - HTTP status code
     * @param {*}      [details]    - Optional extra details
     */
    res.failure = (code, message, status = 400, details) => {
      res.status(status).json(errorResponse(code, message, req.id, req._startTime, details));
    };

    next();
  };
}

module.exports = {
  successResponse,
  errorResponse,
  buildMeta,
  responseFormatterMiddleware,
};
