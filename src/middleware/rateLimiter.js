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

const log = require('../utils/log');
const { calculateRetryAfter } = require('./rateLimitHeaders');
const { ExpressRateLimitStore } = require('../services/rateLimitStores');

let expressRateLimit;
let MemoryStore;
try {
  expressRateLimit = require('express-rate-limit');
  // Use the in-memory store explicitly so hot read paths (e.g. list-donations)
  // never perform a per-request DB/Redis round-trip for quota lookups.
  MemoryStore = require('express-rate-limit').MemoryStore;
} catch (error) {
  // Graceful fallback for environments missing the express-rate-limit dependency
  expressRateLimit = null;
  MemoryStore = undefined;
}

/**
 * Cheap, synchronous key generator shared by hot read paths.
 * Avoids any DB lookup: relies solely on data already attached to the request
 * by upstream auth middleware (req.apiKey) or the socket (req.ip).
 * @param {Object} req - Express request
 * @returns {string} Rate limit key
 */
function cheapKeyGenerator(req) {
  return req.apiKey?.id || req.ip;
}

/**
 * Build an express-rate-limit limiter that counts through the shared rate
 * limit store (services/rateLimitStores, #1777) instead of express-rate-limit's
 * per-process default. Each limiter gets its own adapter and key prefix.
 *
 * @param {Object} options - express-rate-limit options plus `storePrefix`
 * @returns {Function} Express middleware
 */
function rateLimit(options = {}) {
  if (!expressRateLimit) return (req, res, next) => next();
  const { storePrefix, ...limiterOptions } = options;
  return expressRateLimit({
    ...limiterOptions,
    store: limiterOptions.store || new ExpressRateLimitStore({ prefix: storePrefix }),
  });
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
  storePrefix: 'donation',
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => {
    if (req.apiKey && req.apiKey.id && !req.apiKey.isLegacy) {
      return `key:${req.apiKey.id}`;
    }
    return `ip:${req.ip}`;
  },
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many donation requests. Please try again later.',
    }
  },
  standardHeaders: true,
  legacyHeaders: true,
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
      log.error('RATE_LIMITER', 'Audit log failed', { error: err.message || err });
    });

    res.set('Retry-After', calculateRetryAfter(req.rateLimit.resetTime));
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
 *
 * Flow & Configuration:
 * 1. Key: API key identity when available, falling back to IP (fixes shared-IP / NAT fairness).
 * 2. Threshold: Higher limit (30 req/min) to accommodate legitimate verification polling
 *    while still preventing denial-of-service attempts.
 * 3. Header Injection: Returns standard RateLimit headers plus X-RateLimit-Identifier
 *    so clients know whether the limit is per-key or per-IP.
 */
const verificationRateLimiter = rateLimit({
  storePrefix: 'verification',
  windowMs: 60 * 1000,
  max: 30,
  // Use API key ID when present; fall back to IP for unauthenticated requests
  keyGenerator: (req) => {
    if (req.apiKey && req.apiKey.id && !req.apiKey.isLegacy) {
      return `key:${req.apiKey.id}`;
    }
    return `ip:${req.ip}`;
  },
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many verification requests. Please try again later.',
    }
  },
  standardHeaders: true,
  legacyHeaders: true,
  validate: false,
  handler: (req, res) => {
    const isKeyBased = req.apiKey && req.apiKey.id && !req.apiKey.isLegacy;

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
        limitedBy: isKeyBased ? 'api-key' : 'ip',
        resetTime: req.rateLimit.resetTime
      }
    }).catch(err => {
      log.error('RATE_LIMITER', 'Audit log failed', { error: err.message || err });
    });

    res.set('X-RateLimit-Identifier', isKeyBased ? 'api-key' : 'ip');
    res.set('Retry-After', calculateRetryAfter(req.rateLimit.resetTime));
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: isKeyBased
          ? 'Too many verification requests for this API key. Please try again later.'
          : 'Too many verification requests from this IP. Please try again later.',
        retryAfter: req.rateLimit.resetTime,
        limitedBy: isKeyBased ? 'api-key' : 'ip',
      }
    });
  },
  // Attach identifier header on every response (not just 429s)
  skip: (req, res) => {
    const isKeyBased = req.apiKey && req.apiKey.id && !req.apiKey.isLegacy;
    res.set('X-RateLimit-Identifier', isKeyBased ? 'api-key' : 'ip');
    return false;
  },
});

