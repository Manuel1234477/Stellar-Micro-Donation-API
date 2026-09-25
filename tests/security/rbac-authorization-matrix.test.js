/**
 * RBAC Authorization Matrix Regression Test  (#1173)
 *
 * PURPOSE
 * ───────
 * Authoritative, data-driven proof that every protected route behaves correctly
 * for every role.  Two guarantees:
 *
 *   1. Regression guard — a permission change that accidentally widens or
 *      removes a check will immediately break this suite.
 *   2. Stale-entry sentinel — a MATRIX_ENTRIES row referencing a path that no
 *      longer exists in ROUTE_PERMISSIONS will fail the sentinel test.
 *   3. New-route sentinel — a route added to ROUTE_PERMISSIONS without a
 *      corresponding MATRIX_ENTRIES entry will fail the coverage test.
 *      No silently-unprotected routes.
 *
 * HOW IT WORKS
 * ────────────
 * For each entry in MATRIX_ENTRIES we fire one real HTTP request per role and
 * assert only on the HTTP status category (allowed vs 401/403 denied).  Business
 * logic (missing records → 404, bad payload → 422) is NOT checked here.
 *
 * EXTENDING THE MATRIX
 * ────────────────────
 * When you add a new protected route:
 *   1. Add a row to MATRIX_ENTRIES with the correct allowedRoles / deniedRoles.
 *   2. Also add it to ROUTE_PERMISSIONS in src/config/permissionMatrix.js.
 * The sentinel at the bottom will hard-fail for uncovered routes and for stale
 * entries (routes removed from ROUTE_PERMISSIONS but still in MATRIX_ENTRIES).
 */

'use strict';

const express = require('express');
const request = require('supertest');
const { attachUserRole, requireAdmin } = require('../../src/middleware/rbac');
const createTestTables = require('../helpers/dbBootstrap');
const Database = require('../../src/utils/database');

// ─── Permission / role sources ─────────────────────────────────────────────────
const { hasPermission } = require('../../src/models/permissions');
const { PERMISSION_MATRIX, ROUTE_PERMISSIONS, getFullRoutePath } = require('../../src/config/permissionMatrix');

/** Normalise a ROUTE_PERMISSIONS entry to the MATRIX_ENTRIES key format (params → '999'). */
function routeKey(route) {
  return `${route.method}:${getFullRoutePath(route).replace(/:\w+/g, '999')}`;
}

// ─── Test API keys (configured in tests/setup.js via process.env.API_KEYS) ────
//   'admin-test-key'  → role: admin  (starts with 'admin-' → admin role)
//   'test-key-1'      → role: user   (known legacy key)
//   no key / unknown  → role: guest  (attachUserRole default)
const API_KEYS = {
  admin: 'admin-test-key',
  user:  'test-key-1',
  // 'guest' and 'noauth' send no X-API-Key header
};

/** Status codes that mean auth middleware DENIED the request. */
const AUTH_DENIED = new Set([401, 403]);

/** True if the response passed the auth layer (any non-auth-denied status). */
function isAllowed(status) {
  return !AUTH_DENIED.has(status);
}

// ─── Build a self-contained test app ──────────────────────────────────────────
function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(attachUserRole());

  app.use('/api/v1/donations',    require('../../src/routes/donation'));
  app.use('/api/v1/wallets',      require('../../src/routes/wallet'));
  app.use('/api/v1/stats',        require('../../src/routes/stats'));
  app.use('/api/v1/stream',       require('../../src/routes/stream'));
  app.use('/api/v1/transactions', require('../../src/routes/transaction'));
  app.use('/api/v1/api-keys',     require('../../src/routes/apiKeys'));
  app.use('/admin/geo-blocking',  require('../../src/routes/admin/geoBlocking'));

  // /abuse-signals and /reconcile are registered inline in
  // src/bootstrap/routes.js behind rbac.requireAdmin(); mirror that guard here
  // with stub handlers so the matrix exercises the same authorization gate.
  app.get('/abuse-signals', requireAdmin(), (_req, res) => res.json({ success: true }));
  app.post('/reconcile', requireAdmin(), (_req, res) => res.json({ success: true }));

  // Unified error handler — propagates status from thrown errors
  app.use((err, _req, res, _next) => {
    res.status(err.status || err.statusCode || 500).json({
      success: false,
      error: { code: err.code || 'ERROR', message: err.message },
    });
  });

  return app;
}

