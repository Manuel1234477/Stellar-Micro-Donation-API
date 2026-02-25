const fs = require('fs');
const path = require('path');
const log = require('../utils/log');

/**
 * Request/Response Auditing Middleware
 * Intent: Provide full observability into the API lifecycle while strictly 
 * adhering to data privacy by redacting PII and sensitive blockchain keys.
 */
class Logger {
  constructor(options = {}) {
    this.logToFile = options.logToFile || false;
    this.logDir = options.logDir || path.join(__dirname, '../../logs');
    
    // List of fields to be redacted during the sanitization process
    this.sensitiveFields = options.sensitiveFields || [
      'password', 'secretKey', 'secret', 'token', 'authorization',
      'apiKey', 'api_key', 'api-key', 'privateKey', 'private_key',
      'creditCard', 'credit_card', 'ssn', 'social_security'
    ];

    if (this.logToFile) {
      this.ensureLogDirectory();
    }
  }

  /**
   * Intent: Ensure the physical log storage path exists on the filesystem.
   * Flow: Checks existence -> Creates directory recursively if missing.
   */
  ensureLogDirectory() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * Intent: Prevent sensitive data (like Stellar Private Keys) from leaking into logs.
   * Flow: 
   * 1. Recursively traverses objects and arrays.
   * 2. Matches keys against the 'sensitiveFields' blacklist (case-insensitive).
   * 3. Replaces matched values with '[REDACTED]'.
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
   * Intent: Prepare log data for persistent storage.
   * Flow: Converts log object to a pretty-printed JSON string.
   */
  formatLog(logData) {
    return JSON.stringify(logData, null, 2);
  }

  /**
   * Intent: Persist log entries to the disk for long-term auditing.
   * Flow: Calculates date-based filename -> Appends JSON entry to file -> Handles write errors.
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
   * Intent: Provide real-time feedback to developers via the console using structured logging.
   * Flow: 
   * 1. Applies ANSI color codes based on HTTP status (Green/Yellow/Red).
   * 2. Outputs high-level summary including Method, Endpoint, Status, and requestId.
   * 3. If LOG_VERBOSE is active, outputs full sanitized request/response bodies.
   * 4. If Debug Mode is active, logs granular metadata (headers, query, IP).
   */
  logToConsole(logData) {
    const { method, endpoint, statusCode, duration, requestId } = logData;
    
    let statusColor = '\x1b[32m'; // Green for 2xx
    if (statusCode >= 400 && statusCode < 500) {
      statusColor = '\x1b[33m'; // Yellow for 4xx
    } else if (statusCode >= 500) {
      statusColor = '\x1b[31m'; // Red for 5xx
    }
    const resetColor = '\x1b[0m';

    // Log high-level summary
    log.info('REQUEST_LOGGER', `${method} ${endpoint} ${statusColor}${statusCode}${resetColor} - ${duration}ms`, {
      requestId,
      statusCode,
      duration,
      method,
      endpoint,
      timestamp
    });

    if (process.env.LOG_VERBOSE === 'true') {
      log.info('REQUEST_LOGGER', 'Request payload', { 
        requestId,
        ...logData.request 
      });
      log.info('REQUEST_LOGGER', 'Response payload', { 
        requestId,
        ...logData.response 
      });
    }

    if (log.isDebugMode) {
      log.debug('REQUEST_LOGGER', 'Request details', {
        requestId,
        headers: this.sanitize(logData.request?.headers),
        query: logData.request?.query,
        params: logData.request?.params,
        ip: logData.request?.ip
      });
      log.debug('REQUEST_LOGGER', 'Response details', {
        requestId,
        statusCode,
        duration: `${duration}ms`
      });
    }
  }

  /**
   * Main Middleware Function
   * Intent: Intercept the Express request/response cycle to capture performance and payload data.
   * * Flow:
   * 1. Start: Record timestamp and start time.
   * 2. Interception: Overrides 'res.json' to capture the response body before it's sent to the client.
   * 3. Next: Passes control to subsequent middleware/controllers.
   * 4. Completion: Listens for the 'finish' event on the response object.
   * 5. Capture: Aggregates headers, query params, sanitized bodies, and calculates duration.
   * 6. Output: Dispatches the aggregated data to the console and file system.
   */
  middleware() {
    return (req, res, next) => {
      const startTime = Date.now();
      const timestamp = new Date().toISOString();
      const requestId = req.id; 

      const originalJson = res.json.bind(res);
      let responseBody = null;

      res.json = function(body) {
        responseBody = body;
        return originalJson(body);
      };

      res.on('finish', () => {
        const duration = Date.now() - startTime;

        const logData = {
          timestamp,
          requestId, 
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

        this.logToConsole(logData);
        this.writeToFile(logData);
      });

      next();
    };
  }
}

const logger = new Logger({
  logToFile: process.env.LOG_TO_FILE === 'true',
  logDir: process.env.LOG_DIR || path.join(__dirname, '../../logs')
});

module.exports = logger;
module.exports.Logger = Logger;