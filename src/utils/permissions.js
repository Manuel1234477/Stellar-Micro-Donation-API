/**
 * Permission utility functions
 * Provides helper functions for permission management
 */

/**
 * Permission constants for the application
 */
const PERMISSIONS = {
  // Donation permissions
  DONATIONS_CREATE: 'donations:create',
  DONATIONS_READ: 'donations:read',
  DONATIONS_UPDATE: 'donations:update',
  DONATIONS_DELETE: 'donations:delete',
  DONATIONS_VERIFY: 'donations:verify',
  
  // Wallet permissions
  WALLETS_CREATE: 'wallets:create',
  WALLETS_READ: 'wallets:read',
  WALLETS_UPDATE: 'wallets:update',
  WALLETS_DELETE: 'wallets:delete',
  
  // Stream (recurring donations) permissions
  STREAM_CREATE: 'stream:create',
  STREAM_READ: 'stream:read',
  STREAM_UPDATE: 'stream:update',
  STREAM_DELETE: 'stream:delete',
  
  // Stats permissions
  STATS_READ: 'stats:read',
  STATS_ADMIN: 'stats:admin',
  
  // Admin permissions
  ADMIN_ALL: '*'
};

/**
 * Role constants
 */
const ROLES = {
  ADMIN: 'admin',
  USER: 'user',
  GUEST: 'guest'
};

/**
 * Check if a permission string is valid
 * @param {string} permission - Permission to validate
 * @returns {boolean} True if valid
 */
function isValidPermission(permission) {
  if (!permission || typeof permission !== 'string') {
    return false;
  }
  
  // Check for wildcard
  if (permission === '*') {
    return true;
  }
  
  // Check format: resource:action or resource:*
  const parts = permission.split(':');
  if (parts.length !== 2) {
    return false;
  }
  
  const [resource, action] = parts;
  return Boolean(resource && action);
}

/**
 * Parse permission string into resource and action
 * @param {string} permission - Permission string
 * @returns {Object} Object with resource and action
 */
function parsePermission(permission) {
  if (permission === '*') {
    return { resource: '*', action: '*' };
  }
  
  const [resource, action] = permission.split(':');
  return { resource, action };
}

/**
 * Check if two permissions match (considering wildcards)
 * @param {string} required - Required permission
 * @param {string} granted - Granted permission
 * @returns {boolean} True if they match
 */
function permissionsMatch(required, granted) {
  // Wildcard grants everything
  if (granted === '*') {
    return true;
  }
  
  // Exact match
  if (required === granted) {
    return true;
  }
  
  // Check resource-level wildcard
  const reqParsed = parsePermission(required);
  const grantedParsed = parsePermission(granted);
  
  if (reqParsed.resource === grantedParsed.resource && grantedParsed.action === '*') {
    return true;
  }
  
  return false;
}

/**
 * Get resource from permission string
 * @param {string} permission - Permission string
 * @returns {string} Resource name
 */
function getResource(permission) {
  return parsePermission(permission).resource;
}

/**
 * Get action from permission string
 * @param {string} permission - Permission string
 * @returns {string} Action name
 */
function getAction(permission) {
  return parsePermission(permission).action;
}

module.exports = {
  PERMISSIONS,
  ROLES,
  isValidPermission,
  parsePermission,
  permissionsMatch,
  getResource,
  getAction
};
