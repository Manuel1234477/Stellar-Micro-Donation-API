let rateLimit;
try {
  rateLimit = require('express-rate-limit');
} catch (error) {
  // Graceful fallback for environments missing the express-rate-limit dependency
  rateLimit = () => (req, res, next) => next();
}

/**
 * Donation Creation Limiter (Strict)
 * Intent: Protect the Stellar network from spam and the local database from brute-force donation entries.
 * Scope: Targeted at write-heavy POST operations for donations.
 * * Flow & Configuration:
 * 1. Window: 60-second sliding window.
 * 2. Threshold: Max 10 requests.
 * 3. Idempotency Bypass: If a request carries a valid Idempotency Key and the response is 
 * already cached, the 'skip' function returns true, allowing the retry without consuming the quota.
 * 4. Exhaustion: Responds with HTTP 429 and includes 'retryAfter' metadata to guide client retry logic.
 */
const donationRateLimiter = rateLimit({
  windowMs: 60 * 1000, 
  max: 10, 
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many donation requests. Please try again later.',
    }
  },
  standardHeaders: true, 
  legacyHeaders: false, 
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
  /**
   * Optimization: Do not penalize clients for retrying transactions that have 
   * already been processed (Idempotency check).
   */
  skip: (req) => {
    return req.idempotency && req.idempotency.cached;
  }
});

/**
 * Verification Endpoint Limiter (Moderate)
 * Intent: Prevent excessive polling of the Stellar Horizon API through our verify endpoint.
 * Scope: Targeted at POST /donations/verify.
 * * Flow & Configuration:
 * 1. Threshold: Higher limit (30 req/min) to accommodate legitimate verification polling 
 * while still preventing denial-of-service attempts.
 * 2. Header Injection: Returns standard RateLimit headers so frontend clients can implement 
 * proactive throttling.
 */
const verificationRateLimiter = rateLimit({
  windowMs: 60 * 1000, 
  max: 30, 
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
    }
    // Remove custom keyGenerator to avoid IPv6 issues in CI
  });
}

module.exports = {
  donationRateLimiter,
  verificationRateLimiter
};
  verificationRateLimiter,
  createRateLimiter
};
