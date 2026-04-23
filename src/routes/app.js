/**
 * Application Entry Point
 * 
 * RESPONSIBILITY: Express server initialization, middleware orchestration, and lifecycle management
 * OWNER: Backend Team
 * DEPENDENCIES: All middleware, routes, and core services
 * 
 * This module bootstraps the Express application, configures middleware pipeline,
 * registers API routes, and manages graceful startup/shutdown of background services.
 */

const express = require('express');
const helmet = require('helmet');
const StellarSdk = require('stellar-sdk');
const config = require('../config');
const stellarConfig = require('../config/stellar');
const donationRoutes = require('./donation');
const walletRoutes = require('./wallet');
const { thresholdsRouter } = require('./signers');
const recoveryRoutes = require('./recovery');
const statsRoutes = require('./stats');
const streamRoutes = require('./stream');
const NetworkStatusService = require('../services/NetworkStatusService');
const { router: networkRoutes, setService: setNetworkService } = require('./network');
const docsRoutes = require('./docs');
const transactionRoutes = require('./transaction');
const apiKeysRoutes = require('./apiKeys');
const apiKeyUsageRoutes = require('./apiKeyUsage');
const recurringDonationRoutes = require('./recurringDonation');
const channelRoutes = require('./channels');
const assetRoutes = require('./assets');
const feesRoutes = require('./fees');
const featureFlagsAdminRoutes = require('./admin/featureFlags');
const createFeeBumpRouter = require('./admin/feeBump');
const dbAdminRoutes = require('./admin/db');
const adminTracesRoutes = require('./admin/traces');
const retentionAdminRoutes = require('./admin/retention');
const backupAdminRoutes = require('./admin/backup');
const encryptionAdminRoutes = require('./admin/encryption');
const matchingProgramsAdminRoutes = require('./admin/matchingPrograms');
const corporateMatchingAdminRoutes = require('./admin/corporateMatching');
const { router: corporateMatchingRoutes } = require('./corporateMatching');
const routingAdminRoutes = require('./admin/routing');
const impactMetricsAdminRoutes = require('./admin/impactMetrics');
const impactRoutes = require('./impact');
const adminAnalyticsRoutes = require('./admin/analytics');
const adminInspectRoutes = require('./admin/inspect');
const reconciliationAdminRoutes = require('./admin/reconciliation');
const webhooksRoutes = require('./webhooks');
const campaignsRoutes = require('./campaigns');
const tiersRoutes = require('./tiers');
const offersRoutes = require('./offers');
const tagsRoutes = require('./tags');
const leaderboardRoutes = require('./leaderboard');
const { router: federationLookupRoutes } = require('./federationLookup');
const { errorHandler, notFoundHandler } = require('../middleware/errorHandler');
const logger = require('../middleware/logger');
const { attachUserRole } = require('../middleware/rbac');
const abuseDetectionMiddleware = require('../middleware/abuseDetection');
const replayDetectionMiddleware = require('../middleware/replayDetection');
const Database = require('../utils/database');
const HealthCheckService = require('../services/HealthCheckService');
const { initializeApiKeysTable } = require('../models/apiKeys');
const WebhookService = require('../services/WebhookService');
const { validateRBAC } = require('../utils/rbacValidator');
const log = require('../utils/log');
const requestId = require('../middleware/requestId');
const { attachLifecycleTracking } = require('../middleware/requestLifecycle');
const serviceContainer = require('../config/serviceContainer');
const { payloadSizeLimiter } = require('../middleware/payloadSizeLimiter');
const { createCorsMiddleware } = require('../middleware/cors');
const { createCspMiddleware, cspReportRouter } = require('../middleware/csp');
const { responseFormatterMiddleware } = require('../utils/responseFormatter');
const trackQuotaUsage = require('../middleware/quotaTracker');
const { startQuotaResetJob } = require('../jobs/quotaResetJob');
const { createDeduplicationMiddleware } = require('../middleware/deduplication');
const { fieldFilterMiddleware } = require('../middleware/fieldFilter');
const {
  logStartupDiagnostics,
  logShutdownDiagnostics,
} = require("../utils/startupDiagnostics");
const { parseCursorPaginationQuery } = require('../utils/pagination');
const AuditLogService = require('../services/AuditLogService');
const auditLogRetentionService = require('../services/AuditLogRetentionService');
const { runCleanup } = require('../jobs/cleanupJob');
const { requireAdmin } = require('../middleware/rbac');
const requireApiKey = require('../middleware/apiKey');
const encryptionRoutes = require('./encryption');
const authRoutes = require('./auth');
const toolsRoutes = require('./tools');
const { metricsMiddleware, registry } = require('../utils/metrics');
const { attachSubscriptionServer } = require('../graphql');
const sseManager = require('../services/SseManager');
const claimableBalancesRoutes = require('./claimableBalances');

