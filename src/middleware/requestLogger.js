/**
 * Configurable Request Logger Middleware
 * 
 * RESPONSIBILITY: Per-path configurable request/response logging with sampling and sanitization
 * OWNER: Platform Team
 * DEPENDENCIES: logger, config
 * 
 * Provides configurable logging that can:
 * - Skip logging for health check and metrics endpoints
 * - Sample high-volume endpoints to reduce log volume
 * - Log full request/response bodies for debugging specific endpoints
 * - Sanitize sensitive fields from logged data
 */

const log = require('../utils/log');
const config = require('../config');

/**
 * Sensitive field patterns that should never appear in logs
 * @type {string[]}
 */
const DEFAULT_SENSITIVE_FIELDS = [
  'password',
  'secret',
  'secretkey',
  'secret_key',
  'privatekey',
  'private_key',
  'token',
  'authorization',
  'apikey',
  'api_key',
  'api-key',
  'creditcard',
  'credit_card',
  'ssn',
  'social_security',
  'encryptionkey',
  'encryption_key'
];

/**
 * Parse comma-separated path patterns from environment variable
 * @param {string} envVar - Environment variable value
 * @returns {string[]} Array of path patterns
 */
function parsePathPatterns(envVar) {
  if (!envVar || typeof envVar !== 'string') {
    return [];
  }
  return envVar.split(',').map(p => p.trim()).filter(Boolean);
}

/**
 * Check if a path matches any pattern in the list
 * @param {string} path - Request path to check
 * @param {string[]} patterns - Array of path patterns (supports wildcards)
 * @returns {boolean} True if path matches any pattern
 */