// ─── Authorization Matrix ──────────────────────────────────────────────────────
/**
 * Matrix entries.
 *
 * Fields
 *   method        - HTTP verb
 *   path          - URL path (route params replaced with '999')
 *   permission    - Declared permission (for readability / docs)
 *   allowedRoles  - Roles that MUST receive a non-401/403 response
 *   deniedRoles   - Roles that MUST receive 401 or 403
 *
 * Roles: 'admin' | 'user' | 'guest' | 'noauth'
 * 'guest'  = sends the key 'test-key-guest-unknown' (not in legacy list → guest)
 * 'noauth' = sends no X-API-Key header                             → guest
 *
 * NOTE: guest role has donations:read and stats:read, so both guest and noauth
 * are ALLOWED on those read endpoints.  They are placed in allowedRoles there.
 * Entries with an empty deniedRoles are valid for genuinely public routes.
 */
const MATRIX_ENTRIES = [
  // ── Donation read routes (guest has donations:read → all roles allowed) ──────
  {
    method: 'GET',   path: '/api/v1/donations',
    permission: 'donations:read',
    allowedRoles: ['admin', 'user', 'guest', 'noauth'],
    deniedRoles:  [],
  },
  {
    method: 'GET',   path: '/api/v1/donations/limits',
    permission: 'donations:read',
    allowedRoles: ['admin', 'user', 'guest', 'noauth'],
    deniedRoles:  [],
  },
  {
    method: 'GET',   path: '/api/v1/donations/recent',
    permission: 'donations:read',
    allowedRoles: ['admin', 'user', 'guest', 'noauth'],
    deniedRoles:  [],
  },
  {
    method: 'GET',   path: '/api/v1/donations/999',
    permission: 'donations:read',
    allowedRoles: ['admin', 'user', 'guest', 'noauth'],
    deniedRoles:  [],
  },
  {
    method: 'GET',   path: '/api/v1/donations/stats/by-tag',
    permission: 'stats:read',
    allowedRoles: ['admin', 'user', 'guest', 'noauth'],
    deniedRoles:  [],
  },
  // ── Donation write routes (user+ only) ───────────────────────────────────────
  {
    method: 'POST',  path: '/api/v1/donations/send',
    permission: 'donations:create',
    allowedRoles: ['admin', 'user'],
    deniedRoles:  ['guest', 'noauth'],
  },
  {
    method: 'PATCH', path: '/api/v1/donations/999/status',
    permission: 'donations:update',
    allowedRoles: ['admin', 'user'],
    deniedRoles:  ['guest', 'noauth'],
  },
  {
    method: 'POST',  path: '/api/v1/donations/verify',
    permission: 'donations:verify',
    allowedRoles: ['admin', 'user', 'guest', 'noauth'],
    deniedRoles:  [],
  },
  // donations:approve (#1498) is only granted to admin and the dedicated
  // 'signer' role — 'user' has no signer permission and must be denied.
  {
    method: 'POST',  path: '/api/v1/donations/999/approve',
    permission: 'donations:approve',
    allowedRoles: ['admin'],
    deniedRoles:  ['user', 'guest', 'noauth'],
  },

  // ── Wallet routes ─────────────────────────────────────────────────────────────
  {
    method: 'GET',   path: '/api/v1/wallets',
    permission: 'wallets:read',
    allowedRoles: ['admin', 'user'],
    deniedRoles:  ['guest', 'noauth'],
  },
  {
    method: 'GET',   path: '/api/v1/wallets/999',
    permission: 'wallets:read',
    allowedRoles: ['admin', 'user'],
    deniedRoles:  ['guest', 'noauth'],
  },
  {
    method: 'GET',   path: '/api/v1/wallets/999/transactions',
    permission: 'wallets:read',
    allowedRoles: ['admin', 'user'],
    deniedRoles:  ['guest', 'noauth'],
  },
  {
    method: 'POST',  path: '/api/v1/wallets',
    permission: 'wallets:create',
    allowedRoles: ['admin', 'user'],
    deniedRoles:  ['guest', 'noauth'],
  },
  {
    method: 'PATCH', path: '/api/v1/wallets/999',
    permission: 'wallets:update',
    allowedRoles: ['admin', 'user'],
    deniedRoles:  ['guest', 'noauth'],
  },

  // ── Stream / recurring donations ──────────────────────────────────────────────
  {
    method: 'POST',   path: '/api/v1/stream/create',
    permission: 'stream:create',
    allowedRoles: ['admin', 'user'],
    deniedRoles:  ['guest', 'noauth'],
  },
  {
    method: 'GET',    path: '/api/v1/stream/schedules',
    permission: 'stream:read',
    allowedRoles: ['admin', 'user'],
    deniedRoles:  ['guest', 'noauth'],
  },
  {
    method: 'GET',    path: '/api/v1/stream/schedules/999',
    permission: 'stream:read',
    allowedRoles: ['admin', 'user'],
    deniedRoles:  ['guest', 'noauth'],
  },
  {
    method: 'DELETE', path: '/api/v1/stream/schedules/999',
    permission: 'stream:delete',
    allowedRoles: ['admin', 'user'],
    deniedRoles:  ['guest', 'noauth'],
  },

  // ── Stats routes (guest has stats:read → all roles including noauth allowed) ──
  {
    method: 'GET', path: '/api/v1/stats/daily',
    permission: 'stats:read',
    allowedRoles: ['admin', 'user', 'guest', 'noauth'],
    deniedRoles:  [],
  },
  {
    method: 'GET', path: '/api/v1/stats/weekly',
    permission: 'stats:read',
    allowedRoles: ['admin', 'user', 'guest', 'noauth'],
    deniedRoles:  [],
  },
  {
    method: 'GET', path: '/api/v1/stats/summary',
    permission: 'stats:read',
    allowedRoles: ['admin', 'user', 'guest', 'noauth'],
    deniedRoles:  [],
  },
  {
    method: 'GET', path: '/api/v1/stats/donors',
    permission: 'stats:read',
    allowedRoles: ['admin', 'user', 'guest', 'noauth'],
    deniedRoles:  [],
  },
  {
    method: 'GET', path: '/api/v1/stats/recipients',
    permission: 'stats:read',
    allowedRoles: ['admin', 'user', 'guest', 'noauth'],
    deniedRoles:  [],
  },
  {
    method: 'GET', path: '/api/v1/stats/analytics-fees',
    permission: 'stats:read',
    allowedRoles: ['admin', 'user', 'guest', 'noauth'],
    deniedRoles:  [],
  },
  {
    method: 'GET', path: '/api/v1/stats/wallet/999/analytics',
    permission: 'stats:read',
    allowedRoles: ['admin', 'user', 'guest', 'noauth'],
    deniedRoles:  [],
  },

  // ── Transaction routes ────────────────────────────────────────────────────────
  {
    method: 'GET',  path: '/api/v1/transactions',
    permission: 'transactions:read',
    allowedRoles: ['admin', 'user'],
    deniedRoles:  ['guest', 'noauth'],
  },
  {
    method: 'POST', path: '/api/v1/transactions/sync',
    permission: 'transactions:sync',
    allowedRoles: ['admin', 'user'],
    deniedRoles:  ['guest', 'noauth'],
  },

  // ── Admin-only routes ─────────────────────────────────────────────────────────
  {
    method: 'GET',  path: '/api/v1/api-keys',
    permission: '*',
    allowedRoles: ['admin'],
    deniedRoles:  ['user', 'guest', 'noauth'],
  },
  {
    method: 'POST', path: '/api/v1/api-keys',
    permission: '*',
    allowedRoles: ['admin'],
    deniedRoles:  ['user', 'guest', 'noauth'],
  },
  {
    method: 'POST', path: '/api/v1/api-keys/999/deprecate',
    permission: '*',
    allowedRoles: ['admin'],
    deniedRoles:  ['user', 'guest', 'noauth'],
  },
  {
    method: 'DELETE', path: '/api/v1/api-keys/999',
    permission: '*',
    allowedRoles: ['admin'],
    deniedRoles:  ['user', 'guest', 'noauth'],
  },
  {
    method: 'POST', path: '/api/v1/api-keys/cleanup',
    permission: '*',
    allowedRoles: ['admin'],
    deniedRoles:  ['user', 'guest', 'noauth'],
  },
  // ── Unversioned admin / observability routes ─────────────────────────────────
  ...[
    ['GET',    '/abuse-signals'],
    ['POST',   '/reconcile'],
    ['GET',    '/admin/geo-blocking'],
    ['PUT',    '/admin/geo-blocking'],
    ['POST',   '/admin/geo-blocking/reload-db'],
    ['GET',    '/admin/geo-blocking/rules'],
    ['POST',   '/admin/geo-blocking/block'],
    ['DELETE', '/admin/geo-blocking/block/999'],
    ['POST',   '/admin/geo-blocking/allow'],
    ['DELETE', '/admin/geo-blocking/allow/999'],
  ].map(([method, path]) => ({
    method, path,
    permission: '*',
    allowedRoles: ['admin'],
    deniedRoles:  ['user', 'guest', 'noauth'],
  })),
];

