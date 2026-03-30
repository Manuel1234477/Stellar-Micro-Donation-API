#!/usr/bin/env node

/**
 * RBAC Validation CLI Tool
 * Validates role permissions against the permission matrix
 */

const { validateRBAC, getPermissionCoverage } = require('../src/utils/rbacValidator');
const { PERMISSION_MATRIX } = require('../src/config/permissionMatrix');

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

  const results = validateRBAC({ logWarnings: false, throwOnError: false });

  // Summary
  printSection('Summary');
  console.log(`Total Roles: ${results.summary.totalRoles}`);
  console.log(`Total Routes: ${results.summary.totalRoutes}`);
  console.log(`Errors: ${results.summary.totalErrors}`);
  console.log(`Warnings: ${results.summary.totalWarnings}`);
  console.log(`Status: ${results.valid ? '✅ VALID' : '❌ INVALID'}`);

  // Role Validation
  if (Object.keys(results.roleValidation.roles).length > 0) {
    printSection('Role Permissions');
    
    Object.entries(results.roleValidation.roles).forEach(([roleName, roleInfo]) => {
      const status = roleInfo.missing.length === 0 && roleInfo.extra.length === 0 ? '✅' : '⚠️';
      console.log(`\n${status} Role: ${roleName}`);
      console.log(`  Description: ${PERMISSION_MATRIX[roleName]?.description || 'N/A'}`);
      console.log(`  Expected Permissions: ${roleInfo.expected.length}`);
      console.log(`  Actual Permissions: ${roleInfo.actual.length}`);
      
      if (roleInfo.missing.length > 0) {
        console.log(`  ❌ Missing: ${roleInfo.missing.join(', ')}`);
      }
      
      if (roleInfo.extra.length > 0) {
        console.log(`  ⚠️  Extra: ${roleInfo.extra.join(', ')}`);
      }
    });
  }

  // Errors
  if (results.roleValidation.errors.length > 0) {
    printSection('Errors');
    results.roleValidation.errors.forEach(error => {
      console.log(`  ❌ ${error}`);
    });
  }

  if (results.routeValidation.errors.length > 0) {
    results.routeValidation.errors.forEach(error => {
      console.log(`  ❌ ${error}`);
    });
  }

  // Warnings
  if (results.roleValidation.warnings.length > 0 || results.routeValidation.warnings.length > 0) {
    printSection('Warnings');
    
    results.roleValidation.warnings.forEach(warning => {
      console.log(`  ⚠️  ${warning}`);
    });
    
    results.routeValidation.warnings.forEach(warning => {
      console.log(`  ⚠️  ${warning}`);
    });
  }

  // Permission Coverage
  const coverage = getPermissionCoverage();
  printSection('Permission Coverage');
  console.log(`Total Permissions Defined: ${coverage.total}`);
  console.log(`Permissions Used in Routes: ${coverage.used}`);
  console.log(`Coverage: ${coverage.percentage}%`);
  
  if (coverage.unused.length > 0) {
    console.log(`\nUnused Permissions:`);
    coverage.unused.forEach(perm => {
      console.log(`  • ${perm}`);
    });
  }

  // Route Access Matrix
  printSection('Route Access Matrix');
  console.log('\nRoutes by Role Access:\n');
  
  const roleRoutes = {};
  Object.keys(PERMISSION_MATRIX).forEach(role => {
    roleRoutes[role] = [];
  });

  results.routeValidation.routes.forEach(route => {
    route.rolesWithAccess.forEach(role => {
      roleRoutes[role].push(`${route.method} ${route.path}`);
    });
  });

  Object.entries(roleRoutes).forEach(([role, routes]) => {
    console.log(`${role.toUpperCase()} (${routes.length} routes):`);
    if (routes.length > 0) {
      routes.slice(0, 5).forEach(route => {
        console.log(`  • ${route}`);
      });
      if (routes.length > 5) {
        console.log(`  ... and ${routes.length - 5} more`);
      }
    } else {
      console.log(`  (no routes)`);
    }
    console.log('');
  });

  // Final Status
  console.log('\n' + '='.repeat(70));
  if (results.valid && results.summary.totalWarnings === 0) {
    console.log('✅ RBAC configuration is valid with no warnings');
  } else if (results.valid) {
    console.log('⚠️  RBAC configuration is valid but has warnings');
  } else {
    console.log('❌ RBAC configuration has errors and must be fixed');
  }
  console.log('='.repeat(70) + '\n');

  // Exit with appropriate code
  process.exit(results.valid ? 0 : 1);
}

// Run validation
try {
  printValidationResults();
} catch (error) {
  console.error('\n❌ Validation failed with error:', error.message);
  console.error(error.stack);
  process.exit(1);
}
