/**
 * Application Entry Point
 *
 * createApp() returns a fully-wired Express app with all middleware and routes
 * applied but NO HTTP listener and NO background schedulers started.
 *
 * Production startup lives in bootstrap/server.js and is only executed when
 * this file is the process entry point (require.main === module).
 */

'use strict';

const express = require('express');
const { applyMiddleware } = require('./bootstrap/middleware');
const { mountRoutes } = require('./bootstrap/routes');
const serviceContainer = require('./config/serviceContainer');

/**
 * Build and return a fully-wired Express application.
 * Safe to call in tests — no timers, listeners, or schedulers are created.
 *
 * @returns {import('express').Application}
 */
function createApp() {
  const app = express();

  const trustedProxies = process.env.TRUSTED_PROXIES
    ? process.env.TRUSTED_PROXIES.split(',').map(ip => ip.trim())
    : 'loopback';
  app.set('trust proxy', trustedProxies);

  const stellarService = serviceContainer.getStellarService();
  const reconciliationService = serviceContainer.getTransactionReconciliationService();
  const recurringDonationScheduler = serviceContainer.getRecurringDonationScheduler();
  const networkStatusService = serviceContainer.getNetworkStatusService();
  const transactionSyncScheduler = serviceContainer.getTransactionSyncScheduler();
  const feeBumpService = serviceContainer.getFeeBumpService();
  const serviceAccountBalanceMonitor = serviceContainer.getServiceAccountBalanceMonitor();

  const { setService: setNetworkService } = require('./routes/network');
  setNetworkService(networkStatusService);

  applyMiddleware(app);

  mountRoutes(app, {
    stellarService,
    reconciliationService,
    recurringDonationScheduler,
    networkStatusService,
    transactionSyncScheduler,
    feeBumpService,
    serviceAccountBalanceMonitor,
  });

  return app;
}

const app = createApp();

const log = require('./utils/log');

// #1928: Process-level error handlers are registered ONLY in the production
// entry point (require.main === module), not at module load.  When app.js is
// merely required (e.g. by tests), registering these handlers overrides Node's
// default behaviour and changes Jest's unhandled-rejection semantics, causing
// failures to be swallowed.
//
// Both unhandledRejection and uncaughtException are now treated symmetrically:
// log with full context, increment the Prometheus counter, flip readiness to
// failing, trigger graceful shutdown, and exit non-zero so the orchestrator
// restarts the pod.  A rejected promise that nobody handles usually means an
// operation was half-done (DB transaction left open, Stellar submission whose
// result was never recorded), so continuing to serve traffic risks corrupted
// state.
if (require.main === module) {
  const { processUnhandledRejectionsTotal } = require('./utils/metrics');
  const state = require('./bootstrap/state');

  const handleFatalError = (type, reasonOrError) => {
    const err = reasonOrError instanceof Error ? reasonOrError : { message: String(reasonOrError) };
    try {
      processUnhandledRejectionsTotal.inc();
    } catch (_) { /* best-effort — registry may not be ready */ }

    log.error('APP', type, {
      message: err?.message || String(err),
      stack: err?.stack,
      name: err?.name,
      code: err?.code,
      timestamp: new Date().toISOString(),
    });

    // Flip readiness so the orchestrator stops sending traffic immediately.
    state.isShuttingDown = true;
    state.initializationError = type;

    // Trigger graceful shutdown if the server has been started, otherwise
    // exit directly.  startServer() registers its own SIGTERM/SIGINT handlers
    // that drain in-flight requests, flush webhooks, checkpoint the DB, etc.
    // We simulate a SIGTERM to reuse that path.  A hard 5-second fallback
    // ensures we never hang if the graceful shutdown listener is not attached
    // or stalls.
    const hardExit = setTimeout(() => process.exit(1), 5000);
    if (hardExit.unref) hardExit.unref();
    try {
      process.emit('SIGTERM', 'SIGTERM');
    } catch (_) {
      clearTimeout(hardExit);
      process.exit(1);
    }
  };

  process.on('unhandledRejection', (reason) => {
    handleFatalError('Unhandled promise rejection', reason);
  });

  process.on('uncaughtException', (error) => {
    handleFatalError('Uncaught exception', error);
  });

  const boot = () => require('./bootstrap/server').startServer(app);

  // #1234: fail fast on misconfiguration before binding the port. `run()` calls
  // process.exit(1) itself when any hard-required check fails, so startServer
  // only runs once every check has passed. Test mode skips the gate, matching
  // the config layer (src/config/index.js) which skips validation for tests.
  if ((process.env.NODE_ENV || '').toLowerCase() === 'test') {
    boot();
  } else {
    require('./utils/startupChecks')
      .run({ exitOnFailure: true })
      .then(boot)
      .catch((err) => {
        log.error('STARTUP', 'Startup checks threw an unexpected error', {
          error: err && err.message ? err.message : String(err),
        });
        process.exit(1);
      });
  }
}

module.exports = app;
module.exports.createApp = createApp;
