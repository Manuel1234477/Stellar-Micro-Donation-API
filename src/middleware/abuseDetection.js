const abuseDetector = require('../utils/abuseDetector');
const AuditLogService = require('../services/AuditLogService');

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

    // Audit log: IP flagged as suspicious
    AuditLogService.log({
      category: AuditLogService.CATEGORY.ABUSE_DETECTION,
      action: AuditLogService.ACTION.IP_FLAGGED,
      severity: AuditLogService.SEVERITY.HIGH,
      result: 'SUCCESS',
      requestId: req.id,
      ipAddress: ip,
      resource: req.path,
      details: {
        method: req.method,
        userAgent: req.get('User-Agent')
      }
    }).catch(err => {
      // Don't block request if audit logging fails
      console.error('Audit log failed:', err);
    });
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
