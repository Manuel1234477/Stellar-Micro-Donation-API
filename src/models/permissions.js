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

// Internal modules
const log = require('../utils/log');

const ROLES_CONFIG_PATH = path.join(__dirname, '../config/roles.json');


/**
 * Validate the structure of a parsed roles configuration object.
 *
 * Checks:
 * - Root is a non-null object
 * - Has a `roles` property that is a non-empty array
 * - Each role is an object with a non-empty string `name`
 * - Each role has a `permissions` array with at least one entry
 * - Each permission string is either `*` or in `resource:action` format
 *
 * @param {*} config - The parsed roles configuration to validate.
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }} Validation result.
 */
function validateRolesConfig(config) {
  const errors = [];
  const warnings = [];
  const seenNames = new Set();

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    errors.push('Roles configuration must be a non-null object');
    return { valid: false, errors, warnings };
  }

  if (!Array.isArray(config.roles)) {
    errors.push('Roles configuration must contain a "roles" array');
    return { valid: false, errors, warnings };
  }

  if (config.roles.length === 0) {
    errors.push('The "roles" array must not be empty');
    return { valid: false, errors, warnings };
  }

  const allowedRoleKeys = new Set(['name', 'permissions']);

  for (const [i, role] of config.roles.entries()) {
    if (!role || typeof role !== 'object' || Array.isArray(role)) {
      errors.push(`Role at index ${i} must be a non-null object`);
      continue;
    }

    // Validate no unknown keys
    for (const key of Object.keys(role)) {
      if (!allowedRoleKeys.has(key)) {
        errors.push(`Role at index ${i} has unknown key "${key}" (allowed: name, permissions)`);
      }
    }

    // Validate role name
    if (!role.name || typeof role.name !== 'string') {
      errors.push(`Role at index ${i} must have a non-empty string "name"`);
    } else if (role.name.trim() === '') {
      errors.push(`Role at index ${i} has an empty "name"`);
    }

    // Validate permissions
    if (!Array.isArray(role.permissions)) {
      errors.push(`Role "${role.name || i}" must have a "permissions" array`);
    } else if (role.permissions.length === 0) {
      errors.push(`Role "${role.name}" has an empty "permissions" array`);
    } else {
      for (const [j, perm] of role.permissions.entries()) {
        if (typeof perm !== 'string') {
          errors.push(`Role "${role.name}", permission at index ${j} must be a string, got ${typeof perm}`);
        } else if (perm === '*') {
          // Wildcard is always valid
        } else if (!/^[a-zA-Z0-9_-]+:[a-zA-Z0-9_*-]+$/.test(perm)) {
          errors.push(`Role "${role.name}", permission "${perm}" at index ${j} must be "*" or match expected format "resource:action"`);
        }
      }
    }

    if (typeof role.name === 'string' && role.name.trim() !== '') {
      if (seenNames.has(role.name)) {
        errors.push(`Duplicate role name "${role.name}" detected`);
      } else {
        seenNames.add(role.name);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Load roles configuration from JSON file
 * @returns {Object} Roles configuration
 */
function loadRolesConfig() {
  try {
    const data = fs.readFileSync(ROLES_CONFIG_PATH, 'utf8');
    const config = JSON.parse(data);

    const validation = validateRolesConfig(config);
    if (!validation.valid) {
      const message = `Invalid roles.json configuration: ${validation.errors.join('; ')}`;
      log.error('PERMISSIONS', message, { errors: validation.errors });
      for (const err of validation.errors) {
        log.error('PERMISSIONS', `  roles.json validation error: ${err}`);
      }
      for (const warn of validation.warnings) {
        log.warn('PERMISSIONS', `  roles.json validation warning: ${warn}`);
      }
      throw new Error(message);
    }

    if (validation.warnings.length > 0) {
      for (const warn of validation.warnings) {
        log.warn('PERMISSIONS', `roles.json: ${warn}`);
      }
    }

    return config;
  } catch (error) {
    if (error && error.message && error.message.startsWith('Invalid roles.json configuration:')) {
      throw error;
    }

    const message = `Failed to load roles configuration from ${ROLES_CONFIG_PATH}: ${error.message}`;
    log.error('PERMISSIONS', message, { error: error.message });
    throw new Error(message);
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
  loadRolesConfig,
  validateRolesConfig
};
