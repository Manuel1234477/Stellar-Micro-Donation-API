const { validateApiKey } = require('../models/apiKeys');
const log = require('../utils/log');

/**
 * Legacy Support Configuration
 * Intent: Maintain backward compatibility for users still utilizing environment-variable based keys.
 */
const legacyKeys = (process.env.API_KEYS || '')
  .split(',')
  .map(k => k.trim())
  .filter(Boolean);

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
async function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];

  // Block requests missing the required authentication header
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
    // Stage 1: Attempt Database-backed validation (Supports key rotation & granular roles)
    const keyInfo = await validateApiKey(key);
    
    if (keyInfo) {
      req.apiKey = keyInfo;
      
      // Proactive rotation warning for client-side automated systems
      if (keyInfo.isDeprecated) {
        res.setHeader('X-API-Key-Deprecated', 'true');
        res.setHeader('Warning', '299 - "API key is deprecated and will be revoked soon"');
      }
      
      return next();
    }

    // Stage 2: Attempt Legacy Fallback (Static keys defined in environment variables)
    if (legacyKeys.length > 0 && legacyKeys.includes(key)) {
      log.warn('API_KEY_AUTH', 'Using legacy environment-based API key', {
        message: 'Consider migrating to database-backed keys for rotation support'
      });
      
      req.apiKey = {
        role: 'user',
        isLegacy: true
      };
      
      return next();
    }

    // Stage 3: Rejection (Key is either invalid, revoked, or expired)
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired API key.'
      }
    });

  } catch (error) {
    // Fail-safe: Ensure database or logic errors don't accidentally leak information
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