// ─── Pure-logic permission matrix tests ───────────────────────────────────────
describe('RBAC permission matrix — pure logic', () => {
  test('PERMISSION_MATRIX has admin, user, guest roles', () => {
    expect(PERMISSION_MATRIX).toHaveProperty('admin');
    expect(PERMISSION_MATRIX).toHaveProperty('user');
    expect(PERMISSION_MATRIX).toHaveProperty('guest');
  });

  test('admin has wildcard permission *', () => {
    expect(PERMISSION_MATRIX.admin.permissions).toContain('*');
    expect(hasPermission('admin', 'donations:create')).toBe(true);
    expect(hasPermission('admin', 'transactions:sync')).toBe(true);
    expect(hasPermission('admin', 'nonexistent:action')).toBe(true);
  });

  describe('user permissions', () => {
    const GRANTED = [
      'donations:create', 'donations:read', 'donations:verify', 'donations:update',
      'wallets:create', 'wallets:read', 'wallets:update',
      'stream:create', 'stream:read', 'stream:update', 'stream:delete',
      'stats:read',
      'transactions:read', 'transactions:sync',
    ];
    const DENIED = ['*', 'admin:*', 'donations:delete', 'wallets:delete', 'stats:admin'];
    test.each(GRANTED)('user CAN %s', (perm) => {
      expect(hasPermission('user', perm)).toBe(true);
    });
    test.each(DENIED)('user CANNOT %s', (perm) => {
      expect(hasPermission('user', perm)).toBe(false);
    });
  });

  describe('guest permissions', () => {
    const GRANTED = ['donations:read', 'stats:read'];
    const DENIED  = [
      'donations:create', 'donations:verify', 'donations:update', 'donations:delete',
      'wallets:create', 'wallets:read', 'wallets:update', 'wallets:delete',
      'stream:create', 'stream:read', 'stream:update', 'stream:delete',
      'transactions:read', 'transactions:sync', 'transactions:simulate',
      '*', 'admin:*',
    ];
    test.each(GRANTED)('guest CAN %s', (perm) => {
      expect(hasPermission('guest', perm)).toBe(true);
    });
    test.each(DENIED)('guest CANNOT %s', (perm) => {
      expect(hasPermission('guest', perm)).toBe(false);
    });
  });

  describe('unknown role returns empty permissions', () => {
    test('unrecognized role cannot *', () => { expect(hasPermission('nonexistent_role', '*')).toBe(false); });
    test('unrecognized role cannot donations:read', () => { expect(hasPermission('nonexistent_role', 'donations:read')).toBe(false); });
  });
});

