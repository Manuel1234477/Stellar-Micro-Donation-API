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
const recurringDonationScheduler = require('../services/RecurringDonationScheduler');
const NetworkStatusService = require('../services/NetworkStatusService');
const { router: networkRoutes, setService: setNetworkService } = require('./network');
const docsRoutes = require('./docs');
const transactionRoutes = require('./transaction');
const sseManager = require('../services/SseManager');
const { router: corporateMatchingRoutes } = require('./corporateMatching');
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
app.use('/docs', docsRoutes);
app.use('/transactions', transactionRoutes);
app.use('/', corporateMatchingRoutes);
app.use('/claimable-balances', claimableBalancesRoutes);

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
  health.transactionSync = transactionSyncScheduler.getSyncStatus();
  
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

const PORT = config.port;
app.listen(PORT, () => {
  console.log(`Stellar Micro-Donation API running on port ${PORT}`);
  console.log(`Network: ${config.network}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  
  // Start the recurring donation scheduler
  recurringDonationScheduler.start();

  // Start SSE manager heartbeat
  sseManager.start();

  // Start network status monitoring
  const networkStatusService = new NetworkStatusService({ horizonUrl: config.horizonUrl });
  networkStatusService.on('network.degraded', (status) => {
    console.warn('[NetworkStatus] network.degraded event:', JSON.stringify(status));
  });
  setNetworkService(networkStatusService);
  networkStatusService.start();
});

const PORT = config.server.port;
let cleanupInterval = null;

async function startServer() {
  try {
    await logStartupDiagnostics();
    const { runMigrations } = require('../utils/migrationRunner');
    await runMigrations();
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

      // Attach real-time balance streaming WebSocket
      require('../services/websocketService').attach(server);

      // Start pledge expiry worker
      require('../workers/expiryWorker').start();

      recurringDonationScheduler.start();
      reconciliationService.start();
      auditLogRetentionService.start();
      transactionSyncScheduler.start();
      
      // Start quota reset job
      const stopQuotaResetJob = startQuotaResetJob();
      server.stopQuotaResetJob = stopQuotaResetJob;

      runCleanup(); // Run once on startup
      cleanupInterval = setInterval(runCleanup, 24 * 60 * 60 * 1000);
      
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
