const { UnauthorizedError, ForbiddenError } = require('../utils/errors');
const { hasPermission } = require('../models/permissions');
const { validateApiKey } = require('../models/apiKeys');

const legacyKeys = (process.env.API_KEYS || '')
  .split(',')
  .map(k => k.trim())
  .filter(Boolean);

/**
 * Middleware to check if user has required permission
 * @param {string} permission - Required permission (e.g., 'donations:create')
 * @returns {Function} Express middleware function
 */
exports.checkPermission = (permission) => {
  return (req, res, next) => {
    try {
      // Check if user is authenticated
      if (!req.user) {
        throw new UnauthorizedError('Authentication required');
      }

      const userRole = req.user.role || 'guest';

      // Check if user has the required permission
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
 * Middleware to check if user has ANY of the required permissions
 * @param {Array<string>} permissions - Array of permissions (user needs at least one)
 * @returns {Function} Express middleware function
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
 * Middleware to check if user has ALL of the required permissions
 * @param {Array<string>} permissions - Array of permissions (user needs all)
 * @returns {Function} Express middleware function
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
 * Middleware to check if user is admin
 * @returns {Function} Express middleware function
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
 * Middleware to attach user role
 * Uses API key info from database or falls back to legacy behavior
 * @returns {Function} Express middleware function
 */
exports.attachUserRole = () => {
  return async (req, res, next) => {
    try {
      // If API key middleware already attached key info, use it
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
      } else if (req.headers && req.headers['x-api-key']) {
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

          if (keyInfo.isDeprecated) {
            res.setHeader('X-API-Key-Deprecated', 'true');
            res.setHeader('Warning', '299 - "API key is deprecated and will be revoked soon"');
          }
        } else if (legacyKeys.includes(apiKey)) {
          req.user = {
            id: `apikey-${apiKey}`,
            role: apiKey.startsWith('admin-') ? 'admin' : 'user',
            name: 'Legacy API Key User',
            isLegacy: true
          };
        } else {
          return res.status(401).json({
            success: false,
            error: {
              code: 'UNAUTHORIZED',
              message: 'Invalid or expired API key.'
            }
          });
        }
      } else {
        // No API key, default to guest
        req.user = { id: 'guest', role: 'guest', name: 'Guest' };
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};
