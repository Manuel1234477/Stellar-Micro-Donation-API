const AbuseDetectionService = require('../services/AbuseDetectionService');
const log = require('../utils/log');
const AuditLogService = require('../services/AuditLogService');

/**
 * Single middleware entry point for abuse detection.
 *
 * Delegates all tracking and evaluation to the unified
 * AbuseDetectionService, which owns the pluggable detectors
 * (rate, pattern, velocity, anomaly) and the shared state store.
 *
 * Does NOT block traffic - only observes and logs.
 */
function abuseDetectionMiddleware(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;

  // Track the request through the unified service
  Promise.resolve(AbuseDetectionService.trackRequest(ip)).catch(err => {
    log.error('ABUSE_DETECTION', 'Track request failed', { error: err && err.message });
  });

  // Evaluate the request against all detectors and flag if suspicious
  Promise.resolve(AbuseDetectionService.isSuspicious(ip))
    .then(suspicious => {
      if (!suspicious) {
        return;
      }

      // Add flag to response headers if suspicious (for observability)
      if (!res.headersSent) {
        res.setHeader('X-Abuse-Signal', 'flagged');
      }

      // Audit log: IP flagged as suspicious
      return AuditLogService.log({
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
      });
    })
    .catch(err => {
      // Don't block request if detection or audit logging fails
      log.error('ABUSE_DETECTION', 'Abuse detection failed', { error: err && err.message });
    });

  // Track failures on response
  const originalSend = res.send;
  res.send = function(data) {
    // Track 4xx and 5xx as potential abuse signals
    if (res.statusCode >= 400) {
      const reason = res.statusCode >= 500 ? 'server_error' : 'client_error';
      Promise.resolve(AbuseDetectionService.trackFailure(ip, reason)).catch(err => {
        log.error('ABUSE_DETECTION', 'Track failure failed', { error: err && err.message });
      });
    }

    return originalSend.call(this, data);
  };

  next();
}

module.exports = abuseDetectionMiddleware;
