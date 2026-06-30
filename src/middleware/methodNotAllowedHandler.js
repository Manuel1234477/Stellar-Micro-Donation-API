/**
 * Method Not Allowed Handler Middleware
 * Feature: return-405-for-unsupported-methods
 *
 * RESPONSIBILITY: Return 405 Method Not Allowed (with Allow header) for known
 * routes that receive an unsupported HTTP method, while leaving truly unknown
 * paths to fall through to the 404 Not Found handler.
 *
 * Also provides the OPTIONS handler that returns 200 + Allow header for CORS
 * preflight and programmatic capability discovery.
 *
 * PIPELINE ORDER (must be respected)
 * ────────────────────────────────────
 *   ... all route handlers ...
 *   optionsHandler           ← intercepts OPTIONS on known routes
 *   methodNotAllowedHandler  ← intercepts wrong methods on known routes
 *   notFoundHandler          ← handles genuinely unknown paths
 *   errorHandler             ← catches errors
 */

'use strict';

const { findMatchingRoute } = require('./methodRegistry');
const { ERROR_CODES } = require('../utils/errors');

/**
 * OPTIONS handler — returns 200 with Allow header for known routes.
 * Falls through (next()) for unknown paths so they still get 404.
 */
function optionsHandler(req, res, next) {
  if (req.method !== 'OPTIONS') return next();

  const methods = findMatchingRoute(req.path);
  if (!methods) return next();

  res.set('Allow', methods.join(', '));
  res.set('Content-Length', '0');
  return res.status(200).end();
}

/**
 * 405 Method Not Allowed handler.
 * Must be placed after all route handlers and before notFoundHandler.
 */
function methodNotAllowedHandler(req, res, next) {
  const methods = findMatchingRoute(req.path);

  // Unknown path — let 404 handler deal with it
  if (!methods) return next();

  // Method is supported — this request should have been handled already;
  // let it fall through (should not normally happen, but be safe).
  const upperMethod = req.method.toUpperCase();
  if (methods.includes(upperMethod)) return next();

  const allowHeader = methods.join(', ');
  res.set('Allow', allowHeader);

  return res.status(405).json({
    success: false,
    error: {
      code: ERROR_CODES.NOT_IMPLEMENTED
        ? 'METHOD_NOT_ALLOWED'
        : 'METHOD_NOT_ALLOWED',
      numericCode: 3006,
      message: `Method ${req.method} is not allowed on ${req.path}. Allowed methods: ${allowHeader}`,
      allowedMethods: methods,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    },
  });
}

module.exports = { optionsHandler, methodNotAllowedHandler };
