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
const config = require('../config');
const stellarConfig = require('../config/stellar');
const donationRoutes = require('./donation');
const walletRoutes = require('./wallet');
const statsRoutes = require('./stats');
const streamRoutes = require('./stream');
const transactionRoutes = require('./transaction');
const apiKeysRoutes = require('./apiKeys');
const recurringDonationRoutes = require('./recurringDonation');
const assetRoutes = require('./assets');
const feesRoutes = require('./fees');
const featureFlagsAdminRoutes = require('./admin/featureFlags');
const createFeeBumpRouter = require('./admin/feeBump');
const dbAdminRoutes = require('./admin/db');
const retentionAdminRoutes = require('./admin/retention');
const backupAdminRoutes = require('./admin/backup');
const matchingProgramsAdminRoutes = require('./admin/matchingPrograms');
const impactMetricsAdminRoutes = require('./admin/impactMetrics');
const networkRoutes = require('./network');
const webhooksRoutes = require('./webhooks');
const campaignsRoutes = require('./campaigns');
const offersRoutes = require('./offers');
const tagsRoutes = require('./tags');
const leaderboardRoutes = require('./leaderboard');
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
const serviceContainer = require('../config/serviceContainer');
const { payloadSizeLimiter } = require('../middleware/payloadSizeLimiter');
const { createCorsMiddleware } = require('../middleware/cors');
const { responseFormatterMiddleware } = require('../utils/responseFormatter');
const trackQuotaUsage = require('../middleware/quotaTracker');
const { startQuotaResetJob } = require('../jobs/quotaResetJob');
const { createDeduplicationMiddleware } = require('../middleware/deduplication');
const {
  logStartupDiagnostics,
  logShutdownDiagnostics,
} = require("../utils/startupDiagnostics");
const { parseCursorPaginationQuery } = require('../utils/pagination');
const AuditLogService = require('../services/AuditLogService');
const auditLogRetentionService = require('../services/AuditLogRetentionService');
const { runCleanup } = require('../jobs/cleanupJob');

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

// Geographic IP blocking (must be before body parsers)
app.use(require('../middleware/geoBlock'));

// Payload size limit (must be before body parsers)
app.use(payloadSizeLimiter);

app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); }
}));
app.use(express.urlencoded({ extended: true }));

// Request/Response logging middleware
app.use(logger.middleware());

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
  res.set('Content-Type', registry.contentType);
  res.end(await registry.metrics());
});
// Content-based request deduplication (for requests without idempotency keys)
app.use(createDeduplicationMiddleware());

// Routes
app.use('/wallets', walletRoutes);
app.use('/donations', donationRoutes);
app.use('/donations/recurring', recurringDonationRoutes);
app.use('/assets', assetRoutes);
app.use('/stats', statsRoutes);
app.use('/stream', streamRoutes);
app.use('/transactions', transactionRoutes);
app.use('/api-keys', apiKeysRoutes);
app.use('/fees', feesRoutes);
app.use('/admin/feature-flags', featureFlagsAdminRoutes);
app.use('/admin/db', dbAdminRoutes);
app.use('/admin/retention', retentionAdminRoutes);
app.use('/admin', backupAdminRoutes);
app.use('/admin/matching-programs', matchingProgramsAdminRoutes);
app.use('/admin/impact-metrics', impactMetricsAdminRoutes);
app.use('/admin/geo-blocking', require('./admin/geoBlocking'));

// Fee bump admin route — lazy access to serviceContainer
app.use('/admin/transactions', (req, res, next) => {
  const serviceContainer = require('../config/serviceContainer');
  const feeBumpRouter = createFeeBumpRouter(serviceContainer.getFeeBumpService());
  feeBumpRouter(req, res, next);
});
app.use('/network', networkRoutes);
app.use('/webhooks', webhooksRoutes);
app.use('/campaigns', campaignsRoutes);
app.use('/offers', offersRoutes);
app.use('/tags', tagsRoutes);
app.use('/leaderboard', leaderboardRoutes);

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

// Health check endpoint
// Health check endpoints
app.get('/health', async (req, res) => {
  const health = await HealthCheckService.getFullHealth(stellarService, networkStatusService);
  const stellarConfig = require('../config/stellar');
  health.stellarEnvironment = stellarConfig.environment || 'testnet';
  health.stellarNetwork = stellarConfig.network || 'testnet';
  health.clientIp = req.ip;
  health.protocol = req.protocol;
  health.requestId = req.id;
  
  const httpStatus = health.status === 'unhealthy' ? 503 : 200;
  return res.status(httpStatus).json(health);
});

// Liveness probe — returns 200 as long as the process is running
app.get('/health/live', (req, res) => {
  return res.status(200).json(HealthCheckService.getLiveness());
});

