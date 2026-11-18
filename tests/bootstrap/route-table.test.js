'use strict';

/**
 * Route-table snapshot (#1780).
 *
 * Dumps the declared mount tables from src/bootstrap/routes.js and compares
 * them with the expected snapshot below. Any addition, removal or reordering
 * of a mount must update this file, so middleware-ordering changes show up
 * explicitly in review.
 */

const fs = require('fs');
const path = require('path');
const {
  V1_ROUTES,
  ADMIN_ROUTES,
  UNVERSIONED_PATHS,
  buildEndpointTable,
} = require('../../src/bootstrap/routes');

const dumpEndpoints = (endpoints) => endpoints.map(({ method, path: p }) => `${method.toUpperCase()} ${p}`);

describe('bootstrap route table snapshot (#1780)', () => {
  it('V1_ROUTES mount paths', () => {
    expect(V1_ROUTES.map(([p]) => p)).toEqual([
      '/fees',
      '/wallets',
      '/wallets',
      '/',
      '/donations',
      '/donations',
      '/donations',
      '/donations/recurring',
      '/assets',
      '/stats',
      '/stream',
      '/webhooks',
      '/pledges',
      '/campaigns',
      '/encryption',
      '/tiers',
      '/offers',
      '/orderbook/:baseAsset/:counterAsset',
      '/tags',
      '/leaderboard',
      '/tools',
      '/auth',
      '/docs',
      '/transactions',
      '/contracts',
      '/claimable-balances',
      '/liquidity-pools',
      '/channels',
      '/exchange-rates',
      '/exports',
      '/feature-flags',
    ]);
  });

  it('ADMIN_ROUTES mount paths', () => {
    expect(ADMIN_ROUTES.map(([p]) => p)).toEqual([
      '/admin/donations',
      '/admin/crowdfunding',
      '/admin/cors/rules',
      '/admin/db',
      '/admin/retention',
      '/admin/scheduler',
      '/admin/pledges',
      '/admin/disputes',
      '/admin/geo-rules',
      '/admin/payment-channels',
      '/admin/system-info',
      '/admin/feature-flags',
      '/admin',
      '/admin/backups',
      '/admin/audit-logs/export',
      '/admin/security/scan',
      '/admin/analytics',
      '/admin/api-keys',
      '/admin/circuit-breaker',
      '/admin/corporate-matching',
      '/admin/encryption',
      '/admin/geo-blocking',
      '/admin/impact-metrics',
      '/admin/sdg-mapping',
      '/admin/matching-programs',
      '/admin/reconciliation',
      '/admin/routing',
      '/admin/traces',
      '/admin',
      '/admin/wallets',
      '/admin/wallets/bulk-import',
      '/admin/webhooks',
      '/admin/inspect/xdr',
      '/admin/geo-blocking',
      '/admin/transactions',
    ]);
  });

  it('UNVERSIONED_PATHS', () => {
    expect(UNVERSIONED_PATHS).toEqual([
      '/wallets', '/donations', '/assets', '/stats', '/stream', '/network',
      '/webhooks', '/campaigns', '/pledges', '/encryption', '/tiers', '/offers', '/orderbook',
      '/tags', '/leaderboard', '/federation', '/tools', '/auth', '/docs',
      '/transactions', '/claimable-balances', '/liquidity-pools', '/exchange-rates',
      '/impact', '/feature-flags', '/channels',
    ]);
  });

  it('standalone endpoints with all optional services present', () => {
    const table = buildEndpointTable({
      reconciliationService: { reconcile: jest.fn(), getOrphanedTransactionCount: jest.fn() },
      transactionSyncScheduler: { syncAllWallets: jest.fn(), getSyncStatus: jest.fn() },
    });

    expect(dumpEndpoints(table.beforeAdminGuard)).toEqual([
      'GET /api/v1/health',
      'GET /health',
      'GET /health/live',
      'GET /api/v1/health/live',
      'GET /health/ready',
      'GET /api/v1/health/ready',
      'GET /abuse-signals',
      'GET /admin/blocked-ips',
      'DELETE /admin/blocked-ips/:ip',
      'GET /suspicious-patterns',
    ]);
    expect(dumpEndpoints(table.afterAdminGuard)).toEqual([
      'GET /admin/audit-logs',
      'POST /reconcile',
      'POST /admin/reconcile',
      'GET /admin/orphaned-transactions',
      'POST /admin/sync',
    ]);
  });

  it('omits reconciliation and sync endpoints when their services are absent', () => {
    const table = buildEndpointTable({});
    expect(dumpEndpoints(table.afterAdminGuard)).toEqual(['GET /admin/audit-logs']);
  });

  it('every admin-only standalone endpoint carries a guard', () => {
    const { beforeAdminGuard, afterAdminGuard } = buildEndpointTable({
      reconciliationService: {},
      transactionSyncScheduler: {},
    });
    const unguarded = [...beforeAdminGuard, ...afterAdminGuard]
      .filter(({ path: p }) => !p.includes('/health'))
      .filter(({ middleware }) => middleware.length === 0)
      .map(({ path: p }) => p);
    expect(unguarded).toEqual([]);
  });

  it('bootstrap has no inline business handlers or no-op handlers', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/bootstrap/routes.js'), 'utf8');
    expect(src).not.toMatch(/\(req, res, next\) => next\(\)/);
    expect(src).not.toMatch(/asyncHandler\(/);
    expect(src).not.toMatch(/app\.use\('\/admin\/totp',\s*requireApiKey/);
  });
});
