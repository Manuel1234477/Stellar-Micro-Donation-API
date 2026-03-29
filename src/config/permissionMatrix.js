const { PERMISSIONS } = require('../utils/permissions');

/**
 * Subscription Tier Feature Matrix
 *
 * Defines which features are available at each subscription tier.
 * Tiers are ordered: free < basic < pro < enterprise
 */
const TIER_ORDER = ['free', 'basic', 'pro', 'enterprise'];

const TIER_FEATURES = {
  free: {
    label: 'Free',
    features: ['donations:create', 'donations:read', 'wallets:read', 'stats:read'],
    limits: { donationsPerDay: 10, wallets: 5, exportFormats: [] },
    description: 'Basic donation functionality',
  },
  basic: {
    label: 'Basic',
    features: ['donations:create', 'donations:read', 'wallets:read', 'wallets:create', 'stats:read', 'transactions:read'],
    limits: { donationsPerDay: 100, wallets: 20, exportFormats: ['json'] },
    description: 'Standard features for small organizations',
  },
  pro: {
    label: 'Pro',
    features: [
      'donations:create', 'donations:read', 'wallets:read', 'wallets:create',
      'stats:read', 'transactions:read', 'advanced_analytics', 'export',
    ],
    limits: { donationsPerDay: 1000, wallets: 200, exportFormats: ['json', 'csv'] },
    description: 'Advanced analytics and export for growing organizations',
  },
  enterprise: {
    label: 'Enterprise',
    features: [
      'donations:create', 'donations:read', 'wallets:read', 'wallets:create',
      'stats:read', 'transactions:read', 'advanced_analytics', 'export', 'bulk_import',
    ],
    limits: { donationsPerDay: -1, wallets: -1, exportFormats: ['json', 'csv'] },
    description: 'Unlimited access including bulk import',
  },
};

/**
 * Check whether a given tier meets the minimum required tier.
 *
 * @param {string} keyTier - The API key's current tier
 * @param {string} minTier - The minimum required tier
 * @returns {boolean}
 */
function tierMeetsMinimum(keyTier, minTier) {
  const keyIdx = TIER_ORDER.indexOf(keyTier || 'free');
  const minIdx = TIER_ORDER.indexOf(minTier || 'free');
  if (keyIdx === -1 || minIdx === -1) return false;
  return keyIdx >= minIdx;
}

/**
 * Permission Matrix - Defines which permissions each role should have
 * This is the source of truth for RBAC configuration
 */
const PERMISSION_MATRIX = {
  admin: {
    permissions: ['*'],
    description: 'Full system access'
  },
  user: {
    permissions: [
      PERMISSIONS.DONATIONS_CREATE,
      PERMISSIONS.DONATIONS_READ,
      PERMISSIONS.DONATIONS_VERIFY,
      PERMISSIONS.DONATIONS_UPDATE,
      PERMISSIONS.WALLETS_CREATE,
      PERMISSIONS.WALLETS_READ,
      PERMISSIONS.WALLETS_UPDATE,
      PERMISSIONS.STREAM_CREATE,
      PERMISSIONS.STREAM_READ,
      PERMISSIONS.STREAM_UPDATE,
      PERMISSIONS.STREAM_DELETE,
      PERMISSIONS.STATS_READ,
      PERMISSIONS.TRANSACTIONS_READ,
      PERMISSIONS.TRANSACTIONS_SYNC
    ],
    description: 'Standard user with donation and wallet management'
  },
  guest: {
    permissions: [
      PERMISSIONS.DONATIONS_READ,
      PERMISSIONS.STATS_READ
    ],
    description: 'Read-only access to public data'
  }
};

/**
 * Route Permission Requirements - Maps routes to required permissions
 * Format: { method: 'GET|POST|PATCH|DELETE', path: '/path', permission: 'permission:action' }
 */
