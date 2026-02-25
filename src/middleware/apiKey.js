/**
 * API Key Middleware
 * Validates API keys against both database and legacy environment variables
 * Uses security configuration for safe defaults and validation
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
 * API Key Validation Middleware
 * Validates x-api-key header against database and legacy keys
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
    // First try database validation
    const keyInfo = await validateKey(apiKey);

    if (keyInfo) {
      // Valid database key found
      req.user = {
        id: keyInfo.id,
        role: keyInfo.role,
        keyPrefix: keyInfo.key_prefix,
        isDeprecated: keyInfo.isDeprecated,
        source: "database",
      };

      log.info("API_KEY", "Valid database API key used", {
        keyPrefix: keyInfo.key_prefix,
        role: keyInfo.role,
        path: req.path,
        isDeprecated: keyInfo.isDeprecated,
      });

      // Add deprecation warning if needed
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
