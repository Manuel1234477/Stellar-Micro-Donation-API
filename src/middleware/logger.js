const fs = require('fs');
const path = require('path');
const log = require('../utils/log');

/**
 * Logger Middleware for Request/Response Logging
 * Logs incoming requests and outgoing responses with sensitive data filtering
 */
class Logger {
  constructor(options = {}) {
    this.logToFile = options.logToFile || false;
    this.logDir = options.logDir || path.join(__dirname, '../../logs');
    this.sensitiveFields = options.sensitiveFields || [
      'password',
      'secretKey',
      'secret',
      'token',
      'authorization',
      'apiKey',
      'api_key',
      'api-key',
      'privateKey',
      'private_key',
      'creditCard',
      'credit_card',
      'ssn',
      'social_security'
    ];

    if (this.logToFile) {
      this.ensureLogDirectory();
    }
  }

  /**
   * Ensure log directory exists
   */
  ensureLogDirectory() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * Sanitize object by removing sensitive fields
   * @param {Object} obj - Object to sanitize
   * @returns {Object} Sanitized object
   */
  sanitize(obj) {
    if (!obj || typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitize(item));
    }

    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      
      // Check if field is sensitive
      const isSensitive = this.sensitiveFields.some(field => 
        lowerKey.includes(field.toLowerCase())
      );

      if (isSensitive) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitize(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Format log entry
   * @param {Object} logData - Log data to format
   * @returns {string} Formatted log string
   */
  formatLog(logData) {
    return JSON.stringify(logData, null, 2);
  }

  /**
   * Write log to file
   * @param {Object} logData - Log data to write
   */
  writeToFile(logData) {
    if (!this.logToFile) return;

    const date = new Date().toISOString().split('T')[0];
    const logFile = path.join(this.logDir, `api-${date}.log`);
    const logEntry = this.formatLog(logData) + '\n';

    fs.appendFile(logFile, logEntry, (err) => {
      if (err) {
        log.error('REQUEST_LOGGER', 'Failed to write to log file', { error: err.message });
      }
    });
  }

  /**
   * Log to console
   * @param {Object} logData - Log data to output
   */
  logToConsole(logData) {
    const { timestamp, method, endpoint, statusCode, duration } = logData;
    
    // Color coding based on status code
    let statusColor = '\x1b[32m'; // Green for 2xx
    if (statusCode >= 400 && statusCode < 500) {
      statusColor = '\x1b[33m'; // Yellow for 4xx
    } else if (statusCode >= 500) {
      statusColor = '\x1b[31m'; // Red for 5xx
    }
    const resetColor = '\x1b[0m';

    log.info('REQUEST_LOGGER', `${method} ${endpoint} ${statusColor}${statusCode}${resetColor} - ${duration}ms`, {
      timestamp,
    });

    // Log request/response details in verbose mode
    if (process.env.LOG_VERBOSE === 'true') {
      log.info('REQUEST_LOGGER', 'Request payload', logData.request);
      log.info('REQUEST_LOGGER', 'Response payload', logData.response);
    }

    // Log additional debug details in debug mode
    if (log.isDebugMode) {
      log.debug('REQUEST_LOGGER', 'Request details', {
        headers: this.sanitize(logData.request?.headers),
        query: logData.request?.query,
        params: logData.request?.params,
        ip: logData.request?.ip
      });
      log.debug('REQUEST_LOGGER', 'Response details', {
        statusCode,
        duration: `${duration}ms`
      });
    }
  }

  /**
   * Express middleware for request/response logging
   */
  middleware() {
    return (req, res, next) => {
      const startTime = Date.now();
      const timestamp = new Date().toISOString();

      // Capture original res.json to intercept response
      const originalJson = res.json.bind(res);
      let responseBody = null;

      res.json = function(body) {
        responseBody = body;
        return originalJson(body);
      };

      // Log after response is sent
      res.on('finish', () => {
        const duration = Date.now() - startTime;

        const logData = {
          timestamp,
          method: req.method,
          endpoint: req.originalUrl || req.url,
          statusCode: res.statusCode,
          duration,
          request: {
            headers: this.sanitize(req.headers),
            query: this.sanitize(req.query),
            body: this.sanitize(req.body),
            params: this.sanitize(req.params),
            ip: req.ip || (req.connection && req.connection.remoteAddress) || 'unknown'
          },
          response: {
            statusCode: res.statusCode,
            body: this.sanitize(responseBody)
          }
        };

        // Log to console
        this.logToConsole(logData);

        // Log to file if enabled
        this.writeToFile(logData);
      });

      next();
    };
  }
}

// Export singleton instance
const logger = new Logger({
  logToFile: process.env.LOG_TO_FILE === 'true',
  logDir: process.env.LOG_DIR || path.join(__dirname, '../../logs')
});

module.exports = logger;
module.exports.Logger = Logger; // Export class for testing
