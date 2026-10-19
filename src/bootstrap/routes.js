/**
 * Route mounting bootstrap.
 * Table-driven registration of all API and admin routes.
 * Global middleware lives in middleware.js; only mount-level guards are
 * applied here. Handlers live in route modules, never inline.
 *
 * V1_ROUTES, ADMIN_ROUTES, UNVERSIONED_PATHS and buildEndpointTable() are the
 * canonical source of truth for what paths exist; a snapshot test
 * (tests/bootstrap/route-table.test.js) diffs them to catch accidental
 * additions / deletions.
 */

'use strict';

const express = require('express');
const { clientErrorMessage } = require('../utils/clientErrorMessage');
const asyncHandler = require('../utils/asyncHandler');
const log = require('../utils/log');
const requireApiKey = require('../middleware/apiKey');
const rbac = require('../middleware/rbac');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../middleware/payloadSizeLimiter');
const { healthCheckRateLimiter } = require('../middleware/rateLimiter');
const { errorHandler, notFoundHandler } = require('../middleware/errorHandler');
const { registerMethod, clearRegistry, assertNoDuplicateRoutes } = require('../middleware/methodRegistry');
const { optionsHandler, methodNotAllowedHandler } = require('../middleware/methodNotAllowedHandler');
const { createHealthHandlers } = require('../routes/health');
const operations = require('../routes/operations');

// ── Versioned API v1 routes ────────────────────────────────────────────────────
const V1_ROUTES = [
  ['/fees',                           require('../routes/fees')],
  ['/wallets',                        require('../routes/wallets')],
  ['/wallets',                        require('../routes/signers').thresholdsRouter],
  ['/',                               require('../routes/recovery')],
  ['/donations',                      require('../routes/donations')],
  ['/donations',                      require('../routes/receipt')],
  ['/donations',                      require('../routes/disputes')],
  ['/donations/recurring',            require('../routes/recurringDonation')],
  ['/assets',                         require('../routes/assets')],
  ['/stats',                          require('../routes/stats')],
  ['/stream',                         require('../routes/stream')],
  ['/webhooks',                       require('../routes/webhooks')],
  ['/pledges',                        require('../routes/pledges')],
  ['/campaigns',                      require('../routes/campaigns')],
  ['/encryption',                     require('../routes/encryption')],
  ['/tiers',                          require('../routes/tiers')],
  ['/offers',                         require('../routes/offers')],
  ['/orderbook/:baseAsset/:counterAsset', require('../routes/orderbook')],
  ['/tags',                           require('../routes/tags')],
  ['/leaderboard',                    require('../routes/leaderboard')],
  ['/tools',                          require('../routes/tools')],
  ['/auth',                           require('../routes/auth')],
  ['/docs',                           require('../routes/docs')],
  ['/transactions',                   require('../routes/transactions')],
  ['/contracts',                      require('../routes/contracts')],
  ['/claimable-balances',             require('../routes/claimableBalances')],
  ['/liquidity-pools',                require('../routes/liquidity-pools')],
  ['/channels',                       require('../routes/channels')],
  ['/exchange-rates',                 require('../routes/exchangeRates')],
  // Donation and entity export endpoints (#1596)
  ['/exports',                        require('../routes/exports')],
  // Read-only client view of flags; management lives only in /admin/feature-flags (#1775)
  ['/feature-flags',                  require('../routes/feature-flags')],
];

