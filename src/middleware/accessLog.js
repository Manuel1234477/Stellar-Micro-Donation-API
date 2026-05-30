/**
 * Access Log Middleware (#721)
 *
 * Produces exactly one structured JSON access log entry per request on completion.
 * Log level is determined by HTTP status code:
 *   - 5xx → ERROR
 *   - 4xx → WARN
 *   - 2xx/3xx → INFO
 *
 * Log format:
 * {
 *   "level": "INFO",
 *   "service": "stellar-micro-donation-api",
 *   "type": "access",
 *   "requestId": "abc-123",
 *   "method": "POST",
 *   "path": "/donations",
 *   "statusCode": 201,
 *   "responseTimeMs": 245,
 *   "userId": "apikey-5",
 *   "ip": "1.2.3.4",
 *   "userAgent": "curl/8.5.0"
 * }
 *
 * Health check endpoints (/health, /health/live, /health/ready) are excluded by default.
 * Set ACCESS_LOG_INCLUDE_HEALTH=true to include them.
 */

const log = require('../utils/log');

const EXCLUDED_PATHS = ['/health', '/health/live', '/health/ready'];

/**
 * @param {Object} [options]
 * @param {string[]} [options.excludePaths] - Additional paths to exclude from access logs
 * @returns {import('express').RequestHandler}
 */
function accessLogMiddleware(options = {}) {
  const excludePaths = [
    ...(process.env.ACCESS_LOG_INCLUDE_HEALTH === 'true' ? [] : EXCLUDED_PATHS),
    ...(options.excludePaths || []),
  ];

  return (req, res, next) => {
    const startTime = Date.now();

    res.on('finish', () => {
      const path = req.path || req.url;

      if (excludePaths.some(p => path === p || path.startsWith(p + '/'))) {
        return;
      }

      const responseTimeMs = Date.now() - startTime;
      const statusCode = res.statusCode;

      const entry = {
        service: 'stellar-micro-donation-api',
        type: 'access',
        requestId: req.id,
        method: req.method,
        path: req.originalUrl || req.url,
        statusCode,
        responseTimeMs,
        userId: req.apiKeyId || req.userId || null,
        ip: req.ip || (req.connection && req.connection.remoteAddress) || 'unknown',
        userAgent: req.get('User-Agent') || null,
      };

      if (statusCode >= 500) {
        log.error('ACCESS', `${req.method} ${entry.path} ${statusCode} ${responseTimeMs}ms`, entry);
      } else if (statusCode >= 400) {
        log.warn('ACCESS', `${req.method} ${entry.path} ${statusCode} ${responseTimeMs}ms`, entry);
      } else {
        log.info('ACCESS', `${req.method} ${entry.path} ${statusCode} ${responseTimeMs}ms`, entry);
      }
    });

    next();
  };
}

module.exports = accessLogMiddleware;