function matchesPathPattern(path, patterns) {
  if (!path || !patterns || patterns.length === 0) {
    return false;
  }

  const normalizedPath = path.toLowerCase();

  for (const pattern of patterns) {
    const normalizedPattern = pattern.toLowerCase().trim();

    // Exact match
    if (normalizedPath === normalizedPattern) {
      return true;
    }

    // Wildcard match (e.g., /api/*)
    if (normalizedPattern.endsWith('*')) {
      const prefix = normalizedPattern.slice(0, -1);
      if (normalizedPath.startsWith(prefix)) {
        return true;
      }
    }

    // Contains match for flexible patterns
    if (normalizedPattern.startsWith('*') && normalizedPattern.endsWith('*')) {
      const substring = normalizedPattern.slice(1, -1);
      if (normalizedPath.includes(substring)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Sanitize object by redacting sensitive fields
 * @param {Object} obj - Object to sanitize
 * @param {string[]} sensitiveFields - List of sensitive field names
 * @returns {Object} Sanitized object
 */
function sanitizeObject(obj, sensitiveFields = DEFAULT_SENSITIVE_FIELDS) {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item, sensitiveFields));
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();

    const isSensitive = sensitiveFields.some(field =>
      lowerKey.includes(field.toLowerCase())
    );

    if (isSensitive) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeObject(value, sensitiveFields);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Determine if request should be sampled based on configuration
 * @param {string} path - Request path
 * @param {Object} samplingConfig - Sampling configuration
 * @returns {boolean} True if request should be logged
 */
function shouldSample(path, samplingConfig) {
  if (!samplingConfig || samplingConfig.rate === undefined || samplingConfig.rate === null) {
    return true;
  }

  const rate = parseFloat(samplingConfig.rate);
  if (isNaN(rate) || rate >= 1.0) {
    return true;
  }

  if (rate <= 0) {
    return false;
  }

  // Use path-based consistent hashing for deterministic sampling
  const hash = path.split('').reduce((acc, char) => {
    return ((acc << 5) - acc) + char.charCodeAt(0);
  }, 0);

  const normalized = Math.abs(hash % 100) / 100;
  return normalized < rate;
}

/**
 * Configurable Request Logger class
 */
class ConfigurableRequestLogger {
  /**
   * Create a new ConfigurableRequestLogger instance
   * @param {Object} options - Configuration options
   * @param {string[]} options.skipPaths - Paths to exclude from logging
   * @param {string[]} options.bodyPaths - Paths where request/response bodies should be logged
   * @param {number} options.sampleRate - Global sampling rate (0.0 - 1.0)
   * @param {Object} options.pathSampling - Per-path sampling configuration
   * @param {string[]} options.sensitiveFields - Custom sensitive field list
   */
  constructor(options = {}) {
    // Parse skip paths from options or environment
    this.skipPaths = options.skipPaths || parsePathPatterns(process.env.LOG_SKIP_PATHS);

    // Parse body logging paths from options or environment
    this.bodyPaths = options.bodyPaths || parsePathPatterns(process.env.LOG_BODY_PATHS);

    // Global sample rate from options or environment
    this.sampleRate = options.sampleRate !== undefined
      ? options.sampleRate
      : (process.env.LOG_SAMPLE_RATE ? parseFloat(process.env.LOG_SAMPLE_RATE) : 1.0);

    // Per-path sampling configuration
    this.pathSampling = options.pathSampling || {};

    // Sensitive fields to redact
    this.sensitiveFields = options.sensitiveFields || DEFAULT_SENSITIVE_FIELDS;

    // Whether to log request/response bodies
    this.logBodies = options.logBodies !== undefined
      ? options.logBodies
      : (process.env.LOG_BODY === 'true');

    // Whether to log to file
    this.logToFile = options.logToFile !== undefined
      ? options.logToFile
      : config.logging?.toFile || false;

    // Whether to log headers
    this.logHeaders = options.logHeaders !== undefined
      ? options.logHeaders
      : (process.env.LOG_HEADERS === 'true');
  }

  /**
   * Check if path should be skipped from logging
   * @param {string} path - Request path
   * @returns {boolean} True if path should be skipped
   */
  shouldSkipPath(path) {
    return matchesPathPattern(path, this.skipPaths);
  }

  /**
   * Check if path should have bodies logged
   * @param {string} path - Request path
   * @returns {boolean} True if bodies should be logged
   */
  shouldLogBody(path) {
    if (this.logBodies) {
      return true;
    }
    return matchesPathPattern(path, this.bodyPaths);
  }

  /**
   * Get sampling rate for a specific path
   * @param {string} path - Request path
   * @returns {number} Sampling rate for the path
   */
  getSamplingRate(path) {
    // Check for path-specific sampling
    for (const [pattern, rate] of Object.entries(this.pathSampling)) {
      if (matchesPathPattern(path, [pattern])) {
        return parseFloat(rate);
      }
    }
    // Fall back to global rate
    return this.sampleRate;
  }

  /**
   * Sanitize sensitive data from object
   * @param {Object} data - Data to sanitize
   * @returns {Object} Sanitized data
   */
  sanitize(data) {
    return sanitizeObject(data, this.sensitiveFields);
  }

  /**
   * Create Express middleware function
   * @returns {Function} Express middleware
   */
  middleware() {
    return (req, res, next) => {
      const path = req.originalUrl || req.url;

      // Skip logging for excluded paths
      if (this.shouldSkipPath(path)) {
        return next();
      }

      // Check sampling for this path
      const samplingRate = this.getSamplingRate(path);
      if (!shouldSample(path, { rate: samplingRate })) {
        return next();
      }

      const startTime = Date.now();
      const timestamp = new Date().toISOString();
      const requestId = req.id;

      // Capture response body if configured
      const originalJson = res.json.bind(res);
      let responseBody = null;

      res.json = function(body) {
        responseBody = body;
        return originalJson(body);
      };

      res.on('finish', () => {
        const duration = Date.now() - startTime;

        // Build log data
        const logData = {
          timestamp,
          requestId,
          method: req.method,
          endpoint: path,
          statusCode: res.statusCode,
          duration,
          samplingRate
        };

        // Add request details if body logging is enabled for this path
        if (this.shouldLogBody(path)) {
          logData.request = this.sanitize({
            headers: this.logHeaders ? req.headers : undefined,
            query: req.query,
            body: req.body,
            params: req.params,
            ip: req.ip || (req.connection && req.connection.remoteAddress) || 'unknown'
          });

          logData.response = this.sanitize({
            statusCode: res.statusCode,
            body: responseBody
          });
        } else {
          // Log minimal info without bodies
          logData.request = {
            ip: req.ip || (req.connection && req.connection.remoteAddress) || 'unknown'
          };
        }

        // Log to console
        this.logToConsole(logData);

        // Log to file if enabled
        if (this.logToFile) {
          this.writeToFile(logData);
        }
      });

      next();
    };
  }

  /**
   * Log to console with color coding
   * @param {Object} logData - Log data to output
   */
  logToConsole(logData) {
    const { method, endpoint, statusCode, duration, requestId, timestamp, samplingRate } = logData;

    let statusColor = '\x1b[32m'; // Green for 2xx
    if (statusCode >= 400 && statusCode < 500) {
      statusColor = '\x1b[33m'; // Yellow for 4xx
    } else if (statusCode >= 500) {
      statusColor = '\x1b[31m'; // Red for 5xx
    }
    const resetColor = '\x1b[0m';

    const sampleInfo = samplingRate < 1.0 ? ` [sampled: ${(samplingRate * 100).toFixed(0)}%]` : '';

    log.info('REQUEST_LOGGER', `${method} ${endpoint} ${statusColor}${statusCode}${resetColor} - ${duration}ms${sampleInfo}`, {
      requestId,
      statusCode,
      duration,
      method,
      endpoint,
      timestamp,
      samplingRate
    });

    // Log request/response bodies if present
    if (logData.request && (logData.request.body || logData.request.query)) {
      log.info('REQUEST_LOGGER', 'Request payload', {
        requestId,
        ...logData.request
      });
    }

    if (logData.response && logData.response.body) {
      log.info('REQUEST_LOGGER', 'Response payload', {
        requestId,
        ...logData.response
      });
    }
  }

  /**
   * Write log entry to file
   * @param {Object} logData - Log data to write
   */
  writeToFile(logData) {
    if (!this.logToFile) return;

    const fs = require('fs');
    const path = require('path');

    const logDir = config.logging?.directory || path.join(__dirname, '../../logs');

    // Ensure log directory exists
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const date = new Date().toISOString().split('T')[0];
    const logFile = path.join(logDir, `api-${date}.log`);
    const logEntry = JSON.stringify(logData, null, 2) + '\n';

    fs.appendFile(logFile, logEntry, (err) => {
      if (err) {
        log.error('REQUEST_LOGGER', 'Failed to write to log file', { error: err.message });
      }
    });
  }
}

// Create default instance with environment configuration
const defaultLogger = new ConfigurableRequestLogger();

module.exports = defaultLogger;
module.exports.ConfigurableRequestLogger = ConfigurableRequestLogger;
module.exports.parsePathPatterns = parsePathPatterns;
module.exports.matchesPathPattern = matchesPathPattern;
module.exports.sanitizeObject = sanitizeObject;
module.exports.shouldSample = shouldSample;