// ── Admin routes ──────────────────────────────────────────────────────────────
const ADMIN_ROUTES = [
  ['/admin/donations',              require('../routes/admin/donations')],
  ['/admin/crowdfunding',             require('../routes/admin/crowdfunding')],
  ['/admin/cors/rules',               require('../routes/admin/corsRules')],
  ['/admin/db',                       require('../routes/admin/db')],
  ['/admin/retention',                require('../routes/admin/retention')],
  ['/admin/scheduler',                require('../routes/admin/scheduler')],
  ['/admin/pledges',                  require('../routes/admin/pledges')],
  ['/admin/disputes',                 require('../routes/disputes')],
  ['/admin/geo-rules',                require('../routes/admin/geoRules')],
  ['/admin/payment-channels',         require('../routes/admin/paymentChannels')],
  ['/admin/system-info',              require('../routes/admin/systemInfo')],
  ['/admin/feature-flags',            require('../routes/admin/featureFlags')],
  ['/admin',                          require('../routes/admin')],
  ['/admin/backups',                  require('../routes/admin/backup')],
  ['/admin/audit-logs/export',        require('../routes/auditLogExport').adminRouter],
  ['/admin/security/scan',            require('../routes/admin/securityScan')],
  ['/admin/analytics',                require('../routes/admin/analytics')],
  ['/admin/api-keys',                 require('../routes/apiKeyUsage').adminRouter],
  ['/admin/circuit-breaker',          require('../routes/admin/circuitBreaker')],
  ['/admin/corporate-matching',       require('../routes/corporateMatching').adminRouter],
  ['/admin/encryption',               require('../routes/admin/encryption')],
  ['/admin/impact-metrics',           require('../routes/admin/impactMetrics')],
  ['/admin/sdg-mapping',              require('../routes/admin/impactMetrics')],
  ['/admin/matching-programs',        require('../routes/admin/matchingPrograms')],
  ['/admin/reconciliation',           require('../routes/admin/reconciliation')],
  ['/admin/routing',                  require('../routes/admin/routing')],
  ['/admin/traces',                   require('../routes/admin/traces')],
  ['/admin',                          require('../routes/admin/startupReport')],
  ['/admin/wallets',                  require('../routes/admin/walletLimits')],
  ['/admin/wallets/bulk-import',        require('../routes/admin/bulkWalletImport')],
  ['/admin/webhooks',                 require('../routes/admin/webhooks')],
  ['/admin/inspect/xdr',              require('../routes/admin/inspect')],

  // ── Deprecated aliases kept for one release after route consolidation (#1778).
  // Same handlers as the canonical routes; responses carry Deprecation, Sunset
  // and Link headers. Remove after the sunset date (1 Jan 2027).
  ['/admin/geo-blocking',             require('../routes/admin/geoRules').deprecatedRouter],
  ['/admin/transactions',             require('../routes/admin/inspect').deprecatedRouter],
];

// Unversioned paths that redirect to /api/v1 (Issue #738)
const UNVERSIONED_PATHS = [
  '/wallets', '/donations', '/assets', '/stats', '/stream', '/network',
  '/webhooks', '/campaigns', '/pledges', '/encryption', '/tiers', '/offers', '/orderbook',
  '/tags', '/leaderboard', '/federation', '/tools', '/auth', '/docs',
  '/transactions', '/claimable-balances', '/liquidity-pools', '/exchange-rates',
  '/impact', '/feature-flags',
  // Payment channels were introduced as an unversioned API (Issue #1803);
  // the legacy path now goes through the same deprecation treatment.
  '/channels',
];

// Sunset date for all unversioned legacy paths (Issue #1802).
const LEGACY_SUNSET = 'Sat, 01 Jan 2027 00:00:00 GMT';

// In-memory counter of legacy-path hits, keyed by API key id ('anonymous' when
// unauthenticated). Exposed for metrics scrapers / tests via getLegacyPathMetrics().
const legacyPathUsage = new Map();

/**
 * Record a hit on a legacy (unversioned) path for metrics.
 *
 * @param {string} apiKeyId
 * @param {string} path
 */
function recordLegacyPathUsage(apiKeyId, path) {
  const key = apiKeyId || 'anonymous';
  const entry = legacyPathUsage.get(key) || { count: 0, paths: new Map() };
  entry.count += 1;
  entry.paths.set(path, (entry.paths.get(path) || 0) + 1);
  legacyPathUsage.set(key, entry);
}

/**
 * Snapshot of legacy-path usage, keyed by API key id.
 *
 * @returns {Object<string, {count: number, paths: Object<string, number>}>}
 */
function getLegacyPathMetrics() {
  const snapshot = {};
  for (const [key, entry] of legacyPathUsage.entries()) {
    snapshot[key] = { count: entry.count, paths: Object.fromEntries(entry.paths) };
  }
  return snapshot;
}

/**
 * Shared 308 redirect handler for unversioned legacy paths.
 * Sets Deprecation / Sunset / Link headers, records usage metrics and logs a
 * warning before redirecting to the versioned equivalent.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
function legacyRedirect(req, res) {
  const apiKeyId = req.apiKey?.id || req.apiKey?.keyId || 'anonymous';
  recordLegacyPathUsage(apiKeyId, req.path);
  log.warn('DEPRECATION', 'Legacy unversioned API path used', {
    path: req.path,
    method: req.method,
    apiKeyId,
    successor: `/api/v1${req.path}`,
    sunset: LEGACY_SUNSET,
  });
  res.set('Deprecation', 'true');
  res.set('Sunset', LEGACY_SUNSET);
  res.set('Link', `</api/v1${req.path}>; rel="successor-version"`);
  return res.redirect(308, `/api/v1${req.url}`);
}

/**
 * Walk an Express Router's stack and register every route's methods + path
 * in the global methodRegistry.
 *
 * @param {string} prefix   The mount prefix (e.g. "/api/v1/wallets")
 * @param {object} router   An Express Router instance
 */
