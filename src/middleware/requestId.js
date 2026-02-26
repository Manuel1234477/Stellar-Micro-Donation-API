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
 * Middleware to generate and attach a unique ID to every request
 * Intent: Facilitate request tracing and log correlation across the system.
 * Flow:
 * 1. Check for existing 'X-Request-ID' header (provided by proxy/load balancer).
 * 2. Parse correlation headers from inbound request
 * 3. Generate UUID v4 if not present (ensures uniqueness).
 * 4. Attach to req object and response headers.
 * 5. Initialize correlation context for async operation tracking
 */

const requestIdMiddleware = (req, res, next) => {
  const requestId = req.get('X-Request-ID') || uuidv4();

  req.id = requestId;
  res.setHeader('X-Request-ID', requestId);

  // Set logging context with requestId
  log.setContext({
    requestId,
    method: req.method,
    path: req.path,
    userAgent: req.get("User-Agent"),
    ip: req.ip,
    ...correlationHeaders,
  });

  next();
};;

module.exports = requestIdMiddleware;
