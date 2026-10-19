/**
 * API Key Middleware - Authentication Layer
 * 
 * RESPONSIBILITY: API key validation and authentication for all protected endpoints
 * OWNER: Security Team
 * DEPENDENCIES: API Keys model, security config, logger
 * 
 * Validates API keys against both database-backed keys and legacy environment variables.
 * Supports key rotation, expiration, role-based access control, and optional request signing.
 */

const { securityConfig } = require("../config/securityConfig");
const { validateKey} = require("../models/apiKeys");
const { verifyAccessToken } = require("../services/JwtService");
const log = require("../utils/log");
const { isLegacyKeyDisabled, getLegacyKeySunsetDate } = require("../utils/legacyApiKeySunset");
const { allowAuditEvent } = require("../utils/authAuditThrottle");
const { recordAuthFailure, recordLegacyKeyUsage } = require("../utils/metrics");

// Authentication audit rows are written at most once per key per window (issue #1887)
const AUTH_AUDIT_WINDOW_MS = 60 * 1000;
const LEGACY_AUDIT_WINDOW_MS = 60 * 60 * 1000;
const AuditLogService = require("../services/AuditLogService");
const { verify: verifySignature } = require("../utils/requestSigner");
const { isIpAllowed } = require("../utils/ipAllowlist");
const { defaultStore: nonceStore } = require("../utils/nonceStore");
const { safeEqual } = require("../utils/safeEqual");
const crypto = require("crypto");
const WebhookService = require("../services/WebhookService");

/**
 * Legacy Support Configuration
 * Uses security configuration for API keys with safe defaults
 */
const legacyKeys = securityConfig.API_KEYS || [];

/**
 * Short-TTL cache for API key validation results.
 *
 * Listing donations is the most frequent read path, and re-querying the
 * api_keys table on every request was a measurable contributor to the
 * list-donations p95 regression (see issue #1796). Validation results are
 * cached for a short window so repeated requests with the same key avoid the
 * DB round-trip while revocation/rotation still takes effect quickly.
 *
 * The cache stores the keyed hash of the raw key (never the raw key itself)
 * and is bounded in size to avoid unbounded memory growth.
 */
const API_KEY_CACHE_TTL_MS = Number(
  process.env.API_KEY_CACHE_TTL_MS || 30_000,
);
const API_KEY_CACHE_MAX_ENTRIES = Number(
  process.env.API_KEY_CACHE_MAX_ENTRIES || 5_000,
);

const apiKeyCache = new Map();

const hashApiKey = (apiKey) =>
  crypto.createHash("sha256").update(apiKey).digest("hex");

const getCachedKeyInfo = (apiKey) => {
  if (API_KEY_CACHE_TTL_MS <= 0) return undefined;
  const cacheKey = hashApiKey(apiKey);
  const entry = apiKeyCache.get(cacheKey);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    apiKeyCache.delete(cacheKey);
    return undefined;
  }
  return entry.keyInfo;
};

const setCachedKeyInfo = (apiKey, keyInfo) => {
  if (API_KEY_CACHE_TTL_MS <= 0) return;
  const cacheKey = hashApiKey(apiKey);
  if (apiKeyCache.size >= API_KEY_CACHE_MAX_ENTRIES) {
    // Evict the oldest entry (Map preserves insertion order).
    const oldest = apiKeyCache.keys().next().value;
    if (oldest !== undefined) apiKeyCache.delete(oldest);
  }
  apiKeyCache.set(cacheKey, {
    keyInfo,
    expiresAt: Date.now() + API_KEY_CACHE_TTL_MS,
  });
};

const invalidateCachedKeyInfo = (apiKey) => {
  apiKeyCache.delete(hashApiKey(apiKey));
};

/**
 * API Key Authentication Middleware
 * Intent: Secure the API by enforcing mandatory key-based authentication, supporting
 * both modern database-backed rotation and legacy static keys.
 * * Flow:
 * 1. Header Extraction: Scans 'x-api-key' from the incoming request headers.
 * 2. Primary Validation: Queries the database via 'validateApiKey' to check for
 * active, non-revoked, and non-expired keys.
 * 3. Metadata Attachment: If valid, binds key details (id, role, etc.) to 'req.apiKey'.
 * 4. Deprecation Logic: Inspects if the key is marked for rotation; if so,
 * injects 'X-API-Key-Deprecated' and 'Warning' headers into the response.
 * 5. Legacy Fallback: If DB lookup fails, checks the 'legacyKeys' array derived from ENV.
 * 6. Final Disposition: Calls next() on success, or returns 401 Unauthorized if all checks fail.
 */
