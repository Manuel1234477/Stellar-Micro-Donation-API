/**
 * Error Envelope Middleware (Issue #1957)
 *
 * Guarantees that every JSON error response (status >= 400 with
 * `success: false`) leaves the server in the canonical envelope:
 *
 *   { success: false, error: { code, message, requestId, ... } }
 *
 * Handlers that still send legacy shapes such as `{ success: false, error: 'text' }`
 * are normalised here, so clients only ever need one error parser. Handlers that
 * already build a coded envelope are passed through unchanged.
 *
 * Mounted directly after the request-id middleware so `req.id` is available.
 */

'use strict';

const { normalizeErrorBody } = require('../utils/errors');

/**
 * @returns {import('express').RequestHandler}
 */
function errorEnvelopeMiddleware() {
  return (req, res, next) => {
    const originalJson = res.json.bind(res);

    res.json = (body) => {
      if (res.statusCode >= 400) {
        body = normalizeErrorBody(res.statusCode, body, req.id ?? null);
      }
      return originalJson(body);
    };

    next();
  };
}

module.exports = errorEnvelopeMiddleware;
