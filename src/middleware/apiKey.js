/**
 * API Key Middleware - Authentication Layer
 * 
 * RESPONSIBILITY: API key validation and authentication for all protected endpoints
 * OWNER: Security Team
 * DEPENDENCIES: API Keys model, security config, logger
 * 
 * Validates API keys against both database-backed keys and legacy environment variables.
 * Supports key rotation, expiration, and role-based access control.
 */

const { securityConfig } = require("../config/securityConfig");
const { validateKey } = require("../models/apiKeys");
const log = require("../utils/log");

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
  const apiKey = req.get("x-api-key");

  if (!apiKey) {
    log.warn("API_KEY", "Missing API key in request", {
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      path: req.path,
    });
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
    const keyInfo = await validateApiKey(key);

    if (keyInfo) {
      req.apiKey = keyInfo;

      // Proactive rotation warning for client-side automated systems
      if (keyInfo.isDeprecated) {
        res.setHeader("X-API-Key-Deprecated", "true");
        res.setHeader(
          "Warning",
          '299 - "API key is deprecated and will be revoked soon"',
        );
      }

      return next();
    }

    // Stage 2: Attempt Legacy Fallback (Static keys defined in environment variables)
    if (legacyKeys.length > 0 && legacyKeys.includes(key)) {
      log.warn("API_KEY_AUTH", "Using legacy environment-based API key", {
        message:
          "Consider migrating to database-backed keys for rotation support",
      });

      req.apiKey = {
        role: "user",
        isLegacy: true,
      };

      return next();
    }

    // Stage 3: Rejection (Key is either invalid, revoked, or expired)
    return res.status(401).json({
      success: false,
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid or expired API key.",
      },
    });
  } catch (error) {
    // Fail-safe: Ensure database or logic errors don't accidentally leak information
    log.error("API_KEY_AUTH", "Error validating API key", {
      error: error.message,
    });
    return res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to validate API key.",
      },
    });
  }
};

module.exports = requireApiKey;
