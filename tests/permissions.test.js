const { hasPermission, getPermissionsByRole, roleExists } = require('../src/models/permissions');
const { PERMISSIONS, ROLES, isValidPermission, permissionsMatch } = require('../src/utils/permissions');

describe('Permission System Tests', () => {
  describe('Role Permissions', () => {
    test('admin should have all permissions', () => {
      expect(hasPermission(ROLES.ADMIN, PERMISSIONS.DONATIONS_CREATE)).toBe(true);
      expect(hasPermission(ROLES.ADMIN, PERMISSIONS.WALLETS_DELETE)).toBe(true);
      expect(hasPermission(ROLES.ADMIN, PERMISSIONS.STATS_ADMIN)).toBe(true);
      expect(hasPermission(ROLES.ADMIN, 'any:permission')).toBe(true);
    });

    test('user should have limited permissions', () => {
      expect(hasPermission(ROLES.USER, PERMISSIONS.DONATIONS_CREATE)).toBe(true);
      expect(hasPermission(ROLES.USER, PERMISSIONS.DONATIONS_READ)).toBe(true);
      expect(hasPermission(ROLES.USER, PERMISSIONS.WALLETS_READ)).toBe(true);
      expect(hasPermission(ROLES.USER, PERMISSIONS.STREAM_CREATE)).toBe(true);
    });

    test('user should NOT have admin permissions', () => {
      expect(hasPermission(ROLES.USER, PERMISSIONS.WALLETS_DELETE)).toBe(false);
      expect(hasPermission(ROLES.USER, PERMISSIONS.STATS_ADMIN)).toBe(false);
    });

    test('guest should have minimal permissions', () => {
      expect(hasPermission(ROLES.GUEST, PERMISSIONS.DONATIONS_READ)).toBe(true);
      expect(hasPermission(ROLES.GUEST, PERMISSIONS.STATS_READ)).toBe(true);
    });

    test('guest should NOT have write permissions', () => {
      expect(hasPermission(ROLES.GUEST, PERMISSIONS.DONATIONS_CREATE)).toBe(false);
      expect(hasPermission(ROLES.GUEST, PERMISSIONS.WALLETS_CREATE)).toBe(false);
      expect(hasPermission(ROLES.GUEST, PERMISSIONS.STREAM_CREATE)).toBe(false);
    });
  });

  describe('Role Validation', () => {
    test('should validate existing roles', () => {
      expect(roleExists(ROLES.ADMIN)).toBe(true);
      expect(roleExists(ROLES.USER)).toBe(true);
      expect(roleExists(ROLES.GUEST)).toBe(true);
    });

    test('should reject non-existent roles', () => {
      expect(roleExists('superuser')).toBe(false);
      expect(roleExists('moderator')).toBe(false);
      expect(roleExists('')).toBe(false);
    });
  });

  describe('Permission Utilities', () => {
    test('should validate permission format', () => {
      expect(isValidPermission('donations:create')).toBe(true);
      expect(isValidPermission('wallets:read')).toBe(true);
      expect(isValidPermission('*')).toBe(true);
      expect(isValidPermission('donations:*')).toBe(true);
    });

    test('should reject invalid permission format', () => {
      expect(isValidPermission('invalid')).toBe(false);
      expect(isValidPermission('too:many:parts')).toBe(false);
      expect(isValidPermission('')).toBe(false);
      expect(isValidPermission(null)).toBe(false);
      expect(isValidPermission(undefined)).toBe(false);
    });

    test('should match permissions correctly', () => {
      expect(permissionsMatch('donations:create', '*')).toBe(true);
      expect(permissionsMatch('donations:create', 'donations:create')).toBe(true);
      expect(permissionsMatch('donations:create', 'donations:*')).toBe(true);
    });

    test('should not match different permissions', () => {
      expect(permissionsMatch('donations:create', 'donations:read')).toBe(false);
      expect(permissionsMatch('donations:create', 'wallets:create')).toBe(false);
      expect(permissionsMatch('donations:create', 'wallets:*')).toBe(false);
    });
  });

  describe('Get Permissions by Role', () => {
    test('should return correct permissions for admin', () => {
      const permissions = getPermissionsByRole(ROLES.ADMIN);
      expect(permissions).toContain('*');
    });

    test('should return correct permissions for user', () => {
      const permissions = getPermissionsByRole(ROLES.USER);
      expect(permissions).toContain('donations:create');
      expect(permissions).toContain('donations:read');
      expect(permissions).toContain('wallets:read');
      expect(permissions).not.toContain('*');
    });

    test('should return correct permissions for guest', () => {
      const permissions = getPermissionsByRole(ROLES.GUEST);
      expect(permissions).toContain('donations:read');
      expect(permissions).toContain('stats:read');
      expect(permissions).not.toContain('donations:create');
    });

    test('should return empty array for non-existent role', () => {
      const permissions = getPermissionsByRole('nonexistent');
      expect(permissions).toEqual([]);
    });
  });

  describe('Permission Constants', () => {
    test('should have all required permission constants', () => {
      expect(PERMISSIONS.DONATIONS_CREATE).toBe('donations:create');
      expect(PERMISSIONS.DONATIONS_READ).toBe('donations:read');
      expect(PERMISSIONS.WALLETS_CREATE).toBe('wallets:create');
      expect(PERMISSIONS.STREAM_CREATE).toBe('stream:create');
      expect(PERMISSIONS.STATS_READ).toBe('stats:read');
    });

    test('should have all role constants', () => {
      expect(ROLES.ADMIN).toBe('admin');
      expect(ROLES.USER).toBe('user');
      expect(ROLES.GUEST).toBe('guest');
    });
  });
});
