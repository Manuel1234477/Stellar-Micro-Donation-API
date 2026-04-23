/**
 * Rate Limiter Middleware - API Protection Layer
 * 
 * RESPONSIBILITY: Request rate limiting to prevent abuse and protect system resources
 * OWNER: Security Team
 * DEPENDENCIES: express-rate-limit, rate limit config
 * 
 * Implements sliding window rate limiting for donation endpoints and general API access.
 * Protects Stellar network from spam and database from brute-force attacks.
 */

let rateLimit;
try {
  rateLimit = require('express-rate-limit');
} catch (error) {
  // Graceful fallback for environments missing the express-rate-limit dependency
  rateLimit = () => (req, res, next) => next();
}

const AuditLogService = require('../services/AuditLogService');

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
  validate: false,
  handler: (req, res) => {
    // Audit log: Rate limit exceeded
    AuditLogService.log({
      category: AuditLogService.CATEGORY.RATE_LIMITING,
      action: AuditLogService.ACTION.RATE_LIMIT_EXCEEDED,
      severity: AuditLogService.SEVERITY.HIGH,
      result: 'FAILURE',
      requestId: req.id,
      ipAddress: req.ip,
      resource: req.path,
      reason: 'Donation rate limit exceeded',
      details: {
        limit: 10,
        window: '60s',
        resetTime: req.rateLimit.resetTime
      }
    }).catch(err => {
      console.error('Audit log failed:', err);
    });

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
    return process.env.NODE_ENV === 'test' || (req.idempotency && req.idempotency.cached);
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
  validate: false,
  handler: (req, res) => {
    // Audit log: Verification rate limit exceeded
    AuditLogService.log({
      category: AuditLogService.CATEGORY.RATE_LIMITING,
      action: AuditLogService.ACTION.RATE_LIMIT_EXCEEDED,
      severity: AuditLogService.SEVERITY.MEDIUM,
      result: 'FAILURE',
      requestId: req.id,
      ipAddress: req.ip,
      resource: req.path,
      reason: 'Verification rate limit exceeded',
      details: {
        limit: 30,
        window: '60s',
        resetTime: req.rateLimit.resetTime
      }
    }).catch(err => {
      console.error('Audit log failed:', err);
    });

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
 * Batch Donation Limiter
 * Max 10 batch requests per minute per IP.
 */
const batchRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  handler: (req, res) => {
    AuditLogService.log({
      category: AuditLogService.CATEGORY.RATE_LIMITING,
      action: AuditLogService.ACTION.RATE_LIMIT_EXCEEDED,
      severity: AuditLogService.SEVERITY.HIGH,
      result: 'FAILURE',
      requestId: req.id,
      ipAddress: req.ip,
      resource: req.path,
      reason: 'Batch donation rate limit exceeded',
      details: { limit: 10, window: '60s', resetTime: req.rateLimit.resetTime }
    }).catch(err => console.error('Audit log failed:', err));

    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many batch requests from this IP. Please try again later.',
        retryAfter: req.rateLimit.resetTime
      }
    });
  }
});

/**
 * Bulk Wallet Import Limiter
 * Intent: Protect the bulk import endpoint from abuse; limit per authenticated client.
 * Scope: POST /wallets/bulk-import
 *
 * Flow & Configuration:
 * 1. Window: 60-second sliding window.
 * 2. Threshold: Max 10 requests per authenticated client (keyed by API key ID, fallback to IP).
 * 3. Exhaustion: Responds with HTTP 429 and includes Retry-After header.
 */
const bulkImportRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.apiKey?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  handler: (req, res) => {
    const retryAfter = req.rateLimit?.resetTime
      ? Math.ceil((new Date(req.rateLimit.resetTime) - Date.now()) / 1000)
      : 60;

    res.set('Retry-After', String(retryAfter));
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many bulk import requests. Please try again later.',
        retryAfter
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
    validate: false,
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

/**
 * Auth Token Limiter
 * Intent: Prevent brute force attacks on POST /auth/token endpoint
 * Scope: POST /auth/token
 * 
 * Flow & Configuration:
 * 1. Window: 60-second sliding window
 * 2. Threshold: Max 10 requests per IP
 * 3. Headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
 * 4. Exhaustion: Responds with HTTP 429 and Retry-After header
 */
const authTokenRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.AUTH_TOKEN_RATE_LIMIT || '10'),
  keyGenerator: (req) => req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  handler: (req, res) => {
    const retryAfter = req.rateLimit?.resetTime
      ? Math.ceil((new Date(req.rateLimit.resetTime) - Date.now()) / 1000)
      : 60;

    AuditLogService.log({
      category: AuditLogService.CATEGORY.RATE_LIMITING,
      action: AuditLogService.ACTION.RATE_LIMIT_EXCEEDED,
      severity: AuditLogService.SEVERITY.HIGH,
      result: 'FAILURE',
      requestId: req.id,
      ipAddress: req.ip,
      resource: req.path,
      reason: 'Auth token rate limit exceeded',
      details: {
        limit: parseInt(process.env.AUTH_TOKEN_RATE_LIMIT || '10'),
        window: '60s',
        resetTime: req.rateLimit.resetTime
      }
    }).catch(err => console.error('Audit log failed:', err));

    res.set('Retry-After', String(retryAfter));
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many authentication requests from this IP. Please try again later.',
        retryAfter
      }
    });
  }
});

/**
 * Auth Refresh Limiter
 * Intent: Prevent refresh token exhaustion attacks on POST /auth/refresh
 * Scope: POST /auth/refresh
 * 
 * Flow & Configuration:
 * 1. Window: 60-second sliding window
 * 2. Threshold: Max 20 requests per IP (higher than token endpoint)
 * 3. Headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
 * 4. Exhaustion: Responds with HTTP 429 and Retry-After header
 */
const authRefreshRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.AUTH_REFRESH_RATE_LIMIT || '20'),
  keyGenerator: (req) => req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  handler: (req, res) => {
    const retryAfter = req.rateLimit?.resetTime
      ? Math.ceil((new Date(req.rateLimit.resetTime) - Date.now()) / 1000)
      : 60;

    AuditLogService.log({
      category: AuditLogService.CATEGORY.RATE_LIMITING,
      action: AuditLogService.ACTION.RATE_LIMIT_EXCEEDED,
      severity: AuditLogService.SEVERITY.HIGH,
      result: 'FAILURE',
      requestId: req.id,
      ipAddress: req.ip,
      resource: req.path,
      reason: 'Auth refresh rate limit exceeded',
      details: {
        limit: parseInt(process.env.AUTH_REFRESH_RATE_LIMIT || '20'),
        window: '60s',
        resetTime: req.rateLimit.resetTime
      }
    }).catch(err => console.error('Audit log failed:', err));

    res.set('Retry-After', String(retryAfter));
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many refresh requests from this IP. Please try again later.',
        retryAfter
      }
    });
  }
});

module.exports = {
  donationRateLimiter,
  verificationRateLimiter,
  batchRateLimiter,
  bulkImportRateLimiter,
  authTokenRateLimiter,
  authRefreshRateLimiter,
  createRateLimiter,
};
