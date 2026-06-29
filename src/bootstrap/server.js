/**
 * Server lifecycle bootstrap.
 *
 * startServer(app) binds the HTTP port, runs DB migrations, starts all
 * background services, and registers hardened SIGTERM/SIGINT handlers.
 *
 * Shutdown hardening (#1089):
 *  - Tracks every open TCP socket; idle keep-alive sockets are destroyed
 *    immediately when shutdown begins so server.close() resolves quickly.
 *  - SSE streams receive a terminal server_shutdown event before the socket
 *    is closed (via sseManager.terminateAll).
 *  - Handler is idempotent — repeated signals are no-ops after the first.
 *  - Hard-timeout (SHUTDOWN_TIMEOUT_MS, default 30 s) forces exit and logs
 *    exactly which requests were still pending.
 *  - Shutdown drain order:
 *      1. Set isShuttingDown flag (503 gate active)
 *      2. Terminate SSE streams
 *      3. Destroy idle keep-alive sockets
 *      4. server.close() — stop accepting new TCP connections
 *      5. Wait for in-flight requests to complete
 *      6. Flush webhooks
 *      7. Stop schedulers (stopGracefully — waits for in-progress ticks)
 *      8. Stop remaining background services
 *      9. WAL checkpoint + flush audit log
 *     10. Close DB pool
 *     11. process.exit(0)
 */

'use strict';

const config = require('../config');
const stellarConfig = require('../config/stellar');
const serviceContainer = require('../config/serviceContainer');
const { attachSubscriptionServer } = require('../graphql');
const sseManager = require('../services/SseManager');
const { initializeApiKeysTable } = require('../models/apiKeys');
const { initializeDefaultStore } = require('../utils/nonceStore');
const WebhookService = require('../services/WebhookService');
const { validateRBAC } = require('../utils/rbacValidator');
const DonationExportService = require('../services/DonationExportService');
const AuditLogService = require('../services/AuditLogService');
const auditLogRetentionService = require('../services/AuditLogRetentionService');
const retentionService = require('../services/RetentionService');
const Database = require('../utils/database');
const { startQuotaResetJob } = require('../jobs/quotaResetJob');
const { runCleanup } = require('../jobs/cleanupJob');
const reconcileTotalsJob = require('../jobs/reconcileTotalsJob');
const { logStartupDiagnostics, logShutdownDiagnostics } = require('../utils/startupDiagnostics');
const replayDetectionMiddleware = require('../middleware/replayDetection');
const log = require('../utils/log');
const state = require('./state');
const timerRegistry = require('../utils/timerRegistry');

const PORT = config.server.port;

/**
 * Start the HTTP server, initialise all subsystems, and register shutdown handlers.
 *
 * @param {import('express').Application} app - Fully-wired Express app (from createApp)
 * @param {object} [overrideServices] - Optional service overrides for testing
 * @returns {Promise<import('http').Server>}
 */
