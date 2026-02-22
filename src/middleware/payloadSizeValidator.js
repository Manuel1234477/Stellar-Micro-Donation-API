/**
 * Payload Size Validation Middleware
 * Enforces request body size limits to prevent abuse and accidental overload
 * 
 * Security Benefits:
 * - Prevents DoS attacks via large payloads
 * - Protects against accidental large uploads
 * - Reduces memory consumption
 * - Improves API stability
 * 
 * Configuration:
 * - Set MAX_PAYLOAD_SIZE environment variable (in bytes)
 * - Default: 1MB (1048576 bytes)
 * - Adjust based on your use case
 * 
 * Example .env values:
 * - 100kb: MAX_PAYLOAD_SIZE=102400
 * - 1MB: MAX_PAYLOAD_SIZE=1048576 (default)
 * - 5MB: MAX_PAYLOAD_SIZE=5242880
 */

const log = require('../utils/log');

// Default payload size limit: 1MB (reasonable for donation API)
const DEFAULT_MAX_SIZE = 1024 * 1024; // 1MB in bytes

// Parse max size from environment or use default
const MAX_PAYLOAD_SIZE = parseInt(process.env.MAX_PAYLOAD_SIZE) || DEFAULT_MAX_SIZE;

/**
 * Convert bytes to human-readable format
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size (e.g., "1.5 MB", "512 KB")
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Middleware to validate request payload size
 * Should be applied before express.json() or express.urlencoded()
 * 
 * @returns {Function} Express middleware function
 * 
 * Usage in app.js:
 *   const { validatePayloadSize } = require('./middleware/payloadSizeValidator');
 *   app.use(validatePayloadSize());
 *   app.use(express.json()); // After size validation
 */
function validatePayloadSize() {
  return (req, res, next) => {
    // Get content-length header (if present)
    const contentLength = parseInt(req.headers['content-length'] || '0');

    // Check if content-length exceeds limit
    if (contentLength > MAX_PAYLOAD_SIZE) {
      log.warn('PAYLOAD_VALIDATOR', 'Request payload too large', {
        contentLength,
        maxSize: MAX_PAYLOAD_SIZE,
        ip: req.ip,
        path: req.path,
        method: req.method
      });

      return res.status(413).json({
        success: false,
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: `Request payload too large. Maximum allowed size is ${formatBytes(MAX_PAYLOAD_SIZE)}`,
          maxSize: MAX_PAYLOAD_SIZE,
          maxSizeFormatted: formatBytes(MAX_PAYLOAD_SIZE),
          receivedSize: contentLength,
          receivedSizeFormatted: formatBytes(contentLength)
        },
        timestamp: new Date().toISOString()
      });
    }

    // Content-length is acceptable or not present
    // Continue to next middleware
    next();
  };
}

/**
 * Create JSON parser with size limit
 * Alternative to validatePayloadSize() middleware
 * Can be used directly with express.json({ limit })
 * 
 * @returns {Object} Express JSON parser configuration
 * 
 * Usage in app.js:
 *   const { getJsonParserWithLimit } = require('./middleware/payloadSizeValidator');
 *   app.use(express.json(getJsonParserWithLimit()));
 */
function getJsonParserWithLimit() {
  return {
    limit: MAX_PAYLOAD_SIZE,
    verify: (req, res, buf, encoding) => {
      // Log when requests approach the limit
      const size = buf.length;
      const threshold = MAX_PAYLOAD_SIZE * 0.8; // 80% of limit
      
      if (size > threshold) {
        log.warn('PAYLOAD_VALIDATOR', 'Large request payload detected', {
          size,
          maxSize: MAX_PAYLOAD_SIZE,
          percentOfMax: ((size / MAX_PAYLOAD_SIZE) * 100).toFixed(1) + '%',
          path: req.path
        });
      }
    }
  };
}

/**
 * Get current payload size limit
 * Useful for API documentation or informational endpoints
 * 
 * @returns {Object} Size limit information
 */
function getPayloadSizeLimit() {
  return {
    maxSize: MAX_PAYLOAD_SIZE,
    maxSizeFormatted: formatBytes(MAX_PAYLOAD_SIZE),
    configSource: process.env.MAX_PAYLOAD_SIZE ? 'environment' : 'default'
  };
}

module.exports = {
  validatePayloadSize,
  getJsonParserWithLimit,
  getPayloadSizeLimit,
  MAX_PAYLOAD_SIZE
};