// ─── HTTP authorization matrix ────────────────────────────────────────────────
describe('RBAC HTTP authorization matrix', () => {
  let app;

  beforeAll(async () => {
    // Ensure all required tables exist before running HTTP tests
    await createTestTables(Database);
    app = buildTestApp();
  });

  /**
   * Fire a single HTTP request.
   * 'noauth' and 'guest' send no X-API-Key (or an unknown key), triggering
   * the guest fallback path in attachUserRole().
   */
  async function fire(method, path, role) {
    let req = request(app)[method.toLowerCase()](path);

    if (role === 'admin')  req = req.set('X-API-Key', API_KEYS.admin);
    if (role === 'user')   req = req.set('X-API-Key', API_KEYS.user);
    // guest / noauth: no key → resolves to guest role

    if (['post', 'patch', 'put'].includes(method.toLowerCase())) {
      req = req.set('Content-Type', 'application/json').send({});
    }
    return req;
  }

  for (const entry of MATRIX_ENTRIES) {
    const { method, path: routePath, permission, allowedRoles, deniedRoles } = entry;

    describe(`${method} ${routePath}  [requires: ${permission}]`, () => {
      for (const role of allowedRoles) {
        test(`ALLOW — role: ${role}`, async () => {
          const res = await fire(method, routePath, role);
          expect(isAllowed(res.status)).toBe(true);
        }, 10000);
      }

      for (const role of deniedRoles) {
        test(`DENY  — role: ${role}`, async () => {
          const res = await fire(method, routePath, role);
          expect(AUTH_DENIED.has(res.status)).toBe(true);
        }, 10000);
      }
    });
  }
});