// Readiness probe — returns 200 only when all dependencies are healthy
app.get('/health/ready', async (req, res) => {
  const readiness = await HealthCheckService.getReadiness(stellarService, networkStatusService);
  const httpStatus = readiness.ready ? 200 : 503;
  return res.status(httpStatus).json(readiness);
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

// Suspicious pattern metrics endpoint (admin only)
app.get('/suspicious-patterns', require('../middleware/rbac').requireAdmin(), (req, res) => {
  const suspiciousPatternDetector = require('../utils/suspiciousPatternDetector');

  res.json({
    success: true,
    data: suspiciousPatternDetector.getMetrics(),
    timestamp: new Date().toISOString()
  });
});

// Idempotency stats endpoint (admin only)
app.get('/admin/idempotency/stats', require('../middleware/rbac').requireAdmin(), async (req, res) => {
  try {
    const IdempotencyService = require('../services/IdempotencyService');
    const stats = await IdempotencyService.getStats();
    const oldest = await require('../utils/database').get(
      `SELECT MIN(createdAt) as oldest FROM idempotency_keys WHERE datetime(expiresAt) > datetime('now')`
    );
    return res.json({
      success: true,
      data: {
        ...stats,
        oldestActiveKeyAge: oldest && oldest.oldest
          ? Math.floor((Date.now() - new Date(oldest.oldest).getTime()) / 1000)
          : null,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: { message: err.message } });
  }
});

// Replay detection stats endpoint (admin only)
app.get('/admin/replay-stats', require('../middleware/rbac').requireAdmin(), (req, res) => {
  try {
    const replayDetectionMiddleware = require('../middleware/replayDetection');
    const replayConfig = require('../config/replayDetection');
    
    // Get stats from tracking store with config for complete information
    const stats = replayDetectionMiddleware.trackingStore.getStats({
      windowSeconds: replayConfig.windowSeconds,
      threshold: replayConfig.threshold
    });
    
    res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    log.error('ADMIN', 'Failed to retrieve replay stats', {
      error: error.message,
      stack: error.stack
    });
    
    res.status(500).json({
      success: false,
      error: {
        code: 'REPLAY_STATS_ERROR',
        message: 'Failed to retrieve replay statistics'
      },
      timestamp: new Date().toISOString()
    });
  }
});

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
  log.error('APP', 'Unhandled promise rejection', {
    reason,
    promise,
    timestamp: new Date().toISOString()
  });
});

const PORT = config.server.port;

async function startServer() {
  try {
    await logStartupDiagnostics();
    await Database.initialize();
    await initializeApiKeysTable();
    
    // Initialize feature flags table
    const { initializeFeatureFlagsTable, loadFlagsFromEnv } = require('../utils/featureFlags');
    await initializeFeatureFlagsTable();
    if (process.env.FEATURE_FLAGS) {
      await loadFlagsFromEnv(process.env.FEATURE_FLAGS);
    }
    
    await WebhookService.initTable();
    await validateRBAC();

    const server = app.listen(PORT, async () => {
      // Attach GraphQL WebSocket subscription server
      attachSubscriptionServer(server);

      recurringDonationScheduler.start();
      reconciliationService.start();
      auditLogRetentionService.start();
      
      // Start quota reset job
      const stopQuotaResetJob = startQuotaResetJob();
      server.stopQuotaResetJob = stopQuotaResetJob;

      runCleanup(); // Run once on startup
    const cleanupInterval = setInterval(runCleanup, 24 * 60 * 60 * 1000);
      
      // Initialize and start network status monitoring
      try {
        await networkStatusService.initialize();
      } catch (err) {
        log.error('APP', 'Failed to initialize NetworkStatusService', {
          error: err.message,
        });
      }

      const { startCleanup } = require('../utils/replayDetector');
      const replayConfig = require('../config/replayDetection');
      replayCleanupTimer = startCleanup(replayDetectionMiddleware.trackingStore, replayConfig);

      // Initialize Leaderboard SSE for real-time updates
      try {
        const LeaderboardSSE = require('../services/LeaderboardSSE');
        LeaderboardSSE.initLeaderboardSSE();
      } catch (err) {
        log.error('APP', 'Failed to initialize LeaderboardSSE', {
          error: err.message,
        });
      }

      log.info('APP', 'API started', {
        port: PORT,
        network: config.network,
        healthCheck: `http://localhost:${PORT}/health`
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
    });

    const gracefulShutdown = async (signal) => {
      if (isShuttingDown) return;
      isShuttingDown = true;
      log.info("SHUTDOWN", `Received ${signal}, starting graceful shutdown`);
      logShutdownDiagnostics(signal);

      clearInterval(cleanupInterval); // Stop the timer so the process can exit

      const timeoutMs = parseInt(process.env.SHUTDOWN_TIMEOUT || '30000', 10);
      const forceExit = setTimeout(() => {
        log.error("SHUTDOWN", `Forced shutdown after ${timeoutMs}ms timeout`);
        process.exit(1);
      }, timeoutMs);

      server.close(async () => {
        log.info("SHUTDOWN", "HTTP server closed to new connections");

        const waitInterval = setInterval(async () => {
          if (inFlightRequests > 0) {
            log.info("SHUTDOWN", `Waiting for ${inFlightRequests} in-flight requests to complete...`);
            return;
          }
          
          clearInterval(waitInterval);
          clearTimeout(forceExit);
          log.info("SHUTDOWN", "All in-flight requests completed.");

          recurringDonationScheduler.stop();
          reconciliationService.stop();
          auditLogRetentionService.stop();
          
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
        }, 500);
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
