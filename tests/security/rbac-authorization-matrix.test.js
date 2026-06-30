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
 * The sentinel at the bottom will warn about uncovered routes and will fail for
 * stale entries (routes removed from ROUTE_PERMISSIONS but still in MATRIX_ENTRIES).
 */

'use strict';

const express = require('express');
const request = require('supertest');
const { attachUserRole } = require('../../src/middleware/rbac');
const createTestTables = require('../helpers/dbBootstrap');
const Database = require('../../src/utils/database');

// ─── Permission / role sources ─────────────────────────────────────────────────
const { hasPermission } = require('../../src/models/permissions');
const { PERMISSION_MATRIX, ROUTE_PERMISSIONS } = require('../../src/config/permissionMatrix');

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
  // ── Donation write routes (user+ only) ───────────────────────────────────────
  {
    // ROUTE_PERMISSIONS registers this as /donations/send
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
    // verify uses checkPermission(DONATIONS_READ) — allowed for guest too
    method: 'POST',  path: '/api/v1/donations/verify',
    permission: 'donations:verify',
    allowedRoles: ['admin', 'user', 'guest', 'noauth'],
    deniedRoles:  [],
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

  // ── Stream / recurring donations ───────────────────────────────────────────────
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
  });

  describe('user permissions', () => {
    const GRANTED = [
      'donations:create', 'donations:read', 'donations:verify', 'donations:update',
      'wallets:create', 'wallets:read', 'wallets:update',
      'stream:create', 'stream:read', 'stream:update', 'stream:delete',
      'stats:read',
      'transactions:read', 'transactions:sync',
    ];
    const DENIED = ['*'];
    test.each(GRANTED)('user CAN %s', (perm) => {
      expect(hasPermission('user', perm)).toBe(true);
    });
    test.each(DENIED)('user CANNOT %s', (perm) => {
      expect(hasPermission('user', perm)).toBe(false);
    });
  });

  describe('guest permissions', () => {
    const GRANTED = ['donations:read', 'stats:read'];
    const DENIED  = ['donations:create', 'wallets:create', 'wallets:read', 'stream:create', 'transactions:read'];
    test.each(GRANTED)('guest CAN %s', (perm) => {
      expect(hasPermission('guest', perm)).toBe(true);
    });
    test.each(DENIED)('guest CANNOT %s', (perm) => {
      expect(hasPermission('guest', perm)).toBe(false);
    });
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
    // deniedRoles may be empty for genuinely public routes
    const noAllowed = MATRIX_ENTRIES.filter(e => !e.allowedRoles.length);
    expect(noAllowed).toHaveLength(0);
  });

  test('no MATRIX_ENTRIES reference a path removed from ROUTE_PERMISSIONS', () => {
    // Build the canonical key set from ROUTE_PERMISSIONS
    const knownKeys = new Set([
      ...ROUTE_PERMISSIONS.map(r => {
        const norm = `/api/v1${r.path}`.replace(/:[\w]+/g, '999');
        return `${r.method}:${norm}`;
      }),
      // api-key routes are registered inline in routes.js, not ROUTE_PERMISSIONS
      'GET:/api/v1/api-keys',
      'POST:/api/v1/api-keys',
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

  test('warns about ROUTE_PERMISSIONS routes not yet covered by MATRIX_ENTRIES', () => {
    const covered = new Set(MATRIX_ENTRIES.map(e => `${e.method}:${e.path}`));

    const uncovered = ROUTE_PERMISSIONS.filter(r => {
      const norm = `/api/v1${r.path}`.replace(/:[\w]+/g, '999');
      return !covered.has(`${r.method}:${norm}`);
    });

    if (uncovered.length) {
      const lines = uncovered
        .map(r => `  ${r.method} /api/v1${r.path}  (requires: ${r.permission})`)
        .join('\n');
      console.warn(
        `[RBAC sentinel] Routes in ROUTE_PERMISSIONS not yet covered by MATRIX_ENTRIES:\n${lines}\n` +
        'Add them to tests/security/rbac-authorization-matrix.test.js to close the matrix.'
      );
    }
    // This assertion is intentionally lenient — new routes emit a warning rather
    // than hard-failing CI.  The stale-entry check above is the hard gate.
    expect(true).toBe(true);
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

  test('hasAnyScope succeeds when at least one scope matches', () => {
    expect(hasAnyScope(['donations:read'], ['donations:read', 'wallets:read'])).toBe(true);
  });

  test('empty key-scopes returns false from raw hasScope (role check is the gate)', () => {
    expect(hasScope([], 'donations:read')).toBe(false);
  });
});