const app = express();

// Configure trusted proxies for API Gateway integration
const trustedProxies = process.env.TRUSTED_PROXIES
  ? process.env.TRUSTED_PROXIES.split(',').map(ip => ip.trim())
  : 'loopback';
app.set('trust proxy', trustedProxies);

// Initialize services from container
const stellarService = serviceContainer.getStellarService();
const reconciliationService = serviceContainer.getTransactionReconciliationService();
const recurringDonationScheduler = serviceContainer.getRecurringDonationScheduler();
const networkStatusService = serviceContainer.getNetworkStatusService();
const transactionSyncScheduler = serviceContainer.getTransactionSyncScheduler();

// Initialize replay detection cleanup timer (will be started in startServer)
let replayCleanupTimer = null;

// Graceful shutdown state
let isShuttingDown = false;
let inFlightRequests = 0;

// In-flight request tracking and graceful shutdown rejection middleware
app.use((req, res, next) => {
  if (isShuttingDown) {
    if (req.path.startsWith('/health')) return next();
    res.set('Connection', 'close');
    return res.status(503).json({
      success: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Server is shutting down' }
    });
  }
  
  inFlightRequests++;
  let handled = false;
  const decrement = () => {
    if (!handled) {
      handled = true;
      inFlightRequests--;
    }
  };
  
  res.on('finish', decrement);
  res.on('close', decrement);
  next();
});

// Middleware
app.use(requestId);
app.use(attachLifecycleTracking);

// Attach res.success / res.failure envelope helpers (must be after requestId)
app.use(responseFormatterMiddleware());
// Security headers (helmet must be early, before routes)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  frameguard: { action: 'deny' },
  noSniff: true,
  referrerPolicy: { policy: 'no-referrer' },
  hsts: {
    maxAge: 31536000,       // 1 year
    includeSubDomains: true,
    preload: true,
  },
  xssFilter: false,         // deprecated header — omit for API servers
  hidePoweredBy: true,
}));

// CORS (must be before body parsers and route handlers)
app.use(createCorsMiddleware());

// CSP: per-request nonce + strict directives (after helmet, before routes)
app.use(createCspMiddleware());
app.use(cspReportRouter);

// Geographic IP blocking (must be before body parsers)
app.use(require('../middleware/geoBlock'));

// Payload size limit (must be before body parsers)
app.use(payloadSizeLimiter);

app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); }
}));
app.use(express.urlencoded({ extended: true }));

// Block check for auto-blocked IPs (early security)
app.use(require('../middleware/blockCheck'));

// Request/Response logging middleware
app.use(logger.middleware());

// Structured access log middleware (#721) — one entry per request with requestId, timing, status
app.use(require('../middleware/accessLog')());

// Abuse detection (observability only - no blocking)
app.use(abuseDetectionMiddleware);

// Replay detection (observability only - no blocking)
app.use(replayDetectionMiddleware);

// Suspicious pattern detection (observability only - no blocking)
app.use(require('../middleware/suspiciousPatternDetection'));

// Attach user role from authentication (must be before routes)
app.use(attachUserRole());

// Track API quota usage (must be after authentication)
app.use(trackQuotaUsage);

// Prometheus request duration instrumentation
app.use(metricsMiddleware);

