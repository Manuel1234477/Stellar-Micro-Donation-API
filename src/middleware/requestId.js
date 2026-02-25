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

/**
 * Middleware to generate and attach a unique ID to every request
<<<<<<< HEAD
 * Intent: Facilitate request tracing and log correlation across the system.
 * Flow: 
 * 1. Check for existing 'X-Request-ID' header (provided by proxy/load balancer).
 * 2. Fallback to generating a new unique UUID.
 * 3. Bind ID to the 'req' object for downstream access.
 * 4. Echo ID back in 'res' headers for client-side tracking.
=======
 * Also sets the requestId in the logging context for structured logging
>>>>>>> upstream/main
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
    ip: req.ip || req.connection?.remoteAddress
  });
  
  next();
};

module.exports = requestIdMiddleware;