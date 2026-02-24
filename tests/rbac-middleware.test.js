const { checkPermission, checkAnyPermission, checkAllPermissions, requireAdmin, attachUserRole } = require('../src/middleware/rbacMiddleware');
const { PERMISSIONS, ROLES } = require('../src/utils/permissions');
const { UnauthorizedError, ForbiddenError } = require('../src/utils/errors');

describe('RBAC Middleware - Authorization Tests', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      headers: {},
      user: null
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    next = jest.fn();
  });

  describe('Single Permission Check', () => {
    test('should allow admin to access any permission', () => {
      req.user = { id: '1', role: ROLES.ADMIN };
      const middleware = checkPermission(PERMISSIONS.DONATIONS_CREATE);
      
      middleware(req, res, next);
      
      expect(next).toHaveBeenCalledWith();
    });

    test('should allow user with correct permission', () => {
      req.user = { id: '2', role: ROLES.USER };
      const middleware = checkPermission(PERMISSIONS.DONATIONS_CREATE);
      
      middleware(req, res, next);
      
      expect(next).toHaveBeenCalledWith();
    });

    test('should block user without permission', () => {
      req.user = { id: '2', role: ROLES.USER };
      const middleware = checkPermission(PERMISSIONS.WALLETS_DELETE);
      
      middleware(req, res, next);
      
      expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
    });

    test('should block unauthenticated requests', () => {
      req.user = null;
      const middleware = checkPermission(PERMISSIONS.DONATIONS_CREATE);
      
      middleware(req, res, next);
      
      expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    });

    test('should block guest from write operations', () => {
      req.user = { id: 'guest', role: ROLES.GUEST };
      const middleware = checkPermission(PERMISSIONS.DONATIONS_CREATE);
      
      middleware(req, res, next);
      
      expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
    });

    test('should allow guest to read', () => {
      req.user = { id: 'guest', role: ROLES.GUEST };
      const middleware = checkPermission(PERMISSIONS.DONATIONS_READ);
      
      middleware(req, res, next);
      
      expect(next).toHaveBeenCalledWith();
    });
  });

  describe('Any Permission Check', () => {
    test('should allow if user has any of the required permissions', () => {
      req.user = { id: '2', role: ROLES.USER };
      const middleware = checkAnyPermission([
        PERMISSIONS.DONATIONS_CREATE,
        PERMISSIONS.WALLETS_DELETE
      ]);
      
      middleware(req, res, next);
      
      expect(next).toHaveBeenCalledWith();
    });

    test('should block if user has none of the permissions', () => {
      req.user = { id: 'guest', role: ROLES.GUEST };
      const middleware = checkAnyPermission([
        PERMISSIONS.DONATIONS_CREATE,
        PERMISSIONS.WALLETS_DELETE
      ]);
      
      middleware(req, res, next);
      
      expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
    });

    test('should block unauthenticated requests', () => {
      req.user = null;
      const middleware = checkAnyPermission([PERMISSIONS.DONATIONS_READ]);
      
      middleware(req, res, next);
      
      expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    });
  });

  describe('All Permissions Check', () => {
    test('should allow if user has all required permissions', () => {
      req.user = { id: '2', role: ROLES.USER };
      const middleware = checkAllPermissions([
        PERMISSIONS.DONATIONS_CREATE,
        PERMISSIONS.DONATIONS_READ
      ]);
      
      middleware(req, res, next);
      
      expect(next).toHaveBeenCalledWith();
    });

    test('should block if user is missing any permission', () => {
      req.user = { id: '2', role: ROLES.USER };
      const middleware = checkAllPermissions([
        PERMISSIONS.DONATIONS_CREATE,
        PERMISSIONS.WALLETS_DELETE
      ]);
      
      middleware(req, res, next);
      
      expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
    });

    test('should allow admin with all permissions', () => {
      req.user = { id: '1', role: ROLES.ADMIN };
      const middleware = checkAllPermissions([
        PERMISSIONS.DONATIONS_CREATE,
        PERMISSIONS.WALLETS_DELETE,
        PERMISSIONS.STATS_ADMIN
      ]);
      
      middleware(req, res, next);
      
      expect(next).toHaveBeenCalledWith();
    });
  });

  describe('Admin Role Requirement', () => {
    test('should allow admin users to proceed', () => {
      req.user = { id: '1', role: ROLES.ADMIN };
      const middleware = requireAdmin();
      
      middleware(req, res, next);
      
      expect(next).toHaveBeenCalledWith();
    });

    test('should block non-admin users', () => {
      req.user = { id: '2', role: ROLES.USER };
      const middleware = requireAdmin();
      
      middleware(req, res, next);
      
      expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
    });

    test('should block unauthenticated requests', () => {
      req.user = null;
      const middleware = requireAdmin();
      
      middleware(req, res, next);
      
      expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    });
  });

  describe('User Role Attachment', () => {
    test('should attach admin role for admin API key', () => {
      req.headers['x-api-key'] = 'admin-key-123';
      const middleware = attachUserRole();
      
      middleware(req, res, next);
      
      expect(req.user).toBeDefined();
      expect(req.user.role).toBe(ROLES.ADMIN);
      expect(next).toHaveBeenCalledWith();
    });

    test('should attach user role for regular API key', () => {
      req.headers['x-api-key'] = 'user-key-456';
      const middleware = attachUserRole();
      
      middleware(req, res, next);
      
      expect(req.user).toBeDefined();
      expect(req.user.role).toBe(ROLES.USER);
      expect(next).toHaveBeenCalledWith();
    });

    test('should attach guest role for no API key', () => {
      const middleware = attachUserRole();
      
      middleware(req, res, next);
      
      expect(req.user).toBeDefined();
      expect(req.user.role).toBe(ROLES.GUEST);
      expect(next).toHaveBeenCalledWith();
    });
  });
});
