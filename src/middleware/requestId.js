/**
 * Request ID Middleware
 * Generates and attaches a unique identifier to every incoming request
 * for distributed tracing and log correlation
 * 
 * Benefits:
 * - Trace requests across multiple services
 * - Correlate logs from different middleware/services
 * - Debug production issues faster
 * - Track request lifecycle
 * 
 * Usage:
 *   const { requestIdMiddleware } = require('./middleware/requestId');
 *   app.use(requestIdMiddleware());
 * 
 * Request ID Format:
 * - UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
 * - Example: "a3bb189e-8bf9-4f4e-9c5a-8c7e4d5b6a7f"
 * - Collision probability: negligible (1 in 2^122)
 */

const crypto = require('crypto');
const log = require('../utils/log');

/**
 * Generate a unique request ID
 * Uses UUID v4 format for standardization
 * 
 * @returns {string} Unique request ID
 */
function generateRequestId() {
  // Generate UUID v4 (random)
  return crypto.randomUUID();
}

/**
 * Extract request ID from headers if provided by client
 * Useful for distributed systems where client generates trace IDs
 * 
 * @param {Object} req - Express request object
 * @returns {string|null} Request ID from header or null
 */
function extractRequestIdFromHeader(req) {
  // Check common request ID header names
  const headerNames = [
    'x-request-id',
    'x-correlation-id',
    'x-trace-id',
    'request-id'
  ];

  for (const headerName of headerNames) {
    const value = req.headers[headerName];
    if (value && typeof value === 'string') {
      return value.trim();
    }
  }

  return null;
}

/**
 * Middleware to attach request ID to every request
 * 
 * Features:
 * - Generates unique ID per request (UUID v4)
 * - Accepts client-provided IDs (x-request-id header)
 * - Attaches ID to req.requestId
 * - Adds X-Request-ID response header
 * - Logs request start with ID
 * 
 * @param {Object} [options] - Configuration options
 * @param {boolean} [options.generateIfMissing=true] - Generate ID if client doesn't provide one
 * @param {boolean} [options.includeInResponse=true] - Add X-Request-ID header to response
 * @param {boolean} [options.logRequestStart=true] - Log when request starts
 * @returns {Function} Express middleware function
 * 
 * @example
 * // Basic usage
 * app.use(requestIdMiddleware());
 * 
 * @example
 * // Custom configuration
 * app.use(requestIdMiddleware({
 *   generateIfMissing: true,
 *   includeInResponse: true,
 *   logRequestStart: false
 * }));
 */
function requestIdMiddleware(options = {}) {
  const {
    generateIfMissing = true,
    includeInResponse = true,
    logRequestStart = true
  } = options;

  return (req, res, next) => {
    // Try to extract request ID from headers (client-provided)
    let requestId = extractRequestIdFromHeader(req);

    // Generate new ID if not provided and generation is enabled
    if (!requestId && generateIfMissing) {
      requestId = generateRequestId();
    }

    // Attach request ID to request object for use in handlers
    req.requestId = requestId;

    // Add request ID to response headers (for client tracing)
    if (includeInResponse && requestId) {
      res.setHeader('X-Request-ID', requestId);
    }

    // Log request start with ID (helps correlate logs)
    if (logRequestStart && requestId) {
      log.info('REQUEST_ID', 'Request started', {
        requestId,
        method: req.method,
        path: req.path,
        ip: req.ip,
        userAgent: req.headers['user-agent']
      });
    }

    next();
  };
}

/**
 * Get request ID from request object
 * Helper function for use in route handlers and middleware
 * 
 * @param {Object} req - Express request object
 * @returns {string|undefined} Request ID if available
 * 
 * @example
 * const requestId = getRequestId(req);
 * log.info('DONATION', 'Processing donation', { requestId });
 */
function getRequestId(req) {
  return req.requestId;
}

/**
 * Enhance log message with request ID
 * Automatically adds requestId to log context if available
 * 
 * @param {Object} req - Express request object
 * @param {Object} context - Existing log context
 * @returns {Object} Enhanced context with requestId
 * 
 * @example
 * log.info('DONATION', 'Created donation', enhanceLogWithRequestId(req, { donationId: 123 }));
 * // Output: { donationId: 123, requestId: "a3bb189e-..." }
 */
function enhanceLogWithRequestId(req, context = {}) {
  const requestId = getRequestId(req);
  if (requestId) {
    return { ...context, requestId };
  }
  return context;
}

module.exports = {
  requestIdMiddleware,
  generateRequestId,
  getRequestId,
  enhanceLogWithRequestId,
  extractRequestIdFromHeader
};
