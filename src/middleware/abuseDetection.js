const abuseDetector = require('../utils/abuseDetector');

/**
 * Middleware to track requests for abuse detection
 * Does NOT block traffic - only observes and logs
 */
function abuseDetectionMiddleware(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;

  // Track the request
  abuseDetector.trackRequest(ip);

  // Add flag to response headers if suspicious (for observability)
  if (abuseDetector.isSuspicious(ip)) {
    res.setHeader('X-Abuse-Signal', 'flagged');
  }

  // Track failures on response
  const originalSend = res.send;
  res.send = function(data) {
    // Track 4xx and 5xx as potential abuse signals
    if (res.statusCode >= 400) {
      const reason = res.statusCode >= 500 ? 'server_error' : 'client_error';
      abuseDetector.trackFailure(ip, reason);
    }

    return originalSend.call(this, data);
  };

  next();
}

module.exports = abuseDetectionMiddleware;
