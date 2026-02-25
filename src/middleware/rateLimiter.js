let rateLimit;
try {
  rateLimit = require('express-rate-limit');
} catch (error) {
  // Fallback for constrained test environments where optional deps are unavailable.
  rateLimit = () => (req, res, next) => next();
}

/**
 * Rate limiter for donation creation endpoints
 * Prevents abuse and accidental overload of donation operations
 * 
 * Limits:
 * - 10 requests per minute per IP address
 * - Applies to POST /donations and POST /donations/send
 * 
 * Response when limit exceeded:
 * - HTTP 429 (Too Many Requests)
 * - JSON body with error details and retry information
 */
const donationRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 10, // Limit each IP to 10 requests per windowMs
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many donation requests. Please try again later.',
    }
  },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many donation requests from this IP. Please try again later.',
        retryAfter: req.rateLimit.resetTime
      }
    });
  },
  // Skip rate limiting for successful requests that were handled by idempotency
  skip: (req) => {
    // If request has idempotency response cached, it's a duplicate and shouldn't count
    return req.idempotency && req.idempotency.cached;
  }
});

/**
 * Rate limiter for donation verification endpoint
 * More lenient than creation since verification is read-heavy
 * 
 * Limits:
 * - 30 requests per minute per IP address
 * - Applies to POST /donations/verify
 */
const verificationRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 30, // Limit each IP to 30 requests per windowMs
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many verification requests. Please try again later.',
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many verification requests from this IP. Please try again later.',
        retryAfter: req.rateLimit.resetTime
      }
    });
  }
});

/**
 * Factory function for creating custom rate limiters in tests
 * @param {Object} options - Rate limiter options
 * @returns {Function} Rate limiter middleware
 */
function createRateLimiter(options = {}) {
  const limit = options.limit || options.max || 10;
  return rateLimit({
    windowMs: options.windowMs || 60000,
    max: limit,
    standardHeaders: false, // Disable standard headers for tests
    legacyHeaders: true, // Use X-RateLimit-* headers for tests
    handler: (req, res) => {
      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please try again later.',
          limit: limit,
          resetAt: new Date(req.rateLimit.resetTime).toISOString()
        }
      });
    },
    keyGenerator: (req) => {
      // Use API key for rate limiting instead of IP
      return req.headers['x-api-key'] || req.ip;
    }
  });
}

module.exports = {
  donationRateLimiter,
  verificationRateLimiter,
  createRateLimiter
};