function populateRegistry(prefix, router) {
  if (!router || !router.stack) return;
  for (const layer of router.stack) {
    if (layer.route) {
      // Direct route on this router
      const fullPath = prefix + (layer.route.path === '/' ? '' : layer.route.path);
      for (const method of Object.keys(layer.route.methods)) {
        if (method !== '_all') registerMethod(method.toUpperCase(), fullPath);
      }
    } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
      // Nested sub-router — recurse with extracted path segment
      /* eslint-disable security/detect-unsafe-regex */
      const subPrefix = prefix + (layer.regexp.source
        .replace(/^\^\\\//, '/')
        .replace(/\\\/\?(?:\(\?.*\))?\$/, '')
        .replace(/\\\//g, '/')
        .replace(/\?(?:\(\?.*\))?$/, '')
        || '');
      /* eslint-enable security/detect-unsafe-regex */
      populateRegistry(subPrefix, layer.handle);
    }
  }
}

/**
 * Mount a router whose failure to load should not abort startup.
 * Failures are logged at error level with the stack so they are visible.
 *
 * @param {string} name
 * @param {Function} mount
 */
function mountOptional(name, mount) {
  try {
    mount();
    log.info('ROUTES', `${name} mounted`);
  } catch (err) {
    log.error('ROUTES', `${name} could not be mounted`, { error: err.message, stack: err.stack });
  }
}

/**
 * Standalone endpoints (not part of a router module), declared as a table.
 * `beforeAdminGuard` entries are registered before the /admin router-level
 * guard; `afterAdminGuard` entries are registered after the admin routers.
 *
 * @param {object} services - see mountRoutes()
 * @returns {{ beforeAdminGuard: Array<{method: string, path: string, middleware: Function[], handler: Function}>,
 *             afterAdminGuard:  Array<{method: string, path: string, middleware: Function[], handler: Function}> }}
 */
function buildEndpointTable(services = {}) {
  const { reconciliationService, transactionSyncScheduler } = services;
  const health = createHealthHandlers(services);
  const adminOnly = () => [rbac.requireAdmin()];
  const adminWrite = () => [rbac.requireAdmin(), payloadSizeLimiter(ENDPOINT_LIMITS.admin)];

  const beforeAdminGuard = [
    // Full dependency health check — rate-limited to protect the dependency checks.
    { method: 'get', path: '/api/v1/health',       middleware: [healthCheckRateLimiter], handler: health.health },
    { method: 'get', path: '/health',              middleware: [healthCheckRateLimiter], handler: health.health },
    // Probes are intentionally NOT rate-limited: a rate-limited probe would
    // report a healthy container as failing.
    { method: 'get', path: '/health/live',         middleware: [], handler: health.live },
    { method: 'get', path: '/api/v1/health/live',  middleware: [], handler: health.live },
    { method: 'get', path: '/health/ready',        middleware: [], handler: health.ready },
    { method: 'get', path: '/api/v1/health/ready', middleware: [], handler: health.ready },

    // Observability admin endpoints
    { method: 'get',    path: '/abuse-signals',         middleware: adminOnly(), handler: operations.abuseSignals },
    { method: 'get',    path: '/admin/blocked-ips',     middleware: adminOnly(), handler: operations.listBlockedIps },
    { method: 'delete', path: '/admin/blocked-ips/:ip', middleware: adminOnly(), handler: operations.unblockIp },
    { method: 'get',    path: '/suspicious-patterns',   middleware: adminOnly(), handler: operations.suspiciousPatterns },
  ];

  const afterAdminGuard = [
    { method: 'get', path: '/admin/audit-logs', middleware: adminOnly(), handler: operations.auditLogs },
  ];

  if (reconciliationService) {
    const reconcile = operations.createReconcileHandler(reconciliationService);
    afterAdminGuard.push(
      { method: 'post', path: '/reconcile',                    middleware: adminWrite(), handler: reconcile },
      { method: 'post', path: '/admin/reconcile',              middleware: adminWrite(), handler: reconcile },
      { method: 'get',  path: '/admin/orphaned-transactions',  middleware: adminOnly(),
        handler: operations.createOrphanedTransactionsHandler(reconciliationService) },
    );
  }

  if (transactionSyncScheduler) {
    afterAdminGuard.push(
      { method: 'post', path: '/admin/sync', middleware: adminWrite(),
        handler: operations.createSyncHandler(transactionSyncScheduler) },
    );
  }

  return { beforeAdminGuard, afterAdminGuard };
}

/**
 * Register a list of endpoint table entries on the app.
 *
 * @param {import('express').Application} app
 * @param {Array<{method: string, path: string, middleware: Function[], handler: Function}>} endpoints
 */
function mountEndpoints(app, endpoints) {
  for (const { method, path, middleware, handler } of endpoints) {
    app[method](path, ...middleware, handler);
  }
}

/**
 * Mount all routes onto the given Express app.
 * Must be called after applyMiddleware().
 *
 * @param {import('express').Application} app
 * @param {object} services - Service instances resolved from the service container
 * @param {object} services.stellarService
 * @param {object} services.networkStatusService
 * @param {object} services.recurringDonationScheduler
 * @param {object} services.transactionSyncScheduler
 */
function mountRoutes(app, services = {}) {
  const { networkStatusService, feeBumpService } = services;

  // Every replica registers the same inbound webhook sources from config (#1786).
  require('../middleware/inboundWebhookVerification').registerWebhookSourcesFromConfig();

  // Network route needs a service reference injected at mount time
  const { router: networkRoutes, setService: setNetworkService } = require('../routes/network');
  if (networkStatusService) setNetworkService(networkStatusService);

  // ── /api/v1 versioned router ────────────────────────────────────────────────
  const apiV1 = express.Router();

  for (const [path, router] of V1_ROUTES) {
    apiV1.use(path, router);
  }

  // Network routes require separate injection
  apiV1.use('/network', networkRoutes);

  // Corporate matching member endpoints (admin + v2 routers live in the same module)
  apiV1.use('/', require('../routes/corporateMatching'));

  // Federation lookup (has named export)
  const { router: federationLookupRoutes } = require('../routes/federationLookup');
  apiV1.use('/federation', federationLookupRoutes);

  // API-key routes require TOTP 2FA
  const { requireAdminTOTP } = require('../middleware/adminTOTP');
  apiV1.use('/api-keys', requireAdminTOTP(), require('../routes/apiKeys'));
  apiV1.use('/api-keys', require('../routes/apiKeyUsage'));
  // Audit log export (issue #1547) — route-level RBAC (see auditExportAccess()
  // in routes/auditLogExport.js) gates admin vs. self-service non-admin access,
  // so this is intentionally NOT behind requireAdminTOTP() at the mount point.
  apiV1.use('/api-keys', require('../routes/auditLogExport'));

  // Exchange rates
  apiV1.get('/exchange-rates', asyncHandler(async (req, res) => {
    try {
      const priceOracle = require('../services/PriceOracleService');
      const rates = await priceOracle.getRates();
      const priceSource = typeof priceOracle.getPriceSourceStatus === 'function'
        ? priceOracle.getPriceSourceStatus().source
        : undefined;
      res.json({
        success: true,
        data: {
          base: 'XLM',
          rates,
          source: priceSource,
          supportedCurrencies: ['XLM', ...priceOracle.SUPPORTED_CURRENCIES.map(c => c.toUpperCase())],
          cachedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      log.error('APP', 'Failed to fetch exchange rates', { error: err.message });
      res.status(503).json({
        success: false,
        error: { code: 'EXCHANGE_RATE_UNAVAILABLE', message: clientErrorMessage('EXCHANGE_RATES', err, 503) },
      });
    }
  }));

  // Donation and entity export endpoints (#1596)
  apiV1.use('/exports', require('../routes/exports'));

  app.use('/api/v1', apiV1);

  // ── /api/v2 standardized response envelope (Issue #1553) ─────────────────
  // Additive: /api/v1 above is untouched for backward compatibility.
  app.use('/api/v2', require('../routes/v2'));

  // Unversioned export endpoints (#1596); the versioned router is in V1_ROUTES.
  app.use('/exports', require('../routes/exports'));

  // Stellar federation protocol server (SEP-0002).
  // The versioned lookup router above is for consumers; this router serves
  // this application's own /.well-known and /federation protocol endpoints,
  // including GET /.well-known/stellar.toml (federation + SEP-0010 hints).
  const { router: federationProtocolRoutes } = require('../routes/federation');
  app.use('/', federationProtocolRoutes);

  // ── GraphQL endpoint (Issue #1366) ────────────────────────────────────────
  // Auth (requireApiKey), depth-limiting, and introspection rules are all applied
  // inside the router itself.
  mountOptional('GraphQL HTTP endpoint (/graphql)', () => {
    const { createGraphQLRouter } = require('../graphql/index');
    app.use('/graphql', createGraphQLRouter());
  });

  // ── Deprecation redirects for unversioned paths (Issues #738, #1802, #1803) ──
  app.use((req, res, next) => {
    const matchesLegacy = UNVERSIONED_PATHS.some(p => req.path === p || req.path.startsWith(p + '/'));
    if (!matchesLegacy) return next();
    return legacyRedirect(req, res);
  });

  // ── OpenAPI / Swagger UI (Issue #634, #740) ───────────────────────────────
  mountOptional('OpenAPI / Swagger UI', () => {
    const { spec, swaggerUiMiddleware, swaggerUiSetup } = require('../config/openapi');
    const serveSpec = (req, res) => res.json(spec);
    app.use('/api/docs', swaggerUiMiddleware, swaggerUiSetup);
    app.get('/api/openapi.json', serveSpec);
    if (process.env.NODE_ENV !== 'production') {
      app.use('/docs', swaggerUiMiddleware, swaggerUiSetup);
      app.get('/openapi.json', serveSpec);
    }
  });

  // ── Health, probe and observability endpoints ─────────────────────────────
  const endpoints = buildEndpointTable(services);
  mountEndpoints(app, endpoints.beforeAdminGuard);

  // ── Admin table-driven routes ─────────────────────────────────────────────
  // Apply requireApiKey + requireAdmin (which includes TOTP) to the entire
  // /admin tree via a single router-level guard so no admin route can be
  // accidentally left unprotected.
  app.use('/admin', requireApiKey, rbac.requireAdmin());

  for (const [path, router] of ADMIN_ROUTES) {
    app.use(path, router);
  }

  const serviceContainer = require('../config/serviceContainer');
  const effectiveFeeBumpService = feeBumpService
    || (typeof serviceContainer.getFeeBumpService === 'function' ? serviceContainer.getFeeBumpService() : null);
  if (effectiveFeeBumpService) {
    const createFeeBumpRouter = require('../routes/admin/feeBump');
    app.use('/admin/transactions', createFeeBumpRouter(effectiveFeeBumpService));
  }

  // Already behind the /admin guard above (requireApiKey + requireAdmin).
  app.use('/admin/totp', require('../routes/admin/totp'));

  // ── Audit logs, reconciliation & sync (admin) ─────────────────────────────
  mountEndpoints(app, endpoints.afterAdminGuard);

  // ── Optional changelog endpoint (ENABLE_CHANGELOG_ENDPOINT=true) ───────────
  if (require('../config/env').readEnv('ENABLE_CHANGELOG_ENDPOINT')) {
    app.use('/api/v1/changelog', require('../routes/changelog'));
  }

  // ── Method registry population ────────────────────────────────────────────
  // Walk the fully-assembled app stack after all routes are mounted and register
  // every route's path + methods so the 405 handler knows what's valid.
  clearRegistry();
  for (const layer of app._router.stack) {
    if (layer.name === 'router' && layer.handle && layer.handle.stack) {
      // Extract the mount prefix from the layer regexp
      // Express stores it as: /^\\/api\\/v1\\/?(?=\\/|$)/i  → /api/v1
      const src = layer.regexp.source;
      /* eslint-disable security/detect-unsafe-regex */
      const prefix = src
        .replace(/^\^\\\//, '/')
        .replace(/\\\/\?(?:\(\?[^)]*\))?\$?$/, '')
        .replace(/\?(?:\(\?[^)]*\))?$/, '')
        .replace(/\\\//g, '/');
      /* eslint-enable security/detect-unsafe-regex */
      populateRegistry(prefix, layer.handle);
    } else if (layer.route) {
      for (const method of Object.keys(layer.route.methods)) {
        if (method !== '_all') registerMethod(method.toUpperCase(), layer.route.path);
      }
    }
  }

  // Fail startup if the same method + path is defined twice (issue #1779).
  assertNoDuplicateRoutes();

  // ── 405 / OPTIONS pipeline ────────────────────────────────────────────────
  // optionsHandler: returns 200 + Allow for OPTIONS on known routes
  // methodNotAllowedHandler: returns 405 + Allow for wrong methods on known routes
  app.use(optionsHandler);
  app.use(methodNotAllowedHandler);

  // ── 404 & error handlers (must be last) ──────────────────────────────────
  app.use(notFoundHandler);
  app.use(errorHandler);
}

module.exports = {
  mountRoutes,
  buildEndpointTable,
  V1_ROUTES,
  ADMIN_ROUTES,
  UNVERSIONED_PATHS,
  LEGACY_SUNSET,
  legacyRedirect,
  getLegacyPathMetrics,
};
