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
const { createCorsMiddleware } = require('../middleware/cors');
const { createPathBasedCspMiddleware, cspReportRouter } = require('../middleware/csp');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../middleware/payloadSizeLimiter');
const { responseFormatterMiddleware } = require('../utils/responseFormatter');
const requestId = require('../middleware/requestId');
const errorEnvelopeMiddleware = require('../middleware/errorEnvelope');
const { attachLifecycleTracking } = require('../middleware/requestLifecycle');
const logger = require('../middleware/logger');
const { attachUserRole, requireAdmin } = require('../middleware/rbac');
const abuseDetectionMiddleware = require('../middleware/abuseDetection');
const replayDetectionMiddleware = require('../middleware/replayDetection');
const { createRequestSigningMiddleware } = require('../middleware/requestSigning');
const trackQuotaUsage = require('../middleware/quotaTracker');
const { metricsMiddleware, registry } = require('../utils/metrics');
const { createDeduplicationMiddleware } = require('../middleware/deduplication');
const { createCompressionMiddleware } = require('../middleware/compression');
const { fieldFilterMiddleware } = require('../middleware/fieldFilter');
const { requestTimeout, resolveRouteTimeout, TIMEOUTS } = require('../middleware/requestTimeout');
const schemaVersionMiddleware = require('../middleware/schemaVersion');
const requireApiKey = require('../middleware/apiKey');
const { validatePayloadFields } = require('../middleware/validation');
const asyncHandler = require('../utils/asyncHandler');
const log = require('../utils/log');
const requestCounter = require('../utils/requestCounter');
const state = require('./state');
const { env } = require('../config/env');

const STREAMING_PATH_RE = /\/(stream|sse|events|ws|websocket|subscribe)(\/|$)/i;

/**
 * Build the helmet HSTS option from typed environment values (#1956).
 *
 * HSTS pins browsers to HTTPS for the host, so it is sent only in production.
 * `preload` is never on by default because it is an organisational commitment
 * for the whole registrable domain.
 *
 * @param {{ NODE_ENV: string, HSTS_MAX_AGE: number, HSTS_INCLUDE_SUBDOMAINS: boolean, HSTS_PRELOAD: boolean }} values
 * @returns {false | { maxAge: number, includeSubDomains: boolean, preload: boolean }}
 */
function buildHstsOptions(values) {
  if (values.NODE_ENV !== 'production') return false;
  return {
    maxAge: values.HSTS_MAX_AGE,
    includeSubDomains: values.HSTS_INCLUDE_SUBDOMAINS,
    preload: values.HSTS_PRELOAD,
  };
}

// Bulk donation endpoints accept the larger ENDPOINT_LIMITS.batchDonation body
// size (#1953). Every other path keeps the 100 KB default.
const BATCH_BODY_PATH_RE = /^(?:\/api\/v1)?\/donations\/(?:batch|bulk)\/?$/;

