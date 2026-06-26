/**
 * Route mounting bootstrap.
 * Table-driven registration of all API and admin routes.
 * No middleware is applied here (see middleware.js).
 *
 * The ROUTE_TABLE arrays are the canonical source of truth for what paths exist;
 * a snapshot test diffs them to catch accidental additions / deletions.
 */

'use strict';

const express = require('express');
const StellarSdk = require('stellar-sdk');
const asyncHandler = require('../utils/asyncHandler');
const log = require('../utils/log');
const requireApiKey = require('../middleware/apiKey');
const { requireAdmin, requireAdminFn } = (() => {
  const rbac = require('../middleware/rbac');
  return { requireAdmin: rbac.requireAdmin, requireAdminFn: rbac.requireAdmin };
})();
const rbac = require('../middleware/rbac');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../middleware/payloadSizeLimiter');
const { healthCheckRateLimiter } = require('../middleware/rateLimiter');
const { parseCursorPaginationQuery } = require('../utils/pagination');
const { errorHandler, notFoundHandler } = require('../middleware/errorHandler');
const HealthCheckService = require('../services/HealthCheckService');
const AuditLogService = require('../services/AuditLogService');
const Database = require('../utils/database');
const state = require('./state');

// ── Versioned API v1 routes ────────────────────────────────────────────────────
const V1_ROUTES = [
  ['/fees',                           require('../routes/fees')],
  ['/wallets',                        require('../routes/wallet')],
  ['/wallets',                        require('../routes/signers').thresholdsRouter],
  ['/',                               require('../routes/recovery')],
  ['/donations',                      require('../routes/donation')],
  ['/donations',                      require('../routes/receipt')],
  ['/donations',                      require('../routes/disputes')],
  ['/donations/recurring',            require('../routes/recurringDonation')],
  ['/assets',                         require('../routes/assets')],
  ['/stats',                          require('../routes/stats')],
  ['/stream',                         require('../routes/stream')],
  ['/webhooks',                       require('../routes/webhooks')],
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
  ['/transactions',                   require('../routes/transaction')],
  ['/claimable-balances',             require('../routes/claimableBalances')],
  ['/liquidity-pools',                require('../routes/liquidity-pools')],
];

// ── Admin routes ──────────────────────────────────────────────────────────────
const ADMIN_ROUTES = [
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
  ['/admin',                          require('../routes/admin/backup')],
  ['/admin/audit-logs/export',        require('../routes/admin/auditLogExport')],
  ['/admin/security/scan',            require('../routes/admin/securityScan')],
];