async function startServer(app, overrideServices = {}) {
  try {
    // ── Service container ────────────────────────────────────────────────────
    const stellarService = overrideServices.stellarService || serviceContainer.getStellarService();
    const reconciliationService = overrideServices.reconciliationService || serviceContainer.getTransactionReconciliationService();
    const recurringDonationScheduler = overrideServices.recurringDonationScheduler || serviceContainer.getRecurringDonationScheduler();
    const networkStatusService = overrideServices.networkStatusService || serviceContainer.getNetworkStatusService();
    const transactionSyncScheduler = overrideServices.transactionSyncScheduler || serviceContainer.getTransactionSyncScheduler();

    // Wire network status service into the network route (must happen before requests)
    const { setService: setNetworkService } = require('../routes/network');
    setNetworkService(networkStatusService);

    // Wire health-check dependencies into routes (routes.js reads services from here)
    app._services = { stellarService, networkStatusService, recurringDonationScheduler, transactionSyncScheduler, reconciliationService };

    await logStartupDiagnostics();

    // ── #714: Bind port immediately so /health/live responds right away ───────
    const server = app.listen(PORT);

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

    // ── Socket tracking for keep-alive drain (#1089) ──────────────────────────
    const openSockets = new Set();
    const busySockets = new WeakSet();

    server.on('connection', (socket) => {
      openSockets.add(socket);
      socket.on('close', () => openSockets.delete(socket));
    });

    // Mark sockets busy while a request is in-flight so we only destroy idle ones
    app.use((req, res, next) => {
      busySockets.add(req.socket);
      const done = () => {
        busySockets.delete(req.socket);
        if (state.isShuttingDown) req.socket.destroy();
      };
      res.on('finish', done);
      res.on('close', done);
      next();
    });

    // Attach WebSocket servers immediately after bind
    attachSubscriptionServer(server);
    require('../services/websocketService').attach(server);

    let cleanupInterval = null;
    let replayCleanupTimer = null;

    // ── Async initialisation after port is bound ───────────────────────────────
    // /health/ready returns false until this block completes.
    setImmediate(async () => {
      try {
        const { runMigrations } = require('../utils/migrationRunner');
        await runMigrations();
        await initializeApiKeysTable();
        initializeDefaultStore(Database);

        const { initializeFeatureFlagsTable, loadFlagsFromEnv } = require('../utils/featureFlags');
        await initializeFeatureFlagsTable();
        if (process.env.FEATURE_FLAGS) {
          await loadFlagsFromEnv(process.env.FEATURE_FLAGS);
        }

        await WebhookService.WebhookService.initTable();
        await validateRBAC();
        await DonationExportService.initialize();
        AuditLogService.startAutoFlush();

        // Verify Horizon connectivity before marking as ready
        // This ensures the service doesn't accept traffic that depends on Horizon
        const isMockStellar = process.env.USE_MOCK_STELLAR === 'true' || process.env.MOCK_STELLAR === 'true';
        if (!isMockStellar && stellarService.server && typeof stellarService.server.root === 'function') {
          try {
            await Promise.race([
              stellarService.server.root(),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Horizon root endpoint timed out')), 15000)
              ),
            ]);
            log.info('STARTUP', 'Horizon connectivity verified');
          } catch (horizonErr) {
            log.error('STARTUP', 'Horizon connectivity check failed', { error: horizonErr.message });
            state.initializationError = `Horizon unreachable: ${horizonErr.message}`;
            process.exit(1);
          }
        }

        // Start background cache cleanup timers
        const Cache = require('../utils/cache');
        Cache.startCleanup();
        const { startMemCacheCleanup } = require('../middleware/deduplication');
        startMemCacheCleanup();
        const { startCacheCleanup: startFedCacheCleanup } = require('../utils/federation');
        startFedCacheCleanup();

        if (process.env.NODE_ENV !== 'test') {
          const stopQuotaResetJob = startQuotaResetJob();
          server.stopQuotaResetJob = stopQuotaResetJob;

          require('../workers/expiryWorker').start();
          recurringDonationScheduler.start();
          reconciliationService.start();
          auditLogRetentionService.start();
          retentionService.start();
          transactionSyncScheduler.start();
          sseManager.start();

          runCleanup();
          cleanupInterval = timerRegistry.createInterval(runCleanup, 24 * 60 * 60 * 1000, 'cleanup-job');
          cleanupInterval.unref();

          reconcileTotalsJob.start();

          // Load persisted circuit-breaker state and start cross-instance sync
          if (stellarService.circuitBreaker) {
            await stellarService.circuitBreaker.loadState();
            stellarService.circuitBreaker.startSync();
          }
        }

        networkStatusService.on('network.degraded', (status) => {
          log.warn('NETWORK_STATUS', 'Network status degraded', { status });
        });
        try {
          networkStatusService.start();
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

        // Mark as fully initialized — readiness checks will now return healthy
        state.isInitialized = true;
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
        state.initializationError = initErr.message;
        log.error('APP', 'Background initialization failed', { error: initErr.message });
        process.exit(1);
      }
    });

    // ── Graceful shutdown handler (#1089) ────────────────────────────────────
    const gracefulShutdown = async (signal) => {
      // Idempotent: repeated signals are no-ops
      if (state.isShuttingDown) return;
      state.isShuttingDown = true;

      log.info('SHUTDOWN', `Received ${signal}, starting graceful shutdown`);
      logShutdownDiagnostics(signal);

      // Clear all registered background timers (cleanupInterval, replayCleanupTimer, service intervals)
      timerRegistry.clearAll();

      const timeoutMs = parseInt(
        process.env.SHUTDOWN_TIMEOUT_MS || process.env.SHUTDOWN_TIMEOUT || '30000',
        10
      );

      let forcedExit = false;
      // eslint-disable-next-line local/no-bare-timers
      const forceExitTimer = setTimeout(() => {
        forcedExit = true;
        log.error('SHUTDOWN', `Forced shutdown after ${timeoutMs}ms timeout`, {
          abandonedRequests: state.inFlightRequests,
          openSockets: openSockets.size,
        });
        process.exit(1);
      }, timeoutMs);
      // Unref so this timer alone does not keep the process alive
      if (forceExitTimer.unref) forceExitTimer.unref();

      // 1. Terminate all open SSE streams with a terminal event
      try {
        const terminated = sseManager.terminateAll('server_shutdown');
        if (terminated > 0) log.info('SHUTDOWN', `Terminated ${terminated} SSE connection(s)`);
      } catch (err) {
        log.error('SHUTDOWN', 'Error terminating SSE connections', { error: err.message });
      }

      // 2. Destroy idle keep-alive sockets so server.close() can resolve
      for (const socket of openSockets) {
        if (!busySockets.has(socket)) {
          socket.destroy();
        }
      }

      // 3. Stop accepting new connections; wait for active ones to finish
      server.close(async () => {
        log.info('SHUTDOWN', 'HTTP server closed to new connections');

        // 4. Wait for all in-flight requests to drain
        await new Promise((resolve) => {
          // eslint-disable-next-line local/no-bare-timers
          const waitInterval = setInterval(() => {
            if (forcedExit) { clearInterval(waitInterval); return resolve(); } // eslint-disable-line local/no-bare-timers
            if (state.inFlightRequests > 0) {
              log.info('SHUTDOWN', `Waiting for ${state.inFlightRequests} in-flight request(s)…`);
              return;
            }
            clearInterval(waitInterval); // eslint-disable-line local/no-bare-timers
            log.info('SHUTDOWN', 'All in-flight requests completed.');
            resolve();
          }, 500);
        });

        if (forcedExit) return;

        // 5. Flush pending webhook deliveries
        try {
          if (typeof WebhookService.flushPending === 'function') {
            await WebhookService.flushPending();
          }
          log.info('SHUTDOWN', 'Webhooks flushed');
        } catch (err) {
          log.error('SHUTDOWN', 'Error flushing webhooks', { error: err.message });
        }

        // 6. Stop recurring donation scheduler (waits for in-progress Stellar submissions)
        try {
          const schedulerResult = await recurringDonationScheduler.stopGracefully(timeoutMs);
          log.info('SHUTDOWN', 'Recurring donation scheduler stopped', {
            waited: schedulerResult?.waited ?? 0,
            interrupted: schedulerResult?.interrupted ?? 0,
          });
        } catch (err) {
          log.error('SHUTDOWN', 'Error stopping recurring donation scheduler', { error: err.message });
        }

        clearTimeout(forceExitTimer);

        // 7. Stop remaining background services
        reconciliationService.stop();
        auditLogRetentionService.stop();
        retentionService.stop();
        transactionSyncScheduler.stop();
        require('../workers/expiryWorker').stop();

        if (server.stopQuotaResetJob) {
          server.stopQuotaResetJob();
          log.info('SHUTDOWN', 'Quota reset job stopped');
        }

        try {
          networkStatusService.stop();
        } catch (err) {
          log.error('SHUTDOWN', 'Error shutting down NetworkStatusService', { error: err.message });
        }

        // Stop circuit-breaker DB sync (timerRegistry already cleared the handle,
        // but call stopSync() so the reference is nulled out cleanly)
        if (stellarService.circuitBreaker) {
          stellarService.circuitBreaker.stopSync();
        }

        // 8. Checkpoint SQLite WAL (must happen before DB close, after all writes)
        try {
          await Database.run('PRAGMA wal_checkpoint(TRUNCATE)');
          log.info('SHUTDOWN', 'SQLite WAL checkpoint completed');
        } catch (err) {
          log.warn('SHUTDOWN', 'Error checkpointing WAL', { error: err.message });
        }

        // 9. Flush pending audit log entries (must be before DB close)
        try {
          await AuditLogService.flush();
          AuditLogService.stopAutoFlush();
          log.info('SHUTDOWN', 'Audit log buffer flushed');
        } catch (err) {
          log.error('SHUTDOWN', 'Error flushing audit log buffer', { error: err.message });
        }

        // 10. Close DB pool (last — nothing else writes after this)
        await Database.close();
        log.info('SHUTDOWN', 'Database pool closed');

        log.info('SHUTDOWN', 'Graceful shutdown complete.');
        process.exit(0);
      });
    };

    // Register signal handlers exactly once
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    return server;
  } catch (error) {
    log.error('APP', 'Failed to start server', { error: error.message });
    process.exit(1);
  }
}

module.exports = { startServer };