// Content types accepted on body-carrying requests. multipart/form-data is for
// the bulk wallet import upload routes (multer). Form-encoded is accepted only on
// SEP-10 token exchange, which parses it on its own router (#1955).
const SUPPORTED_BODY_TYPES = new Set(['application/json', 'multipart/form-data']);
const SEP10_FORM_PATH_RE = /^(?:\/api\/v1)?\/auth\/token\/?$/;
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Reject body-carrying mutating requests whose Content-Type this API does not
 * parse. Responds 415 with the standard error envelope (#1955).
 */
function unsupportedMediaTypeGuard(req, res, next) {
  if (!MUTATING_METHODS.has(req.method)) return next();

  const contentLength = req.get('content-length');
  const hasBody = (contentLength !== undefined && contentLength !== '0') || req.get('transfer-encoding');
  if (!hasBody) return next();

  const rawType = req.get('content-type');
  if (!rawType) return next();

  const type = rawType.split(';')[0].trim().toLowerCase();
  if (SUPPORTED_BODY_TYPES.has(type)) return next();
  if (type === 'application/x-www-form-urlencoded' && SEP10_FORM_PATH_RE.test(req.path)) return next();

  return res.status(415).json({
    success: false,
    error: {
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'Unsupported Content-Type. Send application/json.',
      requestId: req.id,
      timestamp: new Date().toISOString(),
    },
  });
}

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
  // Every JSON error body leaves in the canonical envelope (Issue #1957).
  app.use(errorEnvelopeMiddleware());
  app.use(attachLifecycleTracking);
  app.use(responseFormatterMiddleware());

  // ─── Security headers ────────────────────────────────────────────────────────
  // contentSecurityPolicy disabled here — owned by createPathBasedCspMiddleware below
  app.use(helmet({
    contentSecurityPolicy: false,
    frameguard: { action: 'deny' },
    noSniff: true,
    referrerPolicy: { policy: 'no-referrer' },
    hsts: buildHstsOptions(env),
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
  // Pre-parse Content-Length guard. Batch paths get their own limit (#1953)
  // so a valid batch is not rejected before its route-level limiter runs.
  const defaultBodyLimiter = payloadSizeLimiter();
  const batchBodyLimiter = payloadSizeLimiter(ENDPOINT_LIMITS.batchDonation);
  app.use((req, res, next) => (BATCH_BODY_PATH_RE.test(req.path) ? batchBodyLimiter : defaultBodyLimiter)(req, res, next));

  // ─── Body parsers ────────────────────────────────────────────────────────────
  // #1929: The raw request body is only needed for signature verification
  // (request-signing middleware and inbound webhook verification).  Capturing
  // it for every JSON request doubles per-request memory and keeps secrets
  // (e.g. sourceSecret) in an unredacted string that dataMasker does not touch.
  //
  // The verify callback now stores the raw Buffer only when a signature
  // header is present, and never converts it to a string.  The signing
  // middleware deletes req.rawBody after verification so it does not live
  // for the entire request lifetime.
  const express = require('express');
  const SIGNATURE_HEADERS = [
    'x-signature',           // request-signing middleware
    'x-webhook-signature',    // outbound webhook signature verification
    'stripe-signature',        // inbound webhook (Stripe-style)
    'x-hub-signature-256',    // inbound webhook (GitHub-style)
    'x-hub-signature',        // inbound webhook (GitHub-style legacy)
  ];
  // Parser limits match the per-endpoint limits enforced by payloadSizeLimiter.
  // body-parser's own default (100 KB) would otherwise reject valid batch
  // payloads before the batch route runs (#1953).
  const jsonBodyVerify = (req, _res, buf) => {
    const hasSignatureHeader = SIGNATURE_HEADERS.some(h => req.get(h));
    if (hasSignatureHeader) {
      req.rawBody = buf; // keep as Buffer — never convert to string
    }
  };
  const defaultJsonParser = express.json({ limit: ENDPOINT_LIMITS.default, verify: jsonBodyVerify });
  const batchJsonParser = express.json({ limit: ENDPOINT_LIMITS.batchDonation, verify: jsonBodyVerify });
  app.use((req, res, next) => (BATCH_BODY_PATH_RE.test(req.path) ? batchJsonParser : defaultJsonParser)(req, res, next));

  // #1955: no global urlencoded parser. Form-encoded bodies are accepted only
  // where the protocol requires them (SEP-10 token exchange, parsed on that
  // router). Any other body with an unsupported Content-Type is rejected with 415
  // instead of silently arriving as an empty or unexpectedly shaped body.
  app.use(unsupportedMediaTypeGuard);

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

  // ─── Response compression ────────────────────────────────────────────────────
  // Mounted BEFORE deduplication and field filtering on purpose. Each of these
  // wraps res.json, and the wrapper installed last runs first — so compression
  // has to be installed first to run last and see the final, filtered body
  // rather than compressing something a later middleware still rewrites.
  app.use(createCompressionMiddleware());

  // ─── Deduplication & field filtering ─────────────────────────────────────────
  app.use(createDeduplicationMiddleware());
  app.use(fieldFilterMiddleware());

  // ─── Global request timeout (exempt streaming endpoints) ─────────────────────
  // Health checks get their own tight budget (TIMEOUTS.health). Stellar
  // submission routes (donations, batch, cross-asset, refunds, channels) get
  // TIMEOUTS.donation. Everything else gets the general fallback
  // (REQUEST_TIMEOUT_MS, default TIMEOUTS.default = 15 s) so that slow reads
  // cannot hold a connection and DB slot for the full submission budget (#1948).
  // Routes may still set a tighter explicit requestTimeout() of their own.
  const GENERAL_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS, 10) || TIMEOUTS.default;
  app.use((req, res, next) => {
    if (STREAMING_PATH_RE.test(req.path)) return next();
    if (req.path.startsWith('/health') || req.path.startsWith('/api/v1/health')) {
      return requestTimeout(TIMEOUTS.health)(req, res, next);
    }
    return requestTimeout(resolveRouteTimeout(req.method, req.path, GENERAL_TIMEOUT_MS))(req, res, next);
  });

  // ─── Mass-assignment protection: reject unknown fields on registered routes ───
  app.use(validatePayloadFields);

  // ─── Schema version negotiation ──────────────────────────────────────────────
  // Normalises the X-Schema-Version header into req.schemaVersion (semver string).
  // URL path (/api/v1) remains the sole authority for API surface versioning.
  // See src/middleware/schemaVersion.js for the full versioning contract.
  app.use(schemaVersionMiddleware);
}

module.exports = { applyMiddleware, buildHstsOptions };
