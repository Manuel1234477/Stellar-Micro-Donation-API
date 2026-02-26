/**
 * Payload Size Limit Middleware
 * Intent: Prevent abuse or accidental overload by limiting incoming request payload sizes.
 * Flow:
 * 1. Check Content-Length header before parsing body
 * 2. Reject oversized payloads with meaningful error
 * 3. Allow normal requests to proceed unaffected
 */

const { AppError } = require('../utils/errors');
const log = require('../utils/log');

/**
 * Default size limits (in bytes)
 * Can be overridden via configuration
 */
const DEFAULT_LIMITS = {
  json: 100 * 1024,        // 100KB for JSON payloads
  urlencoded: 100 * 1024,  // 100KB for URL-encoded data
  raw: 1 * 1024 * 1024,    // 1MB for raw data
  text: 100 * 1024         // 100KB for text data
};

/**
 * Convert bytes to human-readable format
 * @param {number} bytes - Size in bytes
 * @returns {string} - Human-readable size
 */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Create payload size limit middleware
 * @param {Object} options - Configuration options
 * @param {number} options.json - Max size for JSON payloads (bytes)
 * @param {number} options.urlencoded - Max size for URL-encoded payloads (bytes)
 * @param {number} options.raw - Max size for raw payloads (bytes)
 * @param {number} options.text - Max size for text payloads (bytes)
 * @returns {Function} - Express middleware function
 */
function createPayloadSizeLimiter(options = {}) {
  const limits = {
    ...DEFAULT_LIMITS,
    ...options
  };

  return (req, res, next) => {
    const contentLength = parseInt(req.get('Content-Length') || '0', 10);
    const contentType = req.get('Content-Type') || '';

    // Determine appropriate limit based on content type
    let maxSize = limits.json; // Default to JSON limit
    let payloadType = 'JSON';

    if (contentType.includes('application/x-www-form-urlencoded')) {
      maxSize = limits.urlencoded;
      payloadType = 'URL-encoded';
    } else if (contentType.includes('text/')) {
      maxSize = limits.text;
      payloadType = 'text';
    } else if (contentType.includes('application/octet-stream')) {
      maxSize = limits.raw;
      payloadType = 'raw';
    }

    // Check if payload exceeds limit
    if (contentLength > maxSize) {
      log.warn('PAYLOAD_SIZE_LIMIT', 'Oversized payload rejected', {
        requestId: req.id,
        contentLength,
        maxSize,
        payloadType,
        contentType,
        path: req.path,
        method: req.method,
        ip: req.ip
      });

      return res.status(413).json({
        success: false,
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: `Request payload too large. Maximum allowed size is ${formatBytes(maxSize)}`,
          details: {
            receivedSize: formatBytes(contentLength),
            maxSize: formatBytes(maxSize),
            payloadType
          },
          requestId: req.id,
          timestamp: new Date().toISOString()
        }
      });
    }

    // Log large but acceptable payloads for monitoring
    if (contentLength > maxSize * 0.8) {
      log.info('PAYLOAD_SIZE_LIMIT', 'Large payload detected (within limits)', {
        requestId: req.id,
        contentLength: formatBytes(contentLength),
        maxSize: formatBytes(maxSize),
        utilizationPercent: ((contentLength / maxSize) * 100).toFixed(2),
        path: req.path
      });
    }

    next();
  };
}

/**
 * Export configured middleware with default limits
 */
module.exports = {
  createPayloadSizeLimiter,
  payloadSizeLimiter: createPayloadSizeLimiter(),
  DEFAULT_LIMITS,
  formatBytes
};
