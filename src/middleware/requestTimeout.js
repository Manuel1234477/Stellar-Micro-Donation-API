/**
 * Request Timeout Middleware
 *
 * Aborts requests that exceed a configurable time limit and returns 503
 * with a Retry-After header. Per-endpoint timeouts are set at route level
 * using the `requestTimeout(ms)` factory.
 *
 * @module requestTimeout
 */

'use strict';

const log = require('../utils/log');

/**
 * Per-endpoint timeout presets in milliseconds.
 * Apply the appropriate constant directly on the route.
 */
const TIMEOUTS = {
  health: 5_000,      //  5 s — health / liveness probes
  balance: 10_000,    // 10 s — wallet balance lookups
  default: 15_000,    // 15 s — general fallback
  donation: 30_000,   // 30 s — Stellar transaction submission
  stream: 60_000,     // 60 s — recurring-donation schedule creation
};

/**
 * Create a request timeout middleware.
 *
 * Sets a timer when the request arrives. If the response has not finished
 * before the timer fires the middleware:
 *  1. Logs the timeout with method, path, duration, and client IP.
 *  2. Sends HTTP 503 with a `Retry-After: 5` header.
 *
 * The timer is cleared automatically when the response finishes normally.
 *
 * @param {number} [ms=TIMEOUTS.default] - Timeout in milliseconds.
 * @returns {import('express').RequestHandler}
 *
 * @example
 * // Donation route — 30 s
 * router.post('/donations', requestTimeout(TIMEOUTS.donation), handler);
 *
 * // Health check — 5 s
 * app.get('/health', requestTimeout(TIMEOUTS.health), handler);
 */
function requestTimeout(ms = TIMEOUTS.default) {
  return (req, res, next) => {
    const timer = setTimeout(() => {
      log.warn('REQUEST_TIMEOUT', 'Request timed out', {
        requestId: req.id,
        method: req.method,
        path: req.path,
        timeoutMs: ms,
        ip: req.ip,
      });

      if (res.headersSent) return;

      res.set('Retry-After', '5');
      res.status(503).json({
        success: false,
        error: {
          code: 'REQUEST_TIMEOUT',
          message: `Request exceeded the ${ms} ms time limit for this endpoint.`,
          details: { timeoutMs: ms },
          requestId: req.id,
          timestamp: new Date().toISOString(),
        },
      });
    }, ms);

    // Clear the timer as soon as the response is finished.
    res.on('finish', () => clearTimeout(timer));
    res.on('close', () => clearTimeout(timer));

    next();
  };
}

module.exports = { requestTimeout, TIMEOUTS };
