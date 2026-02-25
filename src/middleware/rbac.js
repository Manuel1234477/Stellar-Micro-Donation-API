const { UnauthorizedError, ForbiddenError } = require('../utils/errors');
const { hasPermission } = require('../models/permissions');
const { validateApiKey } = require('../models/apiKeys');

/**
 * Role-Based Access Control (RBAC) Configuration
 * Intent: Handle the transition between legacy environment-based keys and 
 * the new database-backed API key system with granular permissions.
 */
const legacyKeys = (process.env.API_KEYS || '')
  .split(',')
  .map(k => k.trim())
  .filter(Boolean);

/**
 * Single Permission Validator
 * Intent: Restrict endpoint access to users possessing a specific permission string.
 * Flow: 
 * 1. Verify existence of req.user object (populated by attachUserRole).
 * 2. Extract current role (defaults to 'guest' if undefined).
 * 3. Cross-reference role and permission against the permissions model.
 * 4. Pass control to next middleware if authorized; otherwise, propagate a ForbiddenError.
 */
exports.checkPermission = (permission) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Authentication required');
      }

      const userRole = req.user.role || 'guest';

      if (!hasPermission(userRole, permission)) {
        throw new ForbiddenError(`Insufficient permissions. Required: ${permission}`);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Union Permission Validator (OR Logic)
 * Intent: Allow access if the user meets any one of multiple permission criteria.
 * Flow: 
 * 1. Iterates through the 'permissions' array.
 * 2. Uses Array.prototype.some() to find at least one valid role-permission match.
 * 3. If no matches are found, generates a descriptive error listing all acceptable permissions.
 */
exports.checkAnyPermission = (permissions) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Authentication required');
      }

      const userRole = req.user.role || 'guest';
      const hasAnyPermission = permissions.some(permission => 
        hasPermission(userRole, permission)
      );

      if (!hasAnyPermission) {
        throw new ForbiddenError(`Insufficient permissions. Required one of: ${permissions.join(', ')}`);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Intersection Permission Validator (AND Logic)
 * Intent: Enforce high-security access requiring a user to possess every listed permission.
 * Flow: 
 * 1. Evaluates the entire array of required permissions using Array.prototype.every().
 * 2. Ensures the user role supports the full set of required operations.
 * 3. Strict failure if even one permission is missing from the user's role profile.
 */
exports.checkAllPermissions = (permissions) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Authentication required');
      }

      const userRole = req.user.role || 'guest';
      const hasAllPermissions = permissions.every(permission => 
        hasPermission(userRole, permission)
      );

      if (!hasAllPermissions) {
        throw new ForbiddenError(`Insufficient permissions. Required all of: ${permissions.join(', ')}`);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Administrative Access Enforcer
 * Intent: Hard-check for the 'admin' role, bypassing granular permission checks for global access.
 * Flow: Checks req.user.role strictly. Prevents 'guest' or 'user' roles from accessing management endpoints.
 */
exports.requireAdmin = () => {
  return (req, res, next) => {
    try {
      if (!req.user || req.user.role === 'guest') {
        throw new UnauthorizedError('Authentication required');
      }

      if (req.user.role !== 'admin') {
        throw new ForbiddenError('Admin access required');
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Identity & Role Attachment Middleware
 * Intent: The central authentication hub that bridges legacy keys and modern DB keys.
 * Flow:
 * 1. Checks if 'req.apiKey' was already resolved by a previous middleware (optimization).
 * 2. Scans 'x-api-key' header.
 * 3. Database Lookup: Validates key, checks expiration/revocation, and identifies role.
 * 4. Deprecation Handling: If key is marked deprecated, injects 'Warning' headers into response.
 * 5. Legacy Fallback: Checks against process.env.API_KEYS if DB lookup fails.
 * 6. Context Injection: Populates req.user with a standardized identity object for downstream use.
 */
exports.attachUserRole = () => {
  return async (req, res, next) => {
    try {
      // Priority 1: Use context from existing apiKey middleware if present
      if (req.apiKey) {
        const role = req.apiKey.role || 'user';
        const keyId = req.apiKey.id || 'legacy';
        
        req.user = {
          id: `apikey-${keyId}`,
          role: role,
          name: req.apiKey.name || `API Key User (${role})`,
          apiKeyId: req.apiKey.id,
          isLegacy: req.apiKey.isLegacy || false
        };
      } 
      // Priority 2: Standard Header Authentication
      else if (req.headers && req.headers['x-api-key']) {
        const apiKey = req.headers['x-api-key'];
        const keyInfo = await validateApiKey(apiKey);

        if (keyInfo) {
          req.apiKey = keyInfo;
          req.user = {
            id: `apikey-${keyInfo.id}`,
            role: keyInfo.role || 'user',
            name: keyInfo.name || `API Key User (${keyInfo.role || 'user'})`,
            apiKeyId: keyInfo.id,
            isLegacy: false
          };

          // Graceful handling for keys slated for rotation
          if (keyInfo.isDeprecated) {
            res.setHeader('X-API-Key-Deprecated', 'true');
            res.setHeader('Warning', '299 - "API key is deprecated and will be revoked soon"');
          }
        } 
        // Priority 3: Legacy Environment variable support
        else if (legacyKeys.includes(apiKey)) {
          req.user = {
            id: `apikey-${apiKey}`,
            role: apiKey.startsWith('admin-') ? 'admin' : 'user',
            name: 'Legacy API Key User',
            isLegacy: true
          };
        } 
        // Failure: No valid key found
        else {
          return res.status(401).json({
            success: false,
            error: {
              code: 'UNAUTHORIZED',
              message: 'Invalid or expired API key.'
            }
          });
        }
      } 
      // Default: Unauthenticated Guest access
      else {
        req.user = { id: 'guest', role: 'guest', name: 'Guest' };
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};