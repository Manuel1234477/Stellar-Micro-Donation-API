const { validateRBAC, validateRolePermissions, validateRoutePermissions, getPermissionCoverage } = require('../../../src/utils/rbacValidator');
const { PERMISSION_MATRIX } = require('../../../src/config/permissionMatrix');
const { PERMISSIONS } = require('../../../src/utils/permissions');

describe('RBAC Validator', () => {
  describe('validateRolePermissions', () => {
    test('should validate all roles in permission matrix', () => {
      const results = validateRolePermissions();
      
      expect(results).toHaveProperty('valid');
      expect(results).toHaveProperty('warnings');
      expect(results).toHaveProperty('errors');
      expect(results).toHaveProperty('roles');
    });

    test('should detect admin role with wildcard permission', () => {
      const results = validateRolePermissions();
      
      expect(results.roles.admin).toBeDefined();
      expect(results.roles.admin.expected).toContain('*');
    });

    test('should validate user role permissions', () => {
      const results = validateRolePermissions();
      
      expect(results.roles.user).toBeDefined();
      expect(results.roles.user.expected.length).toBeGreaterThan(0);
    });

    test('should validate guest role permissions', () => {
      const results = validateRolePermissions();
      
      expect(results.roles.guest).toBeDefined();
      expect(results.roles.guest.expected).toContain(PERMISSIONS.DONATIONS_READ);
      expect(results.roles.guest.expected).toContain(PERMISSIONS.STATS_READ);
    });

    test('should detect missing permissions', () => {
      const results = validateRolePermissions();
      
      Object.values(results.roles).forEach(role => {
        expect(Array.isArray(role.missing)).toBe(true);
        expect(Array.isArray(role.extra)).toBe(true);
      });
    });
  });

  describe('validateRoutePermissions', () => {
    test('should validate all route permissions', () => {
      const results = validateRoutePermissions();
      
      expect(results).toHaveProperty('valid');
      expect(results).toHaveProperty('warnings');
      expect(results).toHaveProperty('errors');
      expect(results).toHaveProperty('routes');
      expect(results.routes.length).toBeGreaterThan(0);
    });

    test('should ensure all routes have valid permissions', () => {
      const results = validateRoutePermissions();
      
      results.routes.forEach(route => {
        expect(route).toHaveProperty('method');
        expect(route).toHaveProperty('path');
        expect(route).toHaveProperty('permission');
        expect(route).toHaveProperty('rolesWithAccess');
      });
    });

    test('should detect routes with no role access', () => {
      const results = validateRoutePermissions();
      
      const routesWithoutAccess = results.routes.filter(r => r.rolesWithAccess.length === 0);
      
      if (routesWithoutAccess.length > 0) {
        expect(results.warnings.length).toBeGreaterThan(0);
      }
    });

    test('should validate admin routes require admin permission', () => {
      const results = validateRoutePermissions();
      
      const adminRoutes = results.routes.filter(r => r.path.includes('/api-keys'));
      
      adminRoutes.forEach(route => {
        expect(route.permission).toBe(PERMISSIONS.ADMIN_ALL);
        expect(route.rolesWithAccess).toContain('admin');
      });
    });

    test('should validate donation routes', () => {
      const results = validateRoutePermissions();
      
      const donationRoutes = results.routes.filter(r => r.path.startsWith('/donations'));
      
      expect(donationRoutes.length).toBeGreaterThan(0);
      donationRoutes.forEach(route => {
        expect(route.permission).toMatch(/^donations:/);
      });
    });

    test('should validate wallet routes', () => {
      const results = validateRoutePermissions();
      
      const walletRoutes = results.routes.filter(r => r.path.startsWith('/wallets'));
      
      expect(walletRoutes.length).toBeGreaterThan(0);
      walletRoutes.forEach(route => {
        expect(route.permission).toMatch(/^wallets:/);
      });
    });
  });

  describe('validateRBAC', () => {
    test('should perform complete RBAC validation', () => {
      const results = validateRBAC({ logWarnings: false });
      
      expect(results).toHaveProperty('valid');
      expect(results).toHaveProperty('roleValidation');
      expect(results).toHaveProperty('routeValidation');
      expect(results).toHaveProperty('summary');
    });

    test('should provide summary statistics', () => {
      const results = validateRBAC({ logWarnings: false });
      
      expect(results.summary).toHaveProperty('totalRoles');
      expect(results.summary).toHaveProperty('totalRoutes');
      expect(results.summary).toHaveProperty('totalWarnings');
      expect(results.summary).toHaveProperty('totalErrors');
      
      expect(results.summary.totalRoles).toBe(Object.keys(PERMISSION_MATRIX).length);
      expect(results.summary.totalRoutes).toBeGreaterThan(0);
    });

    test('should not throw error by default', () => {
      expect(() => {
        validateRBAC({ logWarnings: false, throwOnError: false });
      }).not.toThrow();
    });

    test('should validate without errors', () => {
      const results = validateRBAC({ logWarnings: false });
      
      expect(results.valid).toBe(true);
      expect(results.summary.totalErrors).toBe(0);
    });
  });

  describe('getPermissionCoverage', () => {
    test('should calculate permission coverage', () => {
      const coverage = getPermissionCoverage();
      
      expect(coverage).toHaveProperty('total');
      expect(coverage).toHaveProperty('used');
      expect(coverage).toHaveProperty('unused');
      expect(coverage).toHaveProperty('percentage');
    });

    test('should have high permission coverage', () => {
      const coverage = getPermissionCoverage();
      
      expect(coverage.percentage).toBeGreaterThan(50);
      expect(coverage.used).toBeGreaterThan(0);
    });

    test('should list unused permissions', () => {
      const coverage = getPermissionCoverage();
      
      expect(Array.isArray(coverage.unused)).toBe(true);
    });
  });

  describe('Permission Matrix Integrity', () => {
    test('should have all required roles defined', () => {
      expect(PERMISSION_MATRIX).toHaveProperty('admin');
      expect(PERMISSION_MATRIX).toHaveProperty('user');
      expect(PERMISSION_MATRIX).toHaveProperty('guest');
    });

    test('should have descriptions for all roles', () => {
      Object.entries(PERMISSION_MATRIX).forEach(([roleName, roleConfig]) => {
        expect(roleConfig).toHaveProperty('description');
        expect(roleConfig.description).toBeTruthy();
      });
    });

    test('should have permissions array for all roles', () => {
      Object.entries(PERMISSION_MATRIX).forEach(([roleName, roleConfig]) => {
        expect(roleConfig).toHaveProperty('permissions');
        expect(Array.isArray(roleConfig.permissions)).toBe(true);
        expect(roleConfig.permissions.length).toBeGreaterThan(0);
      });
    });

    test('admin should have wildcard permission', () => {
      expect(PERMISSION_MATRIX.admin.permissions).toContain('*');
    });

    test('guest should have minimal permissions', () => {
      const guestPerms = PERMISSION_MATRIX.guest.permissions;
      
      expect(guestPerms.length).toBeLessThan(PERMISSION_MATRIX.user.permissions.length);
      expect(guestPerms).toContain(PERMISSIONS.DONATIONS_READ);
      expect(guestPerms).toContain(PERMISSIONS.STATS_READ);
    });

    test('user should have more permissions than guest', () => {
      const userPerms = PERMISSION_MATRIX.user.permissions;
      const guestPerms = PERMISSION_MATRIX.guest.permissions;
      
      expect(userPerms.length).toBeGreaterThan(guestPerms.length);
    });
  });

  describe('Role Hierarchy', () => {
    test('admin should have access to all routes', () => {
      const results = validateRoutePermissions();
      
      results.routes.forEach(route => {
        expect(route.rolesWithAccess).toContain('admin');
      });
    });

    test('guest should have limited access', () => {
      const results = validateRoutePermissions();
      
      const guestRoutes = results.routes.filter(r => r.rolesWithAccess.includes('guest'));
      const totalRoutes = results.routes.length;
      
      expect(guestRoutes.length).toBeLessThan(totalRoutes);
    });

    test('user should have more access than guest', () => {
      const results = validateRoutePermissions();
      
      const userRoutes = results.routes.filter(r => r.rolesWithAccess.includes('user'));
      const guestRoutes = results.routes.filter(r => r.rolesWithAccess.includes('guest'));
      
      expect(userRoutes.length).toBeGreaterThan(guestRoutes.length);
    });
  });
});
