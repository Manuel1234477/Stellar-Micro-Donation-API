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
const { validateKey, incrementQuota } = require("../models/apiKeys");
const log = require("../utils/log");
const AuditLogService = require("../services/AuditLogService");
const { verify: verifySignature } = require("../utils/requestSigner");
const { isIpAllowed } = require("../utils/ipAllowlist");
const { defaultStore: nonceStore } = require("../utils/nonceStore");
const WebhookService = require("../services/WebhookService");

/**
 * Legacy Support Configuration
 * Uses security configuration for API keys with safe defaults
 */
const legacyKeys = securityConfig.API_KEYS || [];

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

  const apiKey = req.get("x-api-key");

  if (!apiKey) {
    log.warn("API_KEY", "Missing API key in request", {
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      path: req.path,
    });

    // Audit log: Missing API key
    AuditLogService.log({
      category: AuditLogService.CATEGORY.AUTHENTICATION,
      action: AuditLogService.ACTION.API_KEY_VALIDATION_FAILED,
      severity: AuditLogService.SEVERITY.HIGH,
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
    const keyInfo = await validateKey(apiKey);

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
            code: 'FORBIDDEN',
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

        const { seen } = nonceStore.check(nonce);
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
    if (legacyKeys.length > 0 && legacyKeys.includes(apiKey)) {
      log.warn("API_KEY_AUTH", "Using legacy environment-based API key", {
        message:
          "Consider migrating to database-backed keys for rotation support",
      });

      // Audit log: Legacy key usage
      AuditLogService.log({
        category: AuditLogService.CATEGORY.AUTHENTICATION,
        action: AuditLogService.ACTION.LEGACY_KEY_USED,
        severity: AuditLogService.SEVERITY.MEDIUM,
        result: 'SUCCESS',
        requestId: req.id,
        ipAddress: req.ip,
        resource: req.path,
        details: {
          role: 'user',
          isLegacy: true,
          warning: 'Consider migrating to database-backed keys'
        }
      }).catch(() => {});

      req.apiKey = {
        role: "user",
        isLegacy: true,
      };

      return next();
    }

    // Stage 3: Rejection (Key is either invalid, revoked, or expired)
    // Audit log: Invalid API key
    AuditLogService.log({
      category: AuditLogService.CATEGORY.AUTHENTICATION,
      action: AuditLogService.ACTION.API_KEY_VALIDATION_FAILED,
      severity: AuditLogService.SEVERITY.HIGH,
      result: 'FAILURE',
      requestId: req.id,
      ipAddress: req.ip,
      resource: req.path,
      reason: 'Invalid or expired API key',
      details: {
        keyPrefix: apiKey.substring(0, 8) + '...'
      }
    }).catch(() => {});

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
    // Fall back to legacy key check on DB error
    if (legacyKeys.length > 0 && legacyKeys.includes(apiKey)) {
      req.apiKey = { role: 'user', isLegacy: true };
      return next();
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