const requireApiKey = async (req, res, next) => {
  if (req.apiKey) {
    return next();
  }

  // Allow JWT bearer token as an alternate auth method
  const authorization = req.get('Authorization') || req.get('authorization');
  if (authorization && authorization.startsWith('Bearer ')) {
    const token = authorization.slice(7).trim();
    const result = verifyAccessToken(token);
    if (result.valid) {
      req.user = {
        id: `jwt-${result.payload.sub || 'unknown'}`,
        role: result.payload.role || 'user',
        authMethod: 'jwt',
        claims: result.payload,
      };
      return next();
    }

    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired bearer token',
      },
    });
  }

  if (req.user && req.user.authMethod === 'jwt') {
    return next();
  }

  const apiKey = req.get("x-api-key");

  if (!apiKey) {
    recordAuthFailure("missing_key");

    // Audit at most once per IP per minute: unauthenticated traffic must not
    // turn every request into an audit write (see issue #1887).
    if (allowAuditEvent(`missing:${req.ip}`, AUTH_AUDIT_WINDOW_MS)) {
      log.warn("API_KEY", "Missing API key in request", {
        ip: req.ip,
        userAgent: req.get("User-Agent"),
        path: req.path,
      });

      AuditLogService.log({
        category: AuditLogService.CATEGORY.AUTHENTICATION,
        action: AuditLogService.ACTION.API_KEY_VALIDATION_FAILED,
        severity: AuditLogService.SEVERITY.LOW,
        result: 'FAILURE',
        requestId: req.id,
        ipAddress: req.ip,
        resource: req.path,
        reason: 'Missing API key header',
        details: {
          userAgent: req.get("User-Agent"),
          method: req.method
        }
      }).catch(() => {});
    }

    return res.status(401).json({
      success: false,
      error: {
        code: "UNAUTHORIZED",
        message: "API key required",
        requestId: req.id,
        timestamp: new Date().toISOString(),
      },
    });
  }

  try {
    // Stage 1: Attempt Database-backed validation (Supports key rotation & granular roles)
    // Results are memoized per key for a short TTL to avoid re-querying the
    // api_keys table on every request (see issue #1796).
    let keyInfo = getCachedKeyInfo(apiKey);
    if (keyInfo === undefined) {
      keyInfo = await validateKey(apiKey);
      if (keyInfo) {
        setCachedKeyInfo(apiKey, keyInfo);
      }
    }

    if (keyInfo) {
      req.apiKey = keyInfo;

      // --- Quota Check ---
      if (keyInfo.monthlyQuota) {
        const quotaRemaining = keyInfo.monthlyQuota - keyInfo.quotaUsed;
        
        if (quotaRemaining <= 0) {
          log.warn('API_KEY_AUTH', 'Request rejected: quota exceeded', {
            keyId: keyInfo.id,
            keyPrefix: keyInfo.keyPrefix,
            quotaUsed: keyInfo.quotaUsed,
            monthlyQuota: keyInfo.monthlyQuota,
            path: req.path,
          });

          AuditLogService.log({
            category: AuditLogService.CATEGORY.AUTHENTICATION,
            action: AuditLogService.ACTION.API_KEY_VALIDATION_FAILED,
            severity: AuditLogService.SEVERITY.MEDIUM,
            result: 'FAILURE',
            userId: keyInfo.id?.toString(),
            requestId: req.id,
            ipAddress: req.ip,
            resource: req.path,
            reason: 'Monthly quota exceeded',
            details: { keyId: keyInfo.id, quotaUsed: keyInfo.quotaUsed, monthlyQuota: keyInfo.monthlyQuota },
          }).catch(() => {});

          // Fire quota.exceeded webhook event
          WebhookService.deliver('quota.exceeded', {
            keyId: keyInfo.id,
            keyName: keyInfo.name,
            quotaUsed: keyInfo.quotaUsed,
            monthlyQuota: keyInfo.monthlyQuota,
            quotaResetAt: keyInfo.quotaResetAt ? new Date(keyInfo.quotaResetAt).toISOString() : null,
          }).catch(() => {});

          return res.status(429).json({
            success: false,
            error: {
              code: 'QUOTA_EXCEEDED',
              message: 'Monthly API quota exceeded',
              requestId: req.id,
              timestamp: new Date().toISOString(),
              quotaResetAt: keyInfo.quotaResetAt ? new Date(keyInfo.quotaResetAt).toISOString() : null,
            },
          });
        }

        // Set quota headers
        res.setHeader('X-Quota-Limit', keyInfo.monthlyQuota.toString());
        res.setHeader('X-Quota-Remaining', quotaRemaining.toString());
        res.setHeader('X-Quota-Reset', keyInfo.quotaResetAt ? new Date(keyInfo.quotaResetAt).toISOString() : '');
      }
      // --- End Quota Check ---

      // --- IP Allowlist Check ---
      if (!isIpAllowed(req.ip, keyInfo.allowedIps)) {
        log.warn('API_KEY_AUTH', 'Request rejected: IP not in allowlist', {
          keyId: keyInfo.id,
          keyPrefix: keyInfo.keyPrefix,
          clientIp: req.ip,
          path: req.path,
        });

        AuditLogService.log({
          category: AuditLogService.CATEGORY.AUTHENTICATION,
          action: AuditLogService.ACTION.API_KEY_VALIDATION_FAILED,
          severity: AuditLogService.SEVERITY.HIGH,
          result: 'FAILURE',
          userId: keyInfo.id?.toString(),
          requestId: req.id,
          ipAddress: req.ip,
          resource: req.path,
          reason: 'IP address not in allowlist',
          details: { keyId: keyInfo.id, clientIp: req.ip },
        }).catch(() => {});

        return res.status(403).json({
          success: false,
          error: {
            code: 'API_KEY_IP_RESTRICTED',
            message: 'IP address not permitted for this API key',
            requestId: req.id,
            timestamp: new Date().toISOString(),
          },
        });
      }
      // --- End IP Allowlist Check ---

      // --- Request Signing Verification ---
      if (keyInfo.signingRequired) {
        const timestamp = req.get('x-timestamp');
        const signature = req.get('x-signature');
        const rawBody = req.rawBody || '';
        const fullPath = req.originalUrl || req.url;

        const result = verifySignature({
          secret: keyInfo.keySecret,
          method: req.method,
          path: fullPath,
          timestamp,
          signature,
          body: rawBody,
        });

        if (!result.valid) {
          log.warn('API_KEY_AUTH', 'Request signature verification failed', {
            reason: result.reason,
            path: req.path,
            keyPrefix: keyInfo.keyPrefix,
          });
          return res.status(401).json({
            success: false,
            error: {
              code: 'INVALID_SIGNATURE',
              message: result.reason || 'Invalid or missing request signature',
              requestId: req.id,
              timestamp: new Date().toISOString(),
            },
          });
        }

        // --- Nonce Replay Protection ---
        const nonce = req.get('x-nonce');
        if (!nonce) {
          return res.status(401).json({
            success: false,
            error: {
              code: 'MISSING_NONCE',
              message: 'X-Nonce header is required for signed requests',
              requestId: req.id,
              timestamp: new Date().toISOString(),
            },
          });
        }

        const { seen } = await nonceStore.check(nonce);
        if (seen) {
          log.warn('API_KEY_AUTH', 'Replayed nonce rejected', {
            path: req.path,
            keyPrefix: keyInfo.keyPrefix,
          });
          return res.status(409).json({
            success: false,
            error: {
              code: 'NONCE_REPLAYED',
              message: 'This request has already been processed. Use a unique nonce per request.',
              requestId: req.id,
              timestamp: new Date().toISOString(),
            },
          });
        }
        // --- End Nonce Replay Protection ---
      }
      // --- End Request Signing Verification ---

      // Audit log: Successful API key validation
      AuditLogService.log({
        category: AuditLogService.CATEGORY.AUTHENTICATION,
        action: AuditLogService.ACTION.API_KEY_VALIDATED,
        severity: AuditLogService.SEVERITY.LOW,
        result: 'SUCCESS',
        userId: keyInfo.id?.toString(),
        requestId: req.id,
        ipAddress: req.ip,
        resource: req.path,
        details: {
          role: keyInfo.role,
          isDeprecated: keyInfo.isDeprecated || false,
          keyPrefix: apiKey.substring(0, 8) + '...'
        }
      }).catch(() => {});

      // Proactive rotation warning for client-side automated systems
      if (keyInfo.isDeprecated) {
        res.setHeader("X-API-Key-Deprecated", "true");
        res.setHeader(
          "Warning",
          '299 - "API key is deprecated and will be revoked soon"',
        );
      }

      // Suggest rotation when key age exceeds 80% of its grace period
      if (!keyInfo.isDeprecated && keyInfo.createdAt && keyInfo.gracePeriodDays) {
        const ageMs = Date.now() - keyInfo.createdAt;
        const thresholdMs = keyInfo.gracePeriodDays * 0.8 * 24 * 60 * 60 * 1000;
        if (ageMs >= thresholdMs) {
          res.setHeader("X-Rotation-Suggested", "true");
        }
      }

      // Expiry proximity header — show days remaining when key expires within 30 days
      if (keyInfo.expiresAt) {
        const msRemaining = keyInfo.expiresAt - Date.now();
        const daysRemaining = Math.ceil(msRemaining / (24 * 60 * 60 * 1000));
        if (daysRemaining <= 30) {
          res.setHeader("X-API-Key-Expires-In", String(daysRemaining));
        }
      }

      return next();
    }

    // Stage 2: Attempt Legacy Fallback (Static keys defined in environment variables)
    if (legacyKeys.length > 0) {
      // Use constant-time comparison to prevent timing attacks
      for (const legacyKey of legacyKeys) {
        if (safeEqual(apiKey, legacyKey)) {
          if (isLegacyKeyDisabled()) {
            log.warn("API_KEY_AUTH", "Rejected legacy API key after sunset", {
              sunsetDate: getLegacyKeySunsetDate(),
            });
            return res.status(401).json({
              success: false,
              error: {
                code: "LEGACY_API_KEY_DISABLED",
                message: `Legacy API keys were disabled on ${getLegacyKeySunsetDate()}. Create a database-backed key with "npm run keys:create".`,
                requestId: req.id,
                timestamp: new Date().toISOString(),
              },
            });
          }

          log.warn("API_KEY_AUTH", "Using legacy environment-based API key", {
            message:
              "Consider migrating to database-backed keys for rotation support",
          });

          // Audit log: Legacy key usage, sampled to once per key per hour (see issue #1887)
          const legacyKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
          recordLegacyKeyUsage(`legacy-${legacyKeyHash}`);
          if (allowAuditEvent(`legacy:${legacyKeyHash}`, LEGACY_AUDIT_WINDOW_MS)) {
            AuditLogService.log({
              category: AuditLogService.CATEGORY.AUTHENTICATION,
              action: AuditLogService.ACTION.LEGACY_KEY_USED,
              severity: AuditLogService.SEVERITY.LOW,
              result: 'SUCCESS',
              requestId: req.id,
              ipAddress: req.ip,
              resource: req.path,
              details: {
                role: 'user',
                isLegacy: true,
                keyIdHash: legacyKeyHash,
                warning: 'Consider migrating to database-backed keys'
              }
            }).catch(() => {});
          }

          req.apiKey = {
            role: "user",
            isLegacy: true,
          };

          return next();
        }
      }
    }

    // Stage 3: Rejection (Key is either invalid, revoked, or expired)
    recordAuthFailure("invalid_key");

    // Audit log: Invalid API key, at most once per IP per minute (see issue #1887)
    if (allowAuditEvent(`invalid:${req.ip}`, AUTH_AUDIT_WINDOW_MS)) {
      AuditLogService.log({
        category: AuditLogService.CATEGORY.AUTHENTICATION,
        action: AuditLogService.ACTION.API_KEY_VALIDATION_FAILED,
        severity: AuditLogService.SEVERITY.MEDIUM,
        result: 'FAILURE',
        requestId: req.id,
        ipAddress: req.ip,
        resource: req.path,
        reason: 'Invalid or expired API key',
        details: {
          keyPrefix: apiKey.substring(0, 8) + '...'
        }
      }).catch(() => {});
    }

    return res.status(401).json({
      success: false,
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid or expired API key.",
      },
    });
  } catch (error) {
    log.error("API_KEY_AUTH", "Error validating API key", {
      error: error.message,
    });
    // Fall back to legacy key check on DB error using constant-time comparison
    if (legacyKeys.length > 0) {
      for (const legacyKey of legacyKeys) {
        if (safeEqual(apiKey, legacyKey)) {
          req.apiKey = { role: 'user', isLegacy: true };
          return next();
        }
      }
    }
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred during authentication.',
      },
    });
  }
};

module.exports = requireApiKey;
module.exports.invalidateCachedKeyInfo = invalidateCachedKeyInfo;
module.exports._apiKeyCache = apiKeyCache;
