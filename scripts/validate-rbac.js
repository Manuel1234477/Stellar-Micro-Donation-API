#!/usr/bin/env node

/**
 * RBAC Validation CLI Tool
 * Validates role permissions against the permission matrix
 */

const fs = require('fs');
const path = require('path');

const { PERMISSION_MATRIX, ROUTE_PERMISSIONS } = require('../src/config/permissionMatrix');
const { PERMISSIONS } = require('../src/models/permissions');

const ROLES_PATH = path.join(__dirname, '..', 'src', 'config', 'roles.json');

function loadRoles() {
  const raw = fs.readFileSync(ROLES_PATH, 'utf8');
  return JSON.parse(raw);
}

function getRolePermissions(roleConfig) {
  if (Array.isArray(roleConfig)) {
    return roleConfig;
  }
  if (roleConfig && Array.isArray(roleConfig.permissions)) {
    return roleConfig.permissions;
  }
  return [];
}

function validateRBAC(roles) {
  const errors = [];
  const warnings = [];

  const knownPermissions = new Set(Object.values(PERMISSIONS));
  const roleNames = Object.keys(roles);

  // Collect permissions granted to at least one role
  const grantedPermissions = new Set();
  const roleDetails = {};

  roleNames.forEach(roleName => {
    const perms = getRolePermissions(roles[roleName]);
    roleDetails[roleName] = perms;

    perms.forEach(perm => {
      if (perm === '*') {
        // Wildcard grants everything
        knownPermissions.forEach(p => grantedPermissions.add(p));
        return;
      }
      if (!knownPermissions.has(perm)) {
        errors.push(`Role "${roleName}" references unknown permission: ${perm}`);
      } else {
        grantedPermissions.add(perm);
      }
    });
  });

  // Validate route permissions
  const routeEntries = Object.entries(ROUTE_PERMISSIONS || {});
  routeEntries.forEach(([routeKey, perm]) => {
    if (!knownPermissions.has(perm)) {
      errors.push(`Route "${routeKey}" references unknown permission: ${perm}`);
    } else if (!grantedPermissions.has(perm)) {
      errors.push(`Route "${routeKey}" permission "${perm}" is not granted to any role`);
    }
  });

  // Unreachable permissions (defined but unused by any role or route)
  const routePermissions = new Set(routeEntries.map(([, perm]) => perm));
  const unused = [];
  knownPermissions.forEach(perm => {
    if (!grantedPermissions.has(perm) && !routePermissions.has(perm)) {
      unused.push(perm);
    }
  });
  if (unused.length > 0) {
    warnings.push(`Unreachable permissions (not used by any role or route): ${unused.join(', ')}`);
  }

  return {
    errors,
    warnings,
    roleDetails,
    routeEntries,
    knownPermissions,
    grantedPermissions,
    unused,
  };
}

function printHeader(title) {
  console.log('\n' + '='.repeat(70));
  console.log(`  ${title}`);
  console.log('='.repeat(70) + '\n');
}

function printSection(title) {
  console.log(`\n${title}`);
  console.log('-'.repeat(title.length));
}

function printValidationResults() {
  printHeader('RBAC VALIDATION REPORT');

  const roles = loadRoles();
  const results = validateRBAC(roles);
  const valid = results.errors.length === 0;

  // Summary
  printSection('Summary');
  console.log(`Total Roles: ${Object.keys(roles).length}`);
  console.log(`Total Routes: ${results.routeEntries.length}`);
  console.log(`Total Permissions Defined: ${results.knownPermissions.size}`);
  console.log(`Errors: ${results.errors.length}`);
  console.log(`Warnings: ${results.warnings.length}`);
  console.log(`Status: ${valid ? '✅ VALID' : '❌ INVALID'}`);

  // Role Permissions
  printSection('Role Permissions');
  Object.entries(results.roleDetails).forEach(([roleName, perms]) => {
    const description = PERMISSION_MATRIX[roleName]?.description || 'N/A';
    console.log(`\n✅ Role: ${roleName}`);
    console.log(`  Description: ${description}`);
    console.log(`  Permissions: ${perms.length}`);
  });

  // Errors
  if (results.errors.length > 0) {
    printSection('Errors');
    results.errors.forEach(error => {
      console.log(`  ❌ ${error}`);
    });
  }

  // Warnings
  if (results.warnings.length > 0) {
    printSection('Warnings');
    results.warnings.forEach(warning => {
      console.log(`  ⚠️  ${warning}`);
    });
  }

  // Final Status
  console.log('\n' + '='.repeat(70));
  if (valid && results.warnings.length === 0) {
    console.log('✅ RBAC configuration is valid with no warnings');
  } else if (valid) {
    console.log('⚠️  RBAC configuration is valid but has warnings');
  } else {
    console.log('❌ RBAC configuration has errors and must be fixed');
  }
  console.log('='.repeat(70) + '\n');

  // Exit with appropriate code
  process.exit(valid ? 0 : 1);
}

// Run validation
try {
  printValidationResults();
} catch (error) {
  console.error('\n❌ Validation failed with error:', error.message);
  console.error(error.stack);
  process.exit(1);
}