// Unversioned paths that redirect to /api/v1 (Issue #738)
const UNVERSIONED_PATHS = [
  '/wallets', '/donations', '/assets', '/stats', '/stream', '/network',
  '/webhooks', '/campaigns', '/encryption', '/tiers', '/offers', '/orderbook',
  '/tags', '/leaderboard', '/federation', '/tools', '/auth', '/docs',
  '/transactions', '/claimable-balances', '/liquidity-pools', '/exchange-rates',
];

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
  const {
    stellarService,
    networkStatusService,
    recurringDonationScheduler,
    transactionSyncScheduler,
  } = services;

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

  // Corporate matching router (has named export)
  const { router: corporateMatchingRoutes } = require('../routes/corporateMatching');
  apiV1.use('/', corporateMatchingRoutes);

  // Federation lookup (has named export)
  const { router: federationLookupRoutes } = require('../routes/federationLookup');
  apiV1.use('/federation', federationLookupRoutes);

  // API-key routes require TOTP 2FA
  const { requireAdminTOTP } = require('../middleware/adminTOTP');
  apiV1.use('/api-keys', requireAdminTOTP(), require('../routes/apiKeys'));
  apiV1.use('/api-keys', require('../routes/apiKeyUsage'));

  // Exchange rates
  apiV1.get('/exchange-rates', asyncHandler(async (req, res) => {
    try {
      const priceOracle = require('../services/PriceOracleService');
      const rates = await priceOracle.getRates();
      res.json({
        success: true,
        data: {
          base: 'XLM',
          rates,
          supportedCurrencies: ['XLM', ...priceOracle.SUPPORTED_CURRENCIES.map(c => c.toUpperCase())],
          cachedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      log.error('APP', 'Failed to fetch exchange rates', { error: err.message });
      res.status(503).json({
        success: false,
        error: { code: 'EXCHANGE_RATE_UNAVAILABLE', message: err.message },
      });
    }
  }));

  app.use('/api/v1', apiV1);

  // ── Deprecation redirects for unversioned paths (Issue #738) ─────────────────
  app.use((req, res, next) => {
    const matchesLegacy = UNVERSIONED_PATHS.some(p => req.path === p || req.path.startsWith(p + '/'));
    if (!matchesLegacy) return next();
    res.set('Deprecation', 'true');
    res.set('Link', `</api/v1${req.path}>; rel="successor-version"`);
    res.set('Sunset', 'Sat, 01 Jan 2027 00:00:00 GMT');
    return res.redirect(308, `/api/v1${req.url}`);
  });

  // ── SEP-0010 Stellar TOML ─────────────────────────────────────────────────
  app.get('/.well-known/stellar.toml', (req, res) => {
    const host = req.get('host') || 'localhost';
    const scheme = req.protocol || 'https';
    const authServer = `${scheme}://${host}/auth`;
    const signingKey = process.env.SERVICE_SIGNING_KEY || process.env.SERVICE_SECRET_KEY || process.env.STELLAR_SECRET || '';
    const tomlContents = ['VERSION = "1.0.0"', `AUTH_SERVER = "${authServer}"`];
    if (signingKey) {
      tomlContents.push(`SIGNING_KEY = "${StellarSdk.Keypair.fromSecret(signingKey).publicKey()}"`);
    }
    res.type('text/plain').send(tomlContents.join('\n'));
  });

  // ── OpenAPI / Swagger UI (Issue #634, #740) ───────────────────────────────
  try {
    const { spec, swaggerUiMiddleware, swaggerUiSetup } = require('../config/openapi');
    app.use('/api/docs', swaggerUiMiddleware, swaggerUiSetup);
    app.get('/api/openapi.json', (req, res) => res.json(spec));
    if (process.env.NODE_ENV !== 'production') {
      app.use('/docs', swaggerUiMiddleware, swaggerUiSetup);
      app.get('/openapi.json', (req, res) => res.json(spec));
    }
  } catch (_) { /* swagger packages not installed — skip */ }

  // ── Health endpoints ──────────────────────────────────────────────────────
  const healthHandler = asyncHandler(async (req, res) => {
    try {
      const isAdmin = req.apiKey?.role === 'admin' || req.user?.role === 'admin';
      const verbose = req.query.verbose === 'true' && isAdmin;
      const isProduction = process.env.NODE_ENV === 'production';
      const shouldMinimize = isProduction && !isAdmin;

      const health = await HealthCheckService.getFullHealth(
        stellarService,
        networkStatusService,
        recurringDonationScheduler,
        verbose && !shouldMinimize
      );

      if (shouldMinimize) {
        return res.status(health.status === 'healthy' ? 200 : 503).json({
          status: health.status,
          timestamp: health.timestamp,
        });
      }

      health.stellarEnvironment = require('../config/stellar').environment || 'testnet';
      health.stellarNetwork = require('../config/stellar').network || 'testnet';
      health.requestId = req.id;
      if (transactionSyncScheduler) {
        health.transactionSync = transactionSyncScheduler.getSyncStatus();
      }
      return res.status(health.status === 'healthy' ? 200 : 503).json(health);
    } catch (err) {
      log.error('HEALTH', 'Health check failed', { error: err.message });
      return res.status(503).json({
        success: false,
        status: 'unhealthy',
        error: { code: 'HEALTH_CHECK_ERROR', message: 'Health check failed' },
      });
    }
  });

  app.get('/api/v1/health', healthCheckRateLimiter, healthHandler);
  app.get('/health', healthCheckRateLimiter, healthHandler);

  app.get('/health/live', (req, res) => res.status(200).json(HealthCheckService.getLiveness()));

  app.get('/health/ready', asyncHandler(async (req, res) => {
    if (state.isShuttingDown) {
      return res.status(503).json({ status: 'not_ready', reason: 'server is shutting down' });
    }
    try {
      const readiness = await HealthCheckService.getReadiness(
        stellarService, networkStatusService, recurringDonationScheduler
      );
      if (readiness.ready) {
        return res.status(200).json({ status: 'ready', timestamp: readiness.timestamp });
      }
      const reason = readiness.status === 'unhealthy'
        ? 'one or more critical dependencies are unavailable'
        : `service is ${readiness.status}`;
      return res.status(503).json({ status: 'not_ready', reason, timestamp: readiness.timestamp });
    } catch (err) {
      log.error('HEALTH', 'Readiness check failed', { error: err.message });
      return res.status(503).json({ status: 'not_ready', reason: 'readiness check failed' });
    }
  }));

  // ── Observability admin endpoints ─────────────────────────────────────────
  app.get('/abuse-signals', rbac.requireAdmin(), (req, res) => {
    const abuseDetector = require('../utils/abuseDetector');
    res.json({ success: true, data: abuseDetector.getStats(), timestamp: new Date().toISOString() });
  });

  app.get('/admin/blocked-ips', rbac.requireAdmin(), (req, res) => {
    const abuseDetectionService = require('../services/AbuseDetectionService');
    res.json({ success: true, data: abuseDetectionService.getBlocked(), timestamp: new Date().toISOString() });
  });

  app.delete('/admin/blocked-ips/:ip', rbac.requireAdmin(), (req, res) => {
    const abuseDetectionService = require('../services/AbuseDetectionService');
    const ip = req.params.ip;
    const unblocked = abuseDetectionService.unblock(ip);
    if (unblocked) {
      res.json({ success: true, message: 'IP unblocked', ip, timestamp: new Date().toISOString() });
    } else {
      res.status(404).json({
        success: false,
        error: { code: 'IP_NOT_BLOCKED', message: 'IP not currently blocked' },
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.get('/suspicious-patterns', rbac.requireAdmin(), (req, res) => {
    const suspiciousPatternDetector = require('../utils/suspiciousPatternDetector');
    res.json({ success: true, data: suspiciousPatternDetector.getMetrics(), timestamp: new Date().toISOString() });
  });

  // ── Admin table-driven routes ─────────────────────────────────────────────
  // Apply requireApiKey + requireAdmin (which includes TOTP) to the entire
  // /admin tree via a single router-level guard so no admin route can be
  // accidentally left unprotected.
  app.use('/admin', requireApiKey, rbac.requireAdmin());

  for (const [path, router] of ADMIN_ROUTES) {
    app.use(path, router);
  }

  app.use('/admin/totp', requireApiKey, require('../routes/admin/totp'));
  app.use('/admin/inspect/xdr', rbac.requireAdmin(), require('../routes/admin/inspect'));

  // Audit logs — #796: mandatory pagination, default 50, max 500
  const AUDIT_LOG_DEFAULT_LIMIT = 50;
  const AUDIT_LOG_MAX_LIMIT = 500;

  app.get('/admin/audit-logs', rbac.requireAdmin(), asyncHandler(async (req, res, next) => {
    try {
      let limit = AUDIT_LOG_DEFAULT_LIMIT;
      if (req.query.limit !== undefined) {
        const parsed = parseInt(req.query.limit, 10);
        if (isNaN(parsed) || parsed < 1) {
          return res.status(400).json({ success: false, error: { code: 'INVALID_LIMIT', message: 'limit must be a positive integer' } });
        }
        if (parsed > AUDIT_LOG_MAX_LIMIT) {
          return res.status(400).json({ success: false, error: { code: 'LIMIT_TOO_LARGE', message: `limit cannot exceed ${AUDIT_LOG_MAX_LIMIT}` } });
        }
        limit = parsed;
      }

      const VALID_CATEGORIES = new Set(Object.values(AuditLogService.CATEGORY));
      const VALID_SEVERITIES = new Set(Object.values(AuditLogService.SEVERITY));
      if (req.query.category && !VALID_CATEGORIES.has(req.query.category)) {
        return res.status(400).json({ success: false, error: 'Invalid category value' });
      }
      if (req.query.severity && !VALID_SEVERITIES.has(req.query.severity)) {
        return res.status(400).json({ success: false, error: 'Invalid severity value' });
      }

      const pagination = parseCursorPaginationQuery({ ...req.query, limit: String(limit) });
      pagination.limit = limit;

      const filters = {
        category: req.query.category,
        action: req.query.action,
        severity: req.query.severity,
        userId: req.query.actorId || req.query.userId,
        requestId: req.query.requestId,
        startDate: req.query.from || req.query.startDate,
        endDate: req.query.to || req.query.endDate,
      };

      const result = await AuditLogService.queryPaginated(filters, pagination);
      res.setHeader('X-Total-Count', String(result.totalCount));
      res.json({
        success: true,
        data: result.data,
        count: result.data.length,
        pagination: {
          limit,
          cursor: result.meta.next_cursor || null,
          hasMore: result.meta.next_cursor !== null,
          total: result.totalCount,
        },
        meta: result.meta,
      });
    } catch (error) {
      next(error);
    }
  }));

  // ── Reconciliation & sync (admin) ─────────────────────────────────────────
  const reconcileHandler = (reconciliationService) => asyncHandler(async (req, res, next) => {
    try {
      if (reconciliationService && reconciliationService.reconciliationInProgress) {
        return res.status(409).json({ success: false, error: 'Reconciliation already in progress' });
      }
      const result = await reconciliationService.reconcile();
      res.json({ success: true, message: 'Reconciliation complete', data: result, timestamp: new Date().toISOString() });
    } catch (error) {
      next(error);
    }
  });

  if (services.reconciliationService) {
    app.post('/reconcile', rbac.requireAdmin(), payloadSizeLimiter(ENDPOINT_LIMITS.admin), reconcileHandler(services.reconciliationService));
    app.post('/admin/reconcile', rbac.requireAdmin(), payloadSizeLimiter(ENDPOINT_LIMITS.admin), reconcileHandler(services.reconciliationService));
    app.get('/admin/orphaned-transactions', rbac.requireAdmin(), asyncHandler(async (req, res, next) => {
      try {
        const rows = await Database.query(
          'SELECT id, senderId, receiverId, amount, memo, timestamp, stellar_tx_id FROM transactions WHERE is_orphan = 1 ORDER BY timestamp DESC',
          []
        );
        res.json({
          success: true,
          data: { count: rows.length, transactions: rows, lifetimeDetected: services.reconciliationService.getOrphanedTransactionCount() },
          timestamp: new Date().toISOString(),
        });
      } catch (error) { next(error); }
    }));
  }

  if (transactionSyncScheduler) {
    app.post('/admin/sync', rbac.requireAdmin(), payloadSizeLimiter(ENDPOINT_LIMITS.admin), asyncHandler(async (req, res, next) => {
      try {
        const result = await transactionSyncScheduler.syncAllWallets();
        res.json({ success: true, message: 'Transaction sync complete', data: result });
      } catch (error) { next(error); }
    }));
  }

  // ── 404 & error handlers (must be last) ──────────────────────────────────
  app.use(notFoundHandler);
  app.use(errorHandler);
}

module.exports = { mountRoutes, V1_ROUTES, ADMIN_ROUTES, UNVERSIONED_PATHS };
