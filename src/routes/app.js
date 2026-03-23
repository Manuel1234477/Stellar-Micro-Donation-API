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
const config = require('../config');
const stellarConfig = require('../config/stellar');
const donationRoutes = require('./donation');
const walletRoutes = require('./wallet');
const statsRoutes = require('./stats');
const streamRoutes = require('./stream');
const transactionRoutes = require('./transaction');
const apiKeysRoutes = require('./apiKeys');
const feesRoutes = require('./fees');
const { errorHandler, notFoundHandler } = require('../middleware/errorHandler');
const logger = require('../middleware/logger');
const { attachUserRole } = require('../middleware/rbac');
const abuseDetectionMiddleware = require('../middleware/abuseDetection');
const replayDetectionMiddleware = require('../middleware/replayDetection');
const Database = require('../utils/database');
const HealthCheckService = require('../services/HealthCheckService');
const { initializeApiKeysTable } = require('../models/apiKeys');
const { validateRBAC } = require('../utils/rbacValidator');
const log = require('../utils/log');
const requestId = require('../middleware/requestId');
const serviceContainer = require('../config/serviceContainer');
const { payloadSizeLimiter } = require('../middleware/payloadSizeLimit');
const { createCorsMiddleware } = require('../middleware/cors');
const {
  logStartupDiagnostics,
  logShutdownDiagnostics,
} = require("../utils/startupDiagnostics");

const app = express();

// Initialize services from container
const stellarService = serviceContainer.getStellarService();
const reconciliationService = serviceContainer.getTransactionReconciliationService();
const recurringDonationScheduler = serviceContainer.getRecurringDonationScheduler();

// Initialize replay detection cleanup timer (will be started in startServer)
let replayCleanupTimer = null;

// Middleware
app.use(requestId);

// CORS (must be before body parsers and route handlers)
app.use(createCorsMiddleware());

// Payload size limit (must be before body parsers)
app.use(payloadSizeLimiter);

app.use(express.json());
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

// Routes
app.use('/wallets', walletRoutes);
app.use('/donations', donationRoutes);
app.use('/stats', statsRoutes);
app.use('/stream', streamRoutes);
app.use('/transactions', transactionRoutes);
app.use('/api-keys', apiKeysRoutes);
app.use('/fees', feesRoutes);

// Health check endpoints
app.get('/health', async (req, res) => {
  const health = await HealthCheckService.getFullHealth(stellarService);
  const httpStatus = health.status === 'unhealthy' ? 503 : 200;
  return res.status(httpStatus).json(health);
});

// Liveness probe — returns 200 as long as the process is running
app.get('/health/live', (req, res) => {
  return res.status(200).json(HealthCheckService.getLiveness());
});

// Readiness probe — returns 200 only when all dependencies are healthy
app.get('/health/ready', async (req, res) => {
  const readiness = await HealthCheckService.getReadiness(stellarService);
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
    await validateRBAC();

    const server = app.listen(PORT, () => {
      recurringDonationScheduler.start();
      reconciliationService.start();

      const { startCleanup } = require('../utils/replayDetector');
      const replayConfig = require('../config/replayDetection');
      replayCleanupTimer = startCleanup(replayDetectionMiddleware.trackingStore, replayConfig);

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
      logShutdownDiagnostics(signal);

      server.close(() => {
        log.info("SHUTDOWN", "HTTP server closed");
        recurringDonationScheduler.stop();
        reconciliationService.stop();

        if (replayCleanupTimer) {
          clearInterval(replayCleanupTimer);
          log.info("SHUTDOWN", "Replay detection cleanup timer stopped");
        }

        process.exit(0);
      });

      setTimeout(() => {
        log.error("SHUTDOWN", "Forced shutdown after timeout");
        process.exit(1);
      }, 10000);
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