// GET /metrics — Prometheus scrape endpoint (admin only)
app.get('/metrics', requireApiKey, requireAdmin(), async (req, res) => {
  try {
    res.set('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  } catch (err) {
    log.error('METRICS', 'Failed to generate metrics', { error: err.message });
    res.status(503).json({
      success: false,
      error: { code: 'METRICS_ERROR', message: 'Failed to generate metrics' }
    });
  }
});
// Content-based request deduplication (for requests without idempotency keys)
app.use(createDeduplicationMiddleware());

// Response field filtering (?fields=id,amount,status)
app.use(fieldFilterMiddleware());

// Routes
app.use('/wallets', walletRoutes);
app.use('/wallets', thresholdsRouter);
app.use('/', recoveryRoutes);
app.use('/donations', donationRoutes);
app.use('/donations', require('./receipt'));
app.use('/donations/recurring', recurringDonationRoutes);
app.use('/assets', assetRoutes);
app.use('/stats', statsRoutes);
app.use('/stream', streamRoutes);
app.use('/network', networkRoutes);
app.use('/webhooks', webhooksRoutes);
app.use('/campaigns', campaignsRoutes);
app.use('/encryption', encryptionRoutes);
app.use('/tiers', tiersRoutes);
app.use('/offers', offersRoutes);
app.use('/orderbook/:baseAsset/:counterAsset', require('./orderbook'));
app.use('/tags', tagsRoutes);
app.use('/leaderboard', leaderboardRoutes);
app.use('/federation', federationLookupRoutes);
app.use('/tools', toolsRoutes);
app.use('/auth', authRoutes);
app.use('/docs', docsRoutes);
app.use('/transactions', transactionRoutes);
app.use('/', corporateMatchingRoutes);
app.use('/claimable-balances', claimableBalancesRoutes);
app.use('/liquidity-pools', require('./liquidity-pools'));

// Exchange rates endpoint
app.get('/exchange-rates', async (req, res) => {
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
});

// SEP-0010 Stellar TOML discovery endpoint
app.get('/.well-known/stellar.toml', (req, res) => {
  const host = req.get('host') || 'localhost';
  const scheme = req.protocol || 'https';
  const authServer = `${scheme}://${host}/auth`;
  const signingKey = process.env.SERVICE_SIGNING_KEY || process.env.SERVICE_SECRET_KEY || process.env.STELLAR_SECRET || '';

  // Minimal SEP-0010 fields
  const tomlContents = [];
  tomlContents.push('VERSION = "1.0.0"');
  tomlContents.push(`AUTH_SERVER = "${authServer}"`);
  if (signingKey) {
    tomlContents.push(`SIGNING_KEY = "${StellarSdk.Keypair.fromSecret(signingKey).publicKey()}"`);
  }

  res.type('text/plain').send(tomlContents.join('\n'));
});

// ─── OpenAPI / Swagger UI (issue #634) ───────────────────────────────────────
try {
  const { spec, swaggerUiMiddleware, swaggerUiSetup } = require('../config/openapi');
  app.use('/api/docs', swaggerUiMiddleware, swaggerUiSetup);
  app.get('/api/openapi.json', (req, res) => res.json(spec));
} catch (_err) {
  // swagger-jsdoc / swagger-ui-express not installed — skip silently
}

// Health check endpoint
// Health check endpoints
app.get('/health', async (req, res) => {
  try {
    const health = await HealthCheckService.getFullHealth(stellarService, networkStatusService);
    const stellarConfig = require('../config/stellar');
    health.stellarEnvironment = stellarConfig.environment || 'testnet';
    health.stellarNetwork = stellarConfig.network || 'testnet';
    health.clientIp = req.ip;
    health.protocol = req.protocol;
    health.requestId = req.id;
    health.transactionSync = transactionSyncScheduler.getSyncStatus();
    
    const httpStatus = health.status === 'healthy' ? 200 : 503;
    return res.status(httpStatus).json(health);
  } catch (err) {
    log.error('HEALTH', 'Health check failed', { error: err.message });
    return res.status(503).json({
      success: false,
      status: 'unhealthy',
      error: { code: 'HEALTH_CHECK_ERROR', message: 'Health check failed' }
    });
  }
});

// Liveness probe — returns 200 as long as the process is running
app.get('/health/live', (req, res) => {
  return res.status(200).json(HealthCheckService.getLiveness());
});

// Readiness probe — returns 200 only when all dependencies are healthy
app.get('/health/ready', async (req, res) => {
  try {
    const readiness = await HealthCheckService.getReadiness(stellarService, networkStatusService);
    const httpStatus = readiness.ready ? 200 : 503;
    return res.status(httpStatus).json(readiness);
  } catch (err) {
    log.error('HEALTH', 'Readiness check failed', { error: err.message });
    return res.status(503).json({
      success: false,
      ready: false,
      error: { code: 'READINESS_CHECK_ERROR', message: 'Readiness check failed' }
    });
  }
});

// Abuse detection stats endpoint (admin only)
app.get('/abuse-signals', require('../middleware/rbac').requireAdmin(), (req, res) => {
  const abuseDetector = require('../utils/abuseDetector');

  res.json({
    success: true,
    data: abuseDetector.getStats(),
    timestamp: new Date().toISOString()
  });
});

// Blocked IPs admin endpoints
app.get('/admin/blocked-ips', require('../middleware/rbac').requireAdmin(), (req, res) => {
  const abuseDetectionService = require('../services/AbuseDetectionService');
  res.json({
    success: true,
    data: abuseDetectionService.getBlocked(),
    timestamp: new Date().toISOString()
  });
});

app.delete('/admin/blocked-ips/:ip', require('../middleware/rbac').requireAdmin(), (req, res) => {
  const abuseDetectionService = require('../services/AbuseDetectionService');
  const ip = req.params.ip;
  const unblocked = abuseDetectionService.unblock(ip);
  if (unblocked) {
    res.json({
      success: true,
      message: 'IP unblocked',
      ip,
      timestamp: new Date().toISOString()
    });
  } else {
    res.status(404).json({
      success: false,
      error: { code: 'IP_NOT_BLOCKED', message: 'IP not currently blocked' },
      timestamp: new Date().toISOString()
    });
  }
});

// Suspicious pattern metrics endpoint (admin only)
app.get('/suspicious-patterns', require('../middleware/rbac').requireAdmin(), (req, res) => {
  const suspiciousPatternDetector = require('../utils/suspiciousPatternDetector');

  res.json({
    success: true,
    data: suspiciousPatternDetector.getMetrics(),
    timestamp: new Date().toISOString()
  });
});

// Transaction inspection (admin only)
app.use('/admin/inspect/xdr', require('../middleware/rbac').requireAdmin(), adminInspectRoutes);

// Audit log export (Issue #604) - async jobs with signed download URLs
app.use('/admin/audit-logs/export', require('./admin/auditLogExport'));

// Audit logs endpoint (admin only)
app.get('/admin/audit-logs', require('../middleware/rbac').requireAdmin(), async (req, res, next) => {
  try {
    const pagination = parseCursorPaginationQuery(req.query);
    const filters = {
      category: req.query.category,
      action: req.query.action,
      severity: req.query.severity,
      userId: req.query.userId,
      requestId: req.query.requestId,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    };

    const result = await AuditLogService.queryPaginated(filters, pagination);

    res.setHeader('X-Total-Count', String(result.totalCount));
    res.json({
      success: true,
      data: result.data,
      count: result.data.length,
      meta: result.meta
    });
  } catch (error) {
    next(error);
  }
});

// Manual reconciliation trigger (admin only)
app.post('/reconcile', require('../middleware/rbac').requireAdmin(), async (req, res, next) => {
  try {
    if (reconciliationService.reconciliationInProgress) {
      return res.status(409).json({
        success: false,
        error: 'Reconciliation already in progress'
      });
    }
    // Trigger reconciliation and wait for result
    const result = await reconciliationService.reconcile();
    res.json({
      success: true,
      message: 'Reconciliation complete',
      data: result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

// Admin reconcile endpoint (canonical path)
app.post('/admin/reconcile', require('../middleware/rbac').requireAdmin(), async (req, res, next) => {
  try {
    if (reconciliationService.reconciliationInProgress) {
      return res.status(409).json({
        success: false,
        error: 'Reconciliation already in progress'
      });
    }
    const result = await reconciliationService.reconcile();
    res.json({
      success: true,
      message: 'Reconciliation complete',
      data: result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

// Admin sync endpoint — triggers immediate transaction sync for all wallets
app.post('/admin/sync', require('../middleware/rbac').requireAdmin(), async (req, res, next) => {
  try {
    const result = await transactionSyncScheduler.syncAllWallets();
    res.json({
      success: true,
      message: 'Transaction sync complete',
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

// Orphaned transactions stats (admin only)
app.get('/admin/orphaned-transactions', require('../middleware/rbac').requireAdmin(), async (req, res, next) => {
  try {
    const rows = await Database.query(
      'SELECT id, senderId, receiverId, amount, memo, timestamp, stellar_tx_id FROM transactions WHERE is_orphan = 1 ORDER BY timestamp DESC',
      []
    );
    res.json({
      success: true,
      data: {
        count: rows.length,
        transactions: rows,
        lifetimeDetected: reconciliationService.getOrphanedTransactionCount(),
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

// 404 handler (must be after all routes)
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  // Extract error details from reason object
  const errorDetails = {
    message: reason?.message || String(reason),
    stack: reason?.stack,
    name: reason?.name,
    code: reason?.code,
    timestamp: new Date().toISOString()
  };
  
  log.error('APP', 'Unhandled promise rejection', errorDetails);
});

process.on('uncaughtException', (error) => {
  // Extract error details from error object
  const errorDetails = {
    message: error?.message || String(error),
    stack: error?.stack,
    name: error?.name,
    code: error?.code,
    timestamp: new Date().toISOString()
  };
  
  log.error('APP', 'Uncaught exception', errorDetails);
  // Exit process after logging uncaught exception
  process.exit(1);
});

const PORT = config.server.port;

let cleanupInterval = null;

async function startServer() {
  try {
    await logStartupDiagnostics();

    // #714: Bind the HTTP port immediately so /health/live is reachable right away.
    // Critical DB/schema init and background services run asynchronously after bind.
    const server = app.listen(PORT);

    // #715: Handle EADDRINUSE with a clear, actionable error message.
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        log.error('APP', `Port ${PORT} is already in use. Stop the existing process or set a different PORT in your .env file.`, { port: PORT });
        process.exit(1);
      }
      throw err;
    });

    await new Promise((resolve) => server.once('listening', resolve));

    log.info('APP', 'HTTP server listening', {
      port: PORT,
      healthCheck: `http://localhost:${PORT}/health`,
    });

    // Attach WebSocket servers immediately after bind
    attachSubscriptionServer(server);
    require('../services/websocketService').attach(server);

    // Run critical init (DB migrations, table setup) asynchronously after port is bound.
    // /health/ready will return false until this completes.
    setImmediate(async () => {
      try {
        const { runMigrations } = require('../utils/migrationRunner');
        await runMigrations();
        await initializeApiKeysTable();

        const { initializeFeatureFlagsTable, loadFlagsFromEnv } = require('../utils/featureFlags');
        await initializeFeatureFlagsTable();
        if (process.env.FEATURE_FLAGS) {
          await loadFlagsFromEnv(process.env.FEATURE_FLAGS);
        }

        await WebhookService.initTable();
        await validateRBAC();

        // Only start background workers and jobs if not in test environment
        if (process.env.NODE_ENV !== 'test') {
          const stopQuotaResetJob = startQuotaResetJob();
          server.stopQuotaResetJob = stopQuotaResetJob;

          require('../workers/expiryWorker').start();
          recurringDonationScheduler.start();
          reconciliationService.start();
          auditLogRetentionService.start();
          transactionSyncScheduler.start();
          sseManager.start();

          runCleanup();
          cleanupInterval = setInterval(runCleanup, 24 * 60 * 60 * 1000);
        }

        // Initialize network status monitoring
        networkStatusService.on('network.degraded', (status) => {
          log.warn('NETWORK_STATUS', 'Network status degraded', { status });
        });
        try {
          await networkStatusService.initialize();
        } catch (err) {
          log.error('APP', 'Failed to initialize NetworkStatusService', { error: err.message });
        }

        const { startCleanup } = require('../utils/replayDetector');
        const replayConfig = require('../config/replayDetection');
        replayCleanupTimer = startCleanup(replayDetectionMiddleware.trackingStore, replayConfig);

        try {
          const LeaderboardSSE = require('../services/LeaderboardSSE');
          LeaderboardSSE.initLeaderboardSSE();
        } catch (err) {
          log.error('APP', 'Failed to initialize LeaderboardSSE', { error: err.message });
        }

        log.info('APP', 'API ready', {
          port: PORT,
          network: config.network,
          healthCheck: `http://localhost:${PORT}/health`,
        });

        if (log.isDebugMode) {
          log.debug('APP', 'Debug mode enabled - verbose logging active');
          log.debug('APP', 'Configuration loaded', {
            port: PORT,
            network: stellarConfig.network,
            healthCheck: `http://localhost:${PORT}/health`,
            environment: config.server.env,
          });
        }
      } catch (initErr) {
        log.error('APP', 'Background initialization failed', { error: initErr.message });
        process.exit(1);
      }
    });

    const gracefulShutdown = async (signal) => {
      if (isShuttingDown) return;
      isShuttingDown = true;
      log.info("SHUTDOWN", `Received ${signal}, starting graceful shutdown`);
      logShutdownDiagnostics(signal);

      clearInterval(cleanupInterval); // Stop the timer so the process can exit

      const timeoutMs = parseInt(process.env.SHUTDOWN_TIMEOUT_MS || process.env.SHUTDOWN_TIMEOUT || '30000', 10);
      let forcedExit = false;
      const forceExit = setTimeout(() => {
        forcedExit = true;
        log.error("SHUTDOWN", `Forced shutdown after ${timeoutMs}ms timeout`, {
          abandonedRequests: inFlightRequests
        });
        process.exit(1);
      }, timeoutMs);

      server.close(async () => {
        log.info("SHUTDOWN", "HTTP server closed to new connections");

        // Wait for in-flight requests to drain
        await new Promise((resolve) => {
          const waitInterval = setInterval(() => {
            if (forcedExit) { clearInterval(waitInterval); return resolve(); }
            if (inFlightRequests > 0) {
              log.info("SHUTDOWN", `Waiting for ${inFlightRequests} in-flight requests to complete...`);
              return;
            }
            clearInterval(waitInterval);
            log.info("SHUTDOWN", "All in-flight requests completed.");
            resolve();
          }, 500);
        });

        if (forcedExit) return;

        // Flush pending webhook deliveries
        try {
          const WebhookService = require('../services/WebhookService');
          if (typeof WebhookService.flushPending === 'function') {
            await WebhookService.flushPending();
          }
          log.info("SHUTDOWN", "Webhooks flushed");
        } catch (err) {
          log.error("SHUTDOWN", "Error flushing webhooks", { error: err.message });
        }

        // Stop recurring donation scheduler and wait for running job
        try {
          await recurringDonationScheduler.stopGracefully
            ? recurringDonationScheduler.stopGracefully()
            : recurringDonationScheduler.stop();
          log.info("SHUTDOWN", "Scheduler stopped");
        } catch (err) {
          log.error("SHUTDOWN", "Error stopping scheduler", { error: err.message });
        }

        clearTimeout(forceExit);

        reconciliationService.stop();
        auditLogRetentionService.stop();
        transactionSyncScheduler.stop();
        require('../workers/expiryWorker').stop();
        
        // Stop quota reset job
        if (server.stopQuotaResetJob) {
          server.stopQuotaResetJob();
          log.info("SHUTDOWN", "Quota reset job stopped");
        }
        
        try {
          await networkStatusService.shutdown();
        } catch (err) {
          log.error("SHUTDOWN", "Error shutting down NetworkStatusService", { error: err.message });
        }

        if (replayCleanupTimer) {
          clearInterval(replayCleanupTimer);
          log.info("SHUTDOWN", "Replay detection cleanup timer stopped");
        }

        await Database.close();
        log.info("SHUTDOWN", "Database pool closed");

        log.info("SHUTDOWN", "Graceful shutdown complete.");
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (error) {
    log.error('APP', 'Failed to start server', { error: error.message });
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = app;