/**
 * Batch Donation Limiter
 * Max 10 batch requests per minute per IP.
 */
const batchRateLimiter = rateLimit({
  storePrefix: 'batch',
  windowMs: 60 * 1000,
  max: 1,
  keyGenerator: (req) => req.apiKey?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: true,
  validate: false,
  handler: (req, res) => {
    const identifier = req.apiKey?.id ? `api-key:${req.apiKey.id}` : `ip:${req.ip}`;
    AuditLogService.log({
      category: AuditLogService.CATEGORY.RATE_LIMITING,
      action: AuditLogService.ACTION.RATE_LIMIT_EXCEEDED,
      severity: AuditLogService.SEVERITY.HIGH,
      result: 'FAILURE',
      requestId: req.id,
      ipAddress: req.ip,
      resource: req.path,
      reason: 'Batch donation rate limit exceeded',
      details: { limit: 1, window: '60s', identifier, resetTime: req.rateLimit.resetTime }
    }).catch(err => log.error('RATE_LIMITER', 'Audit log failed', { error: err.message || err }));

    res.set('Retry-After', calculateRetryAfter(req.rateLimit.resetTime));
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many batch donation requests. Please try again later.',
        retryAfter: req.rateLimit.resetTime,
        limitedBy: req.apiKey?.id ? 'api-key' : 'ip'
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
  storePrefix: 'bulkImport',
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.apiKey?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: true,
  validate: false,
  skip: () => process.env.NODE_ENV === 'test',
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
      reason: 'Bulk import rate limit exceeded',
      details: { limit: 5, window: '60s', resetTime: req.rateLimit?.resetTime }
    }).catch(err => log.error('RATE_LIMITER', 'Audit log failed', { error: err.message || err }));

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
 * Donations List Limiter (Hot Read Path)
 * Intent: Protect the most frequent read endpoint (GET /donations) without adding
 * per-request latency. This limiter must stay cheap:
 * 1. Store: in-memory (MemoryStore) - no DB/Redis hit per request.
 * 2. Key: req.apiKey?.id || req.ip - no synchronous DB lookups.
 * 3. Threshold: generous (300 req/min) since this is a read path.
 */
const listDonationsRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.LIST_DONATIONS_RATE_LIMIT || '300'),
  keyGenerator: cheapKeyGenerator,
  standardHeaders: true,
  legacyHeaders: true,
  validate: false,
  ...(MemoryStore ? { store: new MemoryStore() } : {}),
  skip: () => process.env.NODE_ENV === 'test',
  handler: (req, res) => {
    res.set('Retry-After', calculateRetryAfter(req.rateLimit?.resetTime));
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many donation list requests. Please try again later.',
        retryAfter: req.rateLimit?.resetTime,
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
  storePrefix: 'authToken',
  windowMs: 60 * 1000,
  max: parseInt(process.env.AUTH_TOKEN_RATE_LIMIT || '10'),
  keyGenerator: (req) => req.ip,
  standardHeaders: true,
  legacyHeaders: true,
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
    }).catch(err => log.error('RATE_LIMITER', 'Audit log failed', { error: err.message || err }));

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
  storePrefix: 'authRefresh',
  windowMs: 60 * 1000,
  max: parseInt(process.env.AUTH_REFRESH_RATE_LIMIT || '20'),
  keyGenerator: (req) => req.ip,
  standardHeaders: true,
  legacyHeaders: true,
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
    }).catch(err => log.error('RATE_LIMITER', 'Audit log failed', { error: err.message || err }));

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

/**
 * Health Check Limiter (Issue #889)
 * Intent: Prevent reconnaissance attacks via continuous health endpoint polling
 * Scope: GET /health, GET /api/v1/health
 * 
 * Flow & Configuration:
 * 1. Window: 60-second sliding window
 * 2. Threshold: Max 60 requests per IP (1 per second)
 * 3. Headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
 * 4. Exhaustion: Responds with HTTP 429
 */