// ─── Matrix coverage sentinel ─────────────────────────────────────────────────
describe('RBAC matrix coverage sentinel', () => {
  test('every MATRIX_ENTRIES entry has at least one allowedRole', () => {
    const noAllowed = MATRIX_ENTRIES.filter(e => !e.allowedRoles.length);
    expect(noAllowed).toHaveLength(0);
  });

  test('no MATRIX_ENTRIES reference a path removed from ROUTE_PERMISSIONS (stale-entry guard)', () => {
    const knownKeys = new Set([
      ...ROUTE_PERMISSIONS.map(routeKey),
      // api-key routes are registered inline in routes.js, not ROUTE_PERMISSIONS
      'GET:/api/v1/api-keys',
      'POST:/api/v1/api-keys',
      'POST:/api/v1/api-keys/999/deprecate',
      'DELETE:/api/v1/api-keys/999',
      'POST:/api/v1/api-keys/cleanup',
    ]);

    const stale = MATRIX_ENTRIES.filter(e => !knownKeys.has(`${e.method}:${e.path}`));

    if (stale.length) {
      const lines = stale.map(e => `  ${e.method} ${e.path}`).join('\n');
      throw new Error(
        `MATRIX_ENTRIES reference routes not found in ROUTE_PERMISSIONS:\n${lines}\n` +
        'Either the route was removed or the path in MATRIX_ENTRIES is wrong. ' +
        'Update MATRIX_ENTRIES in tests/security/rbac-authorization-matrix.test.js.'
      );
    }
    expect(stale).toHaveLength(0);
  });

  test('every route in ROUTE_PERMISSIONS is covered by MATRIX_ENTRIES (new-route guard)', () => {
    const covered = new Set(MATRIX_ENTRIES.map(e => `${e.method}:${e.path}`));

    const declaredRoutes = new Set(ROUTE_PERMISSIONS.map(routeKey));

    const knownInline = new Set([
      'GET:/api/v1/api-keys',
      'POST:/api/v1/api-keys',
      'POST:/api/v1/api-keys/999/deprecate',
      'DELETE:/api/v1/api-keys/999',
      'POST:/api/v1/api-keys/cleanup',
    ]);

    const uncovered = [];
    for (const routeKey of declaredRoutes) {
      if (!covered.has(routeKey)) {
        uncovered.push(routeKey);
      }
    }
    for (const routeKey of knownInline) {
      if (!covered.has(routeKey)) {
        uncovered.push(routeKey);
      }
    }

    if (uncovered.length) {
      const lines = uncovered.map(k => `  ${k}`).join('\n');
      throw new Error(
        `Routes in ROUTE_PERMISSIONS not yet covered by MATRIX_ENTRIES:\n${lines}\n` +
        'Add entries to MATRIX_ENTRIES in tests/security/rbac-authorization-matrix.test.js ' +
        'with the correct allowedRoles/deniedRoles. Every protected route must be in the matrix.'
      );
    }
    expect(uncovered).toHaveLength(0);
  });
});

