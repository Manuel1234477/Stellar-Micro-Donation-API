/**
 * Permissions Model - Authorization Layer
 * 
 * RESPONSIBILITY: Role-based permission management and validation
 * OWNER: Security Team
 * DEPENDENCIES: roles.json config, logger
 * 
 * Loads and validates role-based permissions from configuration. Provides permission
 * checking logic for RBAC enforcement across API endpoints.
 */

const fs = require('fs');
const path = require('path');
const log = require('../utils/log');

const ROLES_CONFIG_PATH = path.join(__dirname, '../config/roles.json');

/**
 * Load roles configuration from JSON file
 * @returns {Object} Roles configuration
 */
function loadRolesConfig() {
  try {
    const data = fs.readFileSync(ROLES_CONFIG_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    log.error('PERMISSIONS', 'Failed to load roles configuration, using defaults', { error: error.message });
    // Return default configuration if file doesn't exist
    return {
      roles: [
        {
          name: 'admin',
          permissions: ['*'] // Admin has all permissions
        },
        {
          name: 'user',
          permissions: [
            'donations:create',
            'donations:read',
            'donations:verify',
            'wallets:read',
            'wallets:create',
            'wallets:update',
            'stream:create',
            'stream:read',
            'stream:update',
            'stream:delete',
            'stats:read',
            'transactions:read',
            'transactions:sync'
          ]
        },
        {
          name: 'guest',
          permissions: [
            'donations:read',
            'stats:read'
          ]
        }
      ]
    };
  }
}

/**
 * Get permissions for a specific role
 * @param {string} roleName - Name of the role
 * @returns {Array<string>} Array of permissions
 */
function getPermissionsByRole(roleName) {
  const config = loadRolesConfig();
  const role = config.roles.find(r => r.name === roleName);
  
  if (!role) {
    log.warn('PERMISSIONS', 'Role not found, returning empty permissions', { roleName });
    return [];
  }
  
  return role.permissions;
}

/**
 * Check if a role has a specific permission
 * @param {string} roleName - Name of the role
 * @param {string} permission - Permission to check
 * @returns {boolean} True if role has permission
 */
function hasPermission(roleName, permission) {
  const permissions = getPermissionsByRole(roleName);
  
  // Admin wildcard check
  if (permissions.includes('*')) {
    return true;
  }
  
  // Exact permission match
  if (permissions.includes(permission)) {
    return true;
  }
  
  // Wildcard permission check (e.g., 'donations:*' matches 'donations:create')
  const [resource] = permission.split(':');
  const wildcardPermission = `${resource}:*`;
  
  return permissions.includes(wildcardPermission);
}

/**
 * Get all available roles
 * @returns {Array<Object>} Array of role objects
 */
function getAllRoles() {
  const config = loadRolesConfig();
  return config.roles;
}

/**
 * Validate if a role exists
 * @param {string} roleName - Name of the role
 * @returns {boolean} True if role exists
 */
function roleExists(roleName) {
  const config = loadRolesConfig();
  return config.roles.some(r => r.name === roleName);
}

module.exports = {
  getPermissionsByRole,
  hasPermission,
  getAllRoles,
  roleExists,
  loadRolesConfig
};
