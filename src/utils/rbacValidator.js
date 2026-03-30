const { PERMISSION_MATRIX, ROUTE_PERMISSIONS } = require('../config/permissionMatrix');
const { getPermissionsByRole, getAllRoles } = require('../models/permissions');
const { PERMISSIONS, permissionsMatch } = require('../utils/permissions');
const log = require('../utils/log');

/**
 * Validate that role definitions match the permission matrix
 * @returns {Object} Validation result with warnings and errors
 */
function validateRolePermissions() {
  const results = {
    valid: true,
    warnings: [],
    errors: [],
    roles: {}
  };

  const actualRoles = getAllRoles();
  const matrixRoles = Object.keys(PERMISSION_MATRIX);

  // Check for missing roles
  matrixRoles.forEach(roleName => {
    const actualRole = actualRoles.find(r => r.name === roleName);

    if (!actualRole) {
      results.errors.push(`Role "${roleName}" defined in matrix but not found in configuration`);
      results.valid = false;
      return;
    }

    const matrixPerms = PERMISSION_MATRIX[roleName].permissions;
    const actualPerms = getPermissionsByRole(roleName);

    results.roles[roleName] = {
      expected: matrixPerms,
      actual: actualPerms,
      missing: [],
      extra: []
    };

    // Check for missing permissions
    matrixPerms.forEach(perm => {
      const hasPermission = actualPerms.some(actual => permissionsMatch(perm, actual));
      if (!hasPermission) {
        results.roles[roleName].missing.push(perm);
        results.warnings.push(`Role "${roleName}" missing permission: ${perm}`);
      }
    });

    // Check for extra permissions
    actualPerms.forEach(perm => {
      if (perm === '*') return; // Wildcard is always valid
      const isExpected = matrixPerms.some(expected => permissionsMatch(perm, expected));
      if (!isExpected) {
        results.roles[roleName].extra.push(perm);
        results.warnings.push(`Role "${roleName}" has unexpected permission: ${perm}`);
      }
    });
  });

  // Check for undefined roles
  actualRoles.forEach(role => {
    if (!PERMISSION_MATRIX[role.name]) {
      results.warnings.push(`Role "${role.name}" exists in configuration but not in permission matrix`);
    }
  });

  return results;
}

/**
 * Validate that all routes have proper permission checks
 * @returns {Object} Validation result
 */
function validateRoutePermissions() {
  const results = {
    valid: true,
    warnings: [],
    errors: [],
    routes: []
  };

  ROUTE_PERMISSIONS.forEach(route => {
    const routeInfo = {
      method: route.method,
      path: route.path,
      permission: route.permission,
      issues: []
    };

    // Check if permission exists in PERMISSIONS constant
    const permissionExists = Object.values(PERMISSIONS).includes(route.permission);
    if (!permissionExists) {
      routeInfo.issues.push(`Unknown permission: ${route.permission}`);
      results.errors.push(`Route ${route.method} ${route.path} uses unknown permission: ${route.permission}`);
      results.valid = false;
    }

    // Check if at least one role has this permission
    const rolesWithPermission = Object.keys(PERMISSION_MATRIX).filter(roleName => {
      const rolePerms = PERMISSION_MATRIX[roleName].permissions;
      return rolePerms.includes('*') || rolePerms.includes(route.permission);
    });

    if (rolesWithPermission.length === 0) {
      routeInfo.issues.push('No role has this permission');
      results.warnings.push(`Route ${route.method} ${route.path} requires ${route.permission} but no role has it`);
    }

    routeInfo.rolesWithAccess = rolesWithPermission;
    results.routes.push(routeInfo);
  });

  return results;
}

/**
 * Perform complete RBAC validation
 * @param {Object} options - Validation options
 * @returns {Object} Complete validation results
 */
function validateRBAC(options = {}) {
  const { throwOnError = false, logWarnings = true } = options;

  const roleValidation = validateRolePermissions();
  const routeValidation = validateRoutePermissions();

  const results = {
    valid: roleValidation.valid && routeValidation.valid,
    roleValidation,
    routeValidation,
    summary: {
      totalRoles: Object.keys(PERMISSION_MATRIX).length,
      totalRoutes: ROUTE_PERMISSIONS.length,
      totalWarnings: roleValidation.warnings.length + routeValidation.warnings.length,
      totalErrors: roleValidation.errors.length + routeValidation.errors.length
    }
  };

  // Log warnings if enabled
  if (logWarnings) {
    if (results.summary.totalErrors > 0) {
      log.error('RBAC_VALIDATION', 'RBAC validation failed', {
        errors: results.summary.totalErrors,
        warnings: results.summary.totalWarnings
      });

      roleValidation.errors.forEach(error => {
        log.error('RBAC_VALIDATION', error);
      });

      routeValidation.errors.forEach(error => {
        log.error('RBAC_VALIDATION', error);
      });
    }

    if (results.summary.totalWarnings > 0) {
      log.warn('RBAC_VALIDATION', 'RBAC validation warnings detected', {
        warnings: results.summary.totalWarnings
      });

      roleValidation.warnings.forEach(warning => {
        log.warn('RBAC_VALIDATION', warning);
      });

      routeValidation.warnings.forEach(warning => {
        log.warn('RBAC_VALIDATION', warning);
      });
    }

    if (results.valid && results.summary.totalWarnings === 0) {
      log.info('RBAC_VALIDATION', 'RBAC validation passed', {
        roles: results.summary.totalRoles,
        routes: results.summary.totalRoutes
      });
    }
  }

  // Throw error if requested
  if (throwOnError && !results.valid) {
    const errorMessages = [
      ...roleValidation.errors,
      ...routeValidation.errors
    ];
    throw new Error(`RBAC validation failed:\n${errorMessages.join('\n')}`);
  }

  return results;
}

/**
 * Get permission coverage report
 * @returns {Object} Coverage report
 */
function getPermissionCoverage() {
  const allPermissions = Object.values(PERMISSIONS);
  const usedPermissions = new Set(ROUTE_PERMISSIONS.map(r => r.permission));

  const coverage = {
    total: allPermissions.length,
    used: usedPermissions.size,
    unused: allPermissions.filter(p => !usedPermissions.has(p)),
    percentage: Math.round((usedPermissions.size / allPermissions.length) * 100)
  };

  return coverage;
}

module.exports = {
  validateRolePermissions,
  validateRoutePermissions,
  validateRBAC,
  getPermissionCoverage
};
