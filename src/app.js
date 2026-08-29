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

process.on('unhandledRejection', (reason) => {
  log.error('APP', 'Unhandled promise rejection', {
    message: reason?.message || String(reason),
    stack: reason?.stack,
    name: reason?.name,
    code: reason?.code,
    timestamp: new Date().toISOString(),
  });
});

process.on('uncaughtException', (error) => {
  log.error('APP', 'Uncaught exception', {
    message: error?.message || String(error),
    stack: error?.stack,
    name: error?.name,
    code: error?.code,
    timestamp: new Date().toISOString(),
  });
  process.exit(1);
});

if (require.main === module) {
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