const healthCheckRateLimiter = rateLimit({
  storePrefix: 'healthCheck',
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req) => req.ip,
  standardHeaders: true,
  legacyHeaders: true,
  validate: false,
  handler: (req, res) => {
    const retryAfter = req.rateLimit?.resetTime
      ? Math.ceil((new Date(req.rateLimit.resetTime) - Date.now()) / 1000)
      : 60;

    res.set('Retry-After', String(retryAfter));
    res.status(429).json({
      status: 'degraded',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Live Wallet History Limiter
 * Intent: Prevent Horizon API abuse via source=live queries.
 * Scope: GET /wallets/:id/history?source=live
 *
 * Flow & Configuration:
 * 1. Window: 60-second sliding window.
 * 2. Threshold: Max 10 requests per authenticated client (keyed by API key ID, fallback to IP).
 * 3. Exhaustion: Responds with HTTP 429.
 */
const liveHistoryRateLimiter = rateLimit({
  storePrefix: 'liveHistory',
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.apiKey?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: true,
  validate: false,
  skip: () => process.env.NODE_ENV === 'test',
  handler: (req, res) => {
    res.set('Retry-After', calculateRetryAfter(req.rateLimit?.resetTime));
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many live history requests. Please try again later.',
        retryAfter: req.rateLimit?.resetTime,
      }
    });
  }
});

module.exports = {
  sharedRateLimit: rateLimit,
  donationRateLimiter,
  listDonationsRateLimiter,
  cheapKeyGenerator,
  verificationRateLimiter,
  batchRateLimiter,
  bulkImportRateLimiter,
  authTokenRateLimiter,
  authRefreshRateLimiter,
  healthCheckRateLimiter,
  liveHistoryRateLimiter,
  createRateLimiter,
  friendbotRateLimiter: rateLimit({
    storePrefix: 'friendbot',
    windowMs: 60 * 1000,
    max: 5,
    keyGenerator: (req) => req.apiKey?.id || req.ip,
    standardHeaders: true,
    legacyHeaders: true,
    validate: false,
    handler: (req, res) => {
      res.set('Retry-After', calculateRetryAfter(req.rateLimit?.resetTime));
      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many Friendbot funding requests. Please try again later.',
          retryAfter: req.rateLimit?.resetTime,
        }
      });
    }
  }),
  statsRateLimiter: rateLimit({
    storePrefix: 'stats',
    windowMs: 60 * 1000,
    max: 30,
    keyGenerator: (req) => {
      const identifier = (req.apiKey && req.apiKey.id && !req.apiKey.isLegacy)
        ? `key:${req.apiKey.id}`
        : `ip:${req.ip}`;
      return `rate_limit:${identifier}:stats`;
    },
    message: {
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many stats requests. Please try again later.',
      }
    },
    standardHeaders: true,
    legacyHeaders: true,
    validate: false,
    handler: (req, res) => {
      const isKeyBased = req.apiKey && req.apiKey.id && !req.apiKey.isLegacy;
      const retryAfter = Math.ceil((new Date(req.rateLimit.resetTime) - Date.now()) / 1000);

      AuditLogService.log({
        category: AuditLogService.CATEGORY.RATE_LIMITING,
        action: AuditLogService.ACTION.RATE_LIMIT_EXCEEDED,
        severity: AuditLogService.SEVERITY.MEDIUM,
        result: 'FAILURE',
        requestId: req.id,
        ipAddress: req.ip,
        resource: req.path,
        reason: 'Stats rate limit exceeded',
        details: {
          limit: 30,
          window: '60s',
          limitedBy: isKeyBased ? 'api-key' : 'ip',
          resetTime: req.rateLimit.resetTime
        }
      }).catch(err => {
        log.error('RATE_LIMITER', 'Audit log failed', { error: err.message || err });
      });

      res.set('X-RateLimit-Identifier', isKeyBased ? 'api-key' : 'ip');
      res.set('Retry-After', String(retryAfter));
      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: isKeyBased
            ? 'Too many stats requests for this API key. Please try again later.'
            : 'Too many stats requests from this IP. Please try again later.',
          retryAfter,
          limitedBy: isKeyBased ? 'api-key' : 'ip',
        }
      });
    },
    skip: (req, res) => {
      const isKeyBased = req.apiKey && req.apiKey.id && !req.apiKey.isLegacy;
      res.set('X-RateLimit-Identifier', isKeyBased ? 'api-key' : 'ip');
      return false;
    },
  }),
};
