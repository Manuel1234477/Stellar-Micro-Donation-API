const { UnauthorizedError, ForbiddenError } = require('../utils/errors');
const { hasPermission } = require('../models/permissions');

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
      if (!req.user) {
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
 * Middleware to attach user role (mock implementation for development)
 * In production, this should extract user info from JWT or session
 * @returns {Function} Express middleware function
 */
exports.attachUserRole = () => {
  return (req, res, next) => {
    // Mock implementation - in production, extract from JWT/session
    // For now, check for API key or default to guest
    const apiKey = req.headers['x-api-key'];
    
    if (apiKey === 'admin-key-123') {
      req.user = { id: 'admin-1', role: 'admin', name: 'Admin User' };
    } else if (apiKey) {
      req.user = { id: 'user-1', role: 'user', name: 'Regular User' };
    } else {
      req.user = { id: 'guest', role: 'guest', name: 'Guest' };
    }
    
    next();
  };
};