'use strict';

/**
 * Health Route Handlers
 *
 * Full health, liveness and readiness handlers. They depend on service
 * instances resolved at startup, so this module exports a factory instead of
 * a router; src/bootstrap/routes.js mounts the handlers (#1780).
 */

const asyncHandler = require('../utils/asyncHandler');
const log = require('../utils/log');
const HealthCheckService = require('../services/HealthCheckService');
const state = require('../bootstrap/state');

/**
 * Build the health handlers for the given services.
 *
 * @param {object} services
 * @param {object} [services.stellarService]
 * @param {object} [services.networkStatusService]
 * @param {object} [services.recurringDonationScheduler]
 * @param {object} [services.transactionSyncScheduler]
 * @param {object} [services.serviceAccountBalanceMonitor]
 * @returns {{ health: Function, live: Function, ready: Function }}
 */
function createHealthHandlers(services = {}) {
  const {
    stellarService,
    networkStatusService,
    recurringDonationScheduler,
    transactionSyncScheduler,
    serviceAccountBalanceMonitor,
  } = services;

  const health = asyncHandler(async (req, res) => {
    try {
      const isAdmin = req.apiKey?.role === 'admin' || req.user?.role === 'admin';
      const verbose = req.query.verbose === 'true' && isAdmin;
      const isProduction = process.env.NODE_ENV === 'production';
      const shouldMinimize = isProduction && !isAdmin;

      const result = await HealthCheckService.getFullHealth(
        stellarService,
        networkStatusService,
        recurringDonationScheduler,
        verbose && !shouldMinimize
      );

      if (shouldMinimize) {
        return res.status(result.status === 'healthy' ? 200 : 503).json({
          status: result.status,
          timestamp: result.timestamp,
        });
      }

      result.stellarEnvironment = require('../config/stellar').environment || 'testnet';
      result.stellarNetwork = require('../config/stellar').network || 'testnet';
      result.requestId = req.id;
      if (transactionSyncScheduler) {
        result.transactionSync = transactionSyncScheduler.getSyncStatus();
      }
      if (serviceAccountBalanceMonitor) {
        result.serviceAccountBalance = serviceAccountBalanceMonitor.getStatus();
      }
      return res.status(result.status === 'healthy' ? 200 : 503).json(result);
    } catch (err) {
      log.error('HEALTH', 'Health check failed', { error: err.message });
      return res.status(503).json({
        success: false,
        status: 'unhealthy',
        error: { code: 'HEALTH_CHECK_ERROR', message: 'Health check failed' },
      });
    }
  });

  // Liveness probe — process-only, no dependency checks.
  const live = (req, res) => res.status(200).json(HealthCheckService.getLiveness());

  const ready = asyncHandler(async (req, res) => {
    if (state.isShuttingDown) {
      return res.status(503).json({ status: 'not_ready', reason: 'server is shutting down' });
    }
    if (!state.isInitialized) {
      const initErr = state.initializationError;
      return res.status(503).json({
        status: 'not_ready',
        reason: initErr ? `initialization failed: ${initErr}` : 'server still initializing',
      });
    }
    const donationStore = require('../models/transaction').getStoreStatus();
    if (!donationStore.loaded) {
      return res.status(503).json({
        status: 'not_ready',
        reason: donationStore.error
          ? `donation store failed to load: ${donationStore.error}`
          : 'donation store not loaded',
      });
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
  });

  return { health, live, ready };
}

module.exports = { createHealthHandlers };