const ROUTE_PERMISSIONS = [
  // Donation routes
  { method: 'POST', path: '/donations/verify', permission: PERMISSIONS.DONATIONS_VERIFY },
  { method: 'POST', path: '/donations/send', permission: PERMISSIONS.DONATIONS_CREATE },
  { method: 'GET', path: '/donations', permission: PERMISSIONS.DONATIONS_READ },
  { method: 'GET', path: '/donations/limits', permission: PERMISSIONS.DONATIONS_READ },
  { method: 'GET', path: '/donations/recent', permission: PERMISSIONS.DONATIONS_READ },
  { method: 'GET', path: '/donations/:id', permission: PERMISSIONS.DONATIONS_READ },
  { method: 'PATCH', path: '/donations/:id/status', permission: PERMISSIONS.DONATIONS_UPDATE },

  // Wallet routes
  { method: 'POST', path: '/wallets', permission: PERMISSIONS.WALLETS_CREATE },
  { method: 'GET', path: '/wallets', permission: PERMISSIONS.WALLETS_READ },
  { method: 'GET', path: '/wallets/:id', permission: PERMISSIONS.WALLETS_READ },
  { method: 'GET', path: '/wallets/:publicKey/transactions', permission: PERMISSIONS.WALLETS_READ },
  { method: 'PATCH', path: '/wallets/:id', permission: PERMISSIONS.WALLETS_UPDATE },

  // Stream (recurring donations) routes
  { method: 'POST', path: '/stream/create', permission: PERMISSIONS.STREAM_CREATE },
  { method: 'GET', path: '/stream/schedules', permission: PERMISSIONS.STREAM_READ },
  { method: 'GET', path: '/stream/schedules/:id', permission: PERMISSIONS.STREAM_READ },
  { method: 'DELETE', path: '/stream/schedules/:id', permission: PERMISSIONS.STREAM_DELETE },

  // Stats routes
  { method: 'GET', path: '/stats/daily', permission: PERMISSIONS.STATS_READ },
  { method: 'GET', path: '/stats/weekly', permission: PERMISSIONS.STATS_READ },
  { method: 'GET', path: '/stats/summary', permission: PERMISSIONS.STATS_READ },
  { method: 'GET', path: '/stats/donors', permission: PERMISSIONS.STATS_READ },
  { method: 'GET', path: '/stats/recipients', permission: PERMISSIONS.STATS_READ },
  { method: 'GET', path: '/stats/analytics-fees', permission: PERMISSIONS.STATS_READ },
  { method: 'GET', path: '/stats/wallet/:walletAddress/analytics', permission: PERMISSIONS.STATS_READ },

  // Transaction routes
  { method: 'GET', path: '/transactions', permission: PERMISSIONS.TRANSACTIONS_READ },
  { method: 'POST', path: '/transactions/sync', permission: PERMISSIONS.TRANSACTIONS_SYNC },

  // Admin-only routes
  { method: 'POST', path: '/api-keys', permission: PERMISSIONS.ADMIN_ALL },
  { method: 'GET', path: '/api-keys', permission: PERMISSIONS.ADMIN_ALL },
  { method: 'POST', path: '/api-keys/:id/deprecate', permission: PERMISSIONS.ADMIN_ALL },
  { method: 'DELETE', path: '/api-keys/:id', permission: PERMISSIONS.ADMIN_ALL },
  { method: 'POST', path: '/api-keys/cleanup', permission: PERMISSIONS.ADMIN_ALL },
  { method: 'GET', path: '/abuse-signals', permission: PERMISSIONS.ADMIN_ALL },
  { method: 'POST', path: '/reconcile', permission: PERMISSIONS.ADMIN_ALL },
  { method: 'GET', path: '/geo-blocking', permission: PERMISSIONS.ADMIN_ALL },
  { method: 'PUT', path: '/geo-blocking', permission: PERMISSIONS.ADMIN_ALL },
  { method: 'POST', path: '/geo-blocking/reload-db', permission: PERMISSIONS.ADMIN_ALL },
  { method: 'GET', path: '/geo/rules', permission: PERMISSIONS.ADMIN_ALL },
  { method: 'POST', path: '/geo/block', permission: PERMISSIONS.ADMIN_ALL },
  { method: 'DELETE', path: '/geo/block/:countryCode', permission: PERMISSIONS.ADMIN_ALL },
  { method: 'POST', path: '/geo/allow', permission: PERMISSIONS.ADMIN_ALL },
  { method: 'DELETE', path: '/geo/allow/:countryCode', permission: PERMISSIONS.ADMIN_ALL }
];

module.exports = {
  PERMISSION_MATRIX,
  ROUTE_PERMISSIONS,
  TIER_FEATURES,
  TIER_ORDER,
  tierMeetsMinimum,
};
