let uuidv4;
try {
  // prefer native crypto.randomUUID when available (Node 16+)
  const { randomUUID } = require('crypto');
  uuidv4 = () => randomUUID();
} catch (e) {
  try {
    uuidv4 = require('uuid').v4;
  } catch (err) {
    // last resort: simple pseudo-random fallback
    uuidv4 = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

/**
 * Middleware to generate and attach a unique ID to every request
 */
const requestIdMiddleware = (req, res, next) => {
  // Generate ID
  const requestId = req.get('X-Request-ID') || uuidv4();
  
  // Attach to request object
  req.id = requestId;
  
  // Set header in response
  res.setHeader('X-Request-ID', requestId);
  
  next();
};

module.exports = requestIdMiddleware;