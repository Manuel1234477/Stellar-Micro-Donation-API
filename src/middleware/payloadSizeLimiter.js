/**
 * Configurable Payload Size Limiter Middleware
 *
 * Provides per-endpoint request body size validation.
 * Validates Content-Length before body parsing to prevent abuse.
 *
 * @module payloadSizeLimiter
 */

const log = require('../utils/log');

/**
 * Default size limits in bytes, used when no override is provided.
 */
const ENDPOINT_LIMITS = {
  default: 100 * 1024,          // 100 KB general fallback
  singleDonation: 10 * 1024,    // 10 KB for POST /donations
  batchDonation: 512 * 1024,    // 512 KB for POST /donations/batch
  wallet: 20 * 1024,            // 20 KB for POST /wallets
  stream: 10 * 1024,            // 10 KB for POST /stream/create
  transaction: 50 * 1024,       // 50 KB for POST /transactions/sync
  stats: 10 * 1024,             // 10 KB for stats endpoints
};

/**
 * Convert bytes to a human-readable string.
 *
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Create a payload size limiter middleware for a specific endpoint.
 *
 * Validates the Content-Length header before the body is parsed.
 * Returns 413 with a descriptive error when the limit is exceeded.
 * Logs oversized attempts with the client IP and endpoint path.
 *
 * @param {number} [maxBytes] - Maximum allowed body size in bytes.
 *   Defaults to ENDPOINT_LIMITS.default when omitted.
 * @returns {import('express').RequestHandler}
 */
function payloadSizeLimiter(maxBytes = ENDPOINT_LIMITS.default) {
  return (req, res, next) => {
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);

    if (contentLength > maxBytes) {
      log.warn('PAYLOAD_SIZE_LIMITER', 'Oversized request rejected', {
        requestId: req.id,
        ip: req.ip,
        method: req.method,
        path: req.path,
        contentLength,
        maxBytes,
      });

      return res.status(413).json({
        success: false,
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: `Request body too large. Maximum allowed size for this endpoint is ${formatBytes(maxBytes)}.`,
          details: {
            received_size: formatBytes(contentLength),
            max_size: formatBytes(maxBytes),
            max_size_bytes: maxBytes,
          },
          requestId: req.id,
          timestamp: new Date().toISOString(),
        },
      });
    }

    next();
  };
}

module.exports = { payloadSizeLimiter, ENDPOINT_LIMITS, formatBytes };
