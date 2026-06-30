/**
 * Middleware bootstrap.
 * Applies every Express middleware in its required order.
 * No HTTP server is created here; no background services are started.
 *
 * ORDER IS LOAD-BEARING — do not reorder without updating the middleware
 * snapshot test (pagination.snapshot.test.js).
 */

'use strict';

const helmet = require('helmet');
const StellarSdk = require('stellar-sdk');
const { createCorsMiddleware } = require('../middleware/cors');
const { createPathBasedCspMiddleware, cspReportRouter } = require('../middleware/csp');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../middleware/payloadSizeLimiter');
const { responseFormatterMiddleware } = require('../utils/responseFormatter');
const requestId = require('../middleware/requestId');
const { attachLifecycleTracking } = require('../middleware/requestLifecycle');
const logger = require('../middleware/logger');
const { attachUserRole, requireAdmin } = require('../middleware/rbac');
const abuseDetectionMiddleware = require('../middleware/abuseDetection');
const replayDetectionMiddleware = require('../middleware/replayDetection');
const { createRequestSigningMiddleware } = require('../middleware/requestSigning');
const trackQuotaUsage = require('../middleware/quotaTracker');
const { metricsMiddleware, registry } = require('../utils/metrics');
const { createDeduplicationMiddleware } = require('../middleware/deduplication');
const { fieldFilterMiddleware } = require('../middleware/fieldFilter');
const { requestTimeout, TIMEOUTS } = require('../middleware/requestTimeout');
const apiVersionMiddleware = require('../middleware/apiVersion');
const requireApiKey = require('../middleware/apiKey');
const { validatePayloadFields } = require('../middleware/validation');
const asyncHandler = require('../utils/asyncHandler');
const log = require('../utils/log');
const requestCounter = require('../utils/requestCounter');
const state = require('./state');

const STREAMING_PATH_RE = /\/(stream|sse|events|ws|websocket|subscribe)(\/|$)/i;

/**
 * Apply all middleware to the given Express app.
 * Must be called exactly once, before mountRoutes().
 *
 * @param {import('express').Application} app
 */
function applyMiddleware(app) {
  // ─── In-flight request tracking + graceful shutdown gate ─────────────────────
  // Placed first so every request (including health probes) goes through it.
  app.use((req, res, next) => {
    if (state.isShuttingDown) {
      if (req.path.startsWith('/health')) return next();
      res.set('Connection', 'close');
      return res.status(503).json({
        success: false,
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Server is shutting down' },
      });
    }

    state.inFlightRequests++;
    requestCounter.increment();
    let handled = false;
    const decrement = () => {
      if (!handled) {
        handled = true;
        state.inFlightRequests--;
        requestCounter.decrement();
      }
    };
    res.on('finish', decrement);
    res.on('close', decrement);
    next();
  });

  // ─── Request identity & lifecycle ────────────────────────────────────────────
  app.use(requestId);
  app.use(attachLifecycleTracking);
  app.use(responseFormatterMiddleware());

  // ─── Security headers ────────────────────────────────────────────────────────
  // contentSecurityPolicy disabled here — owned by createPathBasedCspMiddleware below
  app.use(helmet({
    contentSecurityPolicy: false,
    frameguard: { action: 'deny' },
    noSniff: true,
    referrerPolicy: { policy: 'no-referrer' },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    xssFilter: false,
    hidePoweredBy: true,
  }));

  // ─── CORS must be before body parsers and route handlers ─────────────────────
  app.use(createCorsMiddleware());

  // ─── CSP: strict for API routes, relaxed for Swagger UI (Issue #757) ─────────
  app.use(createPathBasedCspMiddleware());
  app.use(cspReportRouter);

  // ─── Early security — before body parsers ────────────────────────────────────
  app.use(require('../middleware/geoBlock'));
  app.use(payloadSizeLimiter());

  // ─── Body parsers ────────────────────────────────────────────────────────────
  const express = require('express');
  app.use(express.json({
    verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); },
  }));
  app.use(express.urlencoded({ extended: true }));

  // ─── Post-parse security ─────────────────────────────────────────────────────
  app.use(require('../middleware/blockCheck'));

  // ─── Logging & observability ─────────────────────────────────────────────────
  app.use(logger.middleware());
  app.use(require('../middleware/accessLog')());
  app.use(abuseDetectionMiddleware);
  app.use(replayDetectionMiddleware);
  app.use(require('../middleware/suspiciousPatternDetection'));

  // ─── Authentication & authorisation ──────────────────────────────────────────
  app.use(attachUserRole());
  app.use(createRequestSigningMiddleware());
  app.use(trackQuotaUsage);

  // ─── Metrics ─────────────────────────────────────────────────────────────────
  app.use(metricsMiddleware);
  app.get('/metrics', requireApiKey, requireAdmin(), asyncHandler(async (req, res) => {
    try {
      res.set('Content-Type', registry.contentType);
      res.end(await registry.metrics());
    } catch (err) {
      log.error('METRICS', 'Failed to generate metrics', { error: err.message });
      res.status(503).json({
        success: false,
        error: { code: 'METRICS_ERROR', message: 'Failed to generate metrics' },
      });
    }
  }));

  // ─── Deduplication & field filtering ─────────────────────────────────────────
  app.use(createDeduplicationMiddleware());
  app.use(fieldFilterMiddleware());

  // ─── Global request timeout (exempt streaming endpoints) ─────────────────────
  // Health checks get their own tight budget (TIMEOUTS.health); everything else
  // falls back to the configured global timeout unless a route sets its own
  // explicit, tighter requestTimeout() (e.g. donation submission, balance
  // lookups, exports — see those route files).
  const GLOBAL_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS, 10) || TIMEOUTS.donation;
  app.use((req, res, next) => {
    if (STREAMING_PATH_RE.test(req.path)) return next();
    if (req.path.startsWith('/health') || req.path.startsWith('/api/v1/health')) {
      return requestTimeout(TIMEOUTS.health)(req, res, next);
    }
    return requestTimeout(GLOBAL_TIMEOUT_MS)(req, res, next);
  });

  // ─── Mass-assignment protection: reject unknown fields on registered routes ───
  app.use(validatePayloadFields);

  // ─── Schema version negotiation ──────────────────────────────────────────────
  app.use(apiVersionMiddleware);
}

module.exports = { applyMiddleware };