// ─── Scope validator regression ───────────────────────────────────────────────
describe('Scope validator regression', () => {
  const { hasScope, hasAllScopes, hasAnyScope, ALL_SCOPES } = require('../../src/utils/scopeValidator');

  test('ALL_SCOPES is non-empty and contains canonical entries', () => {
    expect(ALL_SCOPES.length).toBeGreaterThan(10);
    expect(ALL_SCOPES).toContain('donations:create');
    expect(ALL_SCOPES).toContain('wallets:read');
    expect(ALL_SCOPES).toContain('admin:*');
  });

  test('admin:* grants every individual scope', () => {
    for (const scope of ALL_SCOPES) {
      expect(hasScope(['admin:*'], scope)).toBe(true);
    }
  });

  test('donations:* grants all donation sub-scopes', () => {
    const donationScopes = ALL_SCOPES.filter(s => s.startsWith('donations:'));
    expect(donationScopes.length).toBeGreaterThan(0);
    for (const s of donationScopes) {
      expect(hasScope(['donations:*'], s)).toBe(true);
    }
  });

  test('resource wildcard does NOT bleed into other resources', () => {
    expect(hasScope(['donations:*'], 'wallets:read')).toBe(false);
    expect(hasScope(['wallets:*'],   'stats:read')).toBe(false);
  });

  test('hasAllScopes fails when any required scope is missing', () => {
    expect(hasAllScopes(['donations:read'], ['donations:read', 'wallets:read'])).toBe(false);
  });

  test('hasAllScopes succeeds when all required scopes are present', () => {
    expect(hasAllScopes(
      ['donations:read', 'wallets:read', 'stats:read'],
      ['donations:read', 'stats:read']
    )).toBe(true);
  });

  test('hasAnyScope succeeds when at least one scope matches', () => {
    expect(hasAnyScope(['donations:read'], ['donations:read', 'wallets:read'])).toBe(true);
  });

  test('hasAnyScope fails when no scopes match', () => {
    expect(hasAnyScope(['donations:read'], ['wallets:read', 'stream:create'])).toBe(false);
  });

  test('empty key-scopes returns false from raw hasScope (role check is the gate)', () => {
    expect(hasScope([], 'donations:read')).toBe(false);
  });

  test('null/undefined scopes are handled gracefully', () => {
    expect(hasScope(null, 'donations:read')).toBe(false);
    expect(hasScope(undefined, 'donations:read')).toBe(false);
    expect(hasScope(['donations:read'], null)).toBe(false);
    expect(hasScope(['donations:read'], undefined)).toBe(false);
  });
});

