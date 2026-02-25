const { validateApiKey } = require('../models/apiKeys');
const log = require('../utils/log');

// Legacy environment-based keys for backward compatibility
const legacyKeys = (process.env.API_KEYS || '')
  .split(',')
  .map(k => k.trim())
  .filter(Boolean);

/**
 * Middleware to require and validate API key
 * Supports both database-backed keys (with rotation) and legacy env-based keys
 */
async function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];

  if (!key) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Valid API key required. Provide it via the x-api-key header.'
      }
    });
  }

  try {
    // First, try database-backed key validation
    const keyInfo = await validateApiKey(key);
    
    if (keyInfo) {
      // Attach key info to request for downstream use
      req.apiKey = keyInfo;
      
      // Warn if using deprecated key
      if (keyInfo.isDeprecated) {
        res.setHeader('X-API-Key-Deprecated', 'true');
        res.setHeader('Warning', '299 - "API key is deprecated and will be revoked soon"');
      }
      
      return next();
    }

    // Fallback to legacy environment-based keys
    if (legacyKeys.length > 0 && legacyKeys.includes(key)) {
      log.warn('API_KEY_AUTH', 'Using legacy environment-based API key', {
        message: 'Consider migrating to database-backed keys for rotation support'
      });
      
      // Set legacy flag
      req.apiKey = {
        role: 'user',
        isLegacy: true
      };
      
      return next();
    }

    // No valid key found
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired API key.'
      }
    });

  } catch (error) {
    log.error('API_KEY_AUTH', 'Error validating API key', { error: error.message });
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to validate API key.'
      }
    });
  }
}

module.exports = requireApiKey;
