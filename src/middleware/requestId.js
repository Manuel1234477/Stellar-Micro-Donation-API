let uuidv4;
// Intent: Select the most efficient UUID generator available in the environment.
// Flow: Native Crypto (High perf) -> uuid package -> Math.random fallback.
try {
  const { randomUUID } = require('crypto');
  uuidv4 = () => randomUUID();
} catch (e) {
  try {
    uuidv4 = require('uuid').v4;
  } catch (err) {
    uuidv4 = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

const log = require('../utils/log');
const {
  initializeRequestContext,
  parseCorrelationHeaders,
} = require("../utils/correlation");

/**
 * Request ID Middleware with Correlation ID Support
 * 
 * Generates and attaches a unique ID to every request for tracing and correlation.
 * Enhanced with correlation context management for async operation tracking.
 * 
 * Flow: 
 * 1. Check for existing 'X-Request-ID' header (provided by proxy/load balancer).
 * 2. Parse correlation headers from inbound request
 * 3. Generate UUID v4 if not present (ensures uniqueness).
 * 4. Attach to req object and response headers.
 * 5. Initialize correlation context for async operation tracking
 */

const requestIdMiddleware = (req, res, next) => {
  // Generate or extract request ID
  const requestId = req.get("X-Request-ID") || uuidv4();

  req.id = requestId;
  res.setHeader("X-Request-ID", requestId);

  // Parse correlation headers from inbound request
  const correlationHeaders = parseCorrelationHeaders(req.headers);

  // Initialize correlation context with request information
  const correlationContext = initializeRequestContext(requestId, {
    method: req.method,
    path: req.path,
    userAgent: req.get("User-Agent"),
    ip: req.ip,
    ...correlationHeaders,
  });

  // Store correlation context on request for later use
  req.correlationContext = correlationContext;

  // Add correlation headers to response
  res.setHeader("X-Correlation-ID", correlationContext.correlationId);
  res.setHeader("X-Trace-ID", correlationContext.traceId);

  log.debug("REQUEST_ID", "Request ID and correlation context established", {
    requestId,
    correlationId: correlationContext.correlationId,
    traceId: correlationContext.traceId,
    hasInboundCorrelation: Object.keys(correlationHeaders).length > 0,
  });

  next();
};;

module.exports = requestIdMiddleware;