// ─── Combined role + scope access control tests ───────────────────────────────
describe('Combined role + scope access control', () => {
  const { hasScope, hasAllScopes, hasAnyScope } = require('../../src/utils/scopeValidator');
  const { hasPermission } = require('../../src/models/permissions');

  /**
   * Simulate the dual-check that rbac.js uses for each request:
   *   roleHasPermission = hasPermission(userRole, requiredPermission)
   *   scopeHasPermission = hasScope(keyScopes, requiredPermission) [if scopes exist]
   *   hasAccess = roleHasPermission && scopeHasPermission
   */
  function isAccessAllowed(userRole, keyScopes, requiredPermission) {
    const roleOk = hasPermission(userRole, requiredPermission);
    if (keyScopes && Array.isArray(keyScopes) && keyScopes.length > 0) {
      return roleOk && hasScope(keyScopes, requiredPermission);
    }
    return roleOk;
  }

  // ── admin role — role grants '*', but narrowed key scopes still apply ────────
  // Decision (#1694, docs/PERMISSIONS.md): an admin key issued with explicit
  // scopes is restricted to those scopes (least privilege). Only an admin key
  // with no scopes (or with admin:*) gets unrestricted access.
  describe('admin role', () => {
    test('admin with no scopes can access everything', () => {
      expect(isAccessAllowed('admin', [], 'donations:create')).toBe(true);
      expect(isAccessAllowed('admin', [], 'wallets:read')).toBe(true);
      expect(isAccessAllowed('admin', [], 'admin:*')).toBe(true);
    });

    test('admin with admin:* scope can access everything', () => {
      expect(isAccessAllowed('admin', ['admin:*'], 'wallets:create')).toBe(true);
      expect(isAccessAllowed('admin', ['admin:*'], 'transactions:sync')).toBe(true);
    });

    test('admin with limited scopes is restricted to those scopes (scopes narrow the admin wildcard)', () => {
      expect(isAccessAllowed('admin', ['donations:read'], 'donations:read')).toBe(true);
      expect(isAccessAllowed('admin', ['donations:read'], 'wallets:create')).toBe(false);
      expect(isAccessAllowed('admin', ['donations:read'], 'transactions:sync')).toBe(false);
    });
  });

  // ── user role — scope-limited cases ─────────────────────────────────────────
  describe('user role with scopes', () => {
    test('user with no scopes (legacy key): role check is the only gate', () => {
      expect(isAccessAllowed('user', [], 'donations:create')).toBe(true);
      expect(isAccessAllowed('user', [], 'wallets:read')).toBe(true);
    });

    test('user with matching scopes: access granted', () => {
      expect(isAccessAllowed('user', ['donations:create'], 'donations:create')).toBe(true);
      expect(isAccessAllowed('user', ['wallets:read', 'stats:read'], 'stats:read')).toBe(true);
    });

    test('user with insufficient scopes: access denied (scope-insufficient case)', () => {
      expect(isAccessAllowed('user', ['donations:read'], 'donations:create')).toBe(false);
      expect(isAccessAllowed('user', ['donations:read'], 'wallets:create')).toBe(false);
      expect(isAccessAllowed('user', ['stats:read'], 'transactions:read')).toBe(false);
    });

    test('user with wildcard resource scope: all sub-actions the role holds are permitted', () => {
      expect(isAccessAllowed('user', ['donations:*'], 'donations:create')).toBe(true);
      expect(isAccessAllowed('user', ['donations:*'], 'donations:read')).toBe(true);
      expect(isAccessAllowed('user', ['donations:*'], 'donations:update')).toBe(true);
    });

    test('user with wildcard resource scope cannot exceed role permissions', () => {
      // The user role does not hold donations:delete; a scope never widens a role.
      expect(isAccessAllowed('user', ['donations:*'], 'donations:delete')).toBe(false);
    });

    test('user with resource wildcard denied for other resources', () => {
      expect(isAccessAllowed('user', ['donations:*'], 'wallets:create')).toBe(false);
      expect(isAccessAllowed('user', ['donations:*'], 'stats:read')).toBe(false);
    });

    test('user with narrowed scopes cannot access broader actions', () => {
      expect(isAccessAllowed('user', ['donations:read'], 'donations:read')).toBe(true);
      expect(isAccessAllowed('user', ['donations:read'], 'donations:verify')).toBe(false);
    });
  });

  // ── guest role — very limited ───────────────────────────────────────────────
  describe('guest role with scopes', () => {
    test('guest even with scopes cannot exceed role permissions', () => {
      expect(isAccessAllowed('guest', ['wallets:read'], 'wallets:read')).toBe(false);
    });

    test('guest with valid read scopes: access granted', () => {
      expect(isAccessAllowed('guest', ['donations:read'], 'donations:read')).toBe(true);
      expect(isAccessAllowed('guest', ['stats:read'], 'stats:read')).toBe(true);
    });
  });

  describe('hasAllScopes / hasAnyScope combined with roles', () => {
    test('user with full scope set satisfies hasAllScopes', () => {
      const scopes = ['donations:create', 'donations:read', 'wallets:read', 'stats:read'];
      expect(hasAllScopes(scopes, ['donations:read', 'stats:read'])).toBe(true);
    });

    test('user with partial scopes fails hasAllScopes', () => {
      expect(hasAllScopes(['donations:read'], ['donations:read', 'wallets:read'])).toBe(false);
    });

    test('user with OR scopes satisfies hasAnyScope', () => {
      expect(hasAnyScope(['donations:read'], ['donations:create', 'donations:read'])).toBe(true);
    });
  });
});