/**
 * Content Security Policy Middleware
 *
 * RESPONSIBILITY: Generate per-request CSP nonces and set strict CSP headers
 * OWNER: Security Team
 *
 * Features:
 *   - Cryptographically random nonce per request (exposed via res.locals.cspNonce)
 *   - Strict directives for API routes: default-src 'none'
 *   - Relaxed directives for /docs (Swagger UI): allows 'self', 'unsafe-inline', data:
 *   - Path-based CSP via createPathBasedCspMiddleware()
 *   - Report-only mode via CSP_REPORT_ONLY=true
 *   - Configurable report-uri via CSP_REPORT_URI env var
 */

'use strict';

const crypto = require('crypto');
const express = require('express');
const log = require('../utils/log');

const REPORT_URI = process.env.CSP_REPORT_URI || '/csp-report';

/**
 * Generate a cryptographically random base64url nonce.
 * @returns {string}
 */
function generateNonce() {
  return crypto.randomBytes(16).toString('base64url');
}

/**
 * Build the strict CSP header value for API routes.
 * @param {string} nonce
 * @param {string} reportUri
 * @returns {string}
 */
function buildCspValue(nonce, reportUri) {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "frame-ancestors 'none'",
    "report-uri " + reportUri,
  ].join('; ');
}

/**
 * Build the relaxed CSP header value for Swagger UI (/docs).
 * Swagger UI requires 'unsafe-inline' for its internal styles/scripts and data: URIs for icons.
 * @param {string} reportUri
 * @returns {string}
 */
function buildSwaggerCspValue(reportUri) {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "report-uri " + reportUri,
  ].join('; ');
}

/**
 * Strict CSP middleware factory for API routes.
 *
 * @param {Object} [options]
 * @param {boolean} [options.reportOnly]
 * @param {string}  [options.reportUri]
 * @returns {import('express').RequestHandler}
 */
function createCspMiddleware(options = {}) {
  const reportOnly = options.reportOnly !== undefined
    ? options.reportOnly
    : process.env.CSP_REPORT_ONLY === 'true';

  const reportUri = options.reportUri !== undefined
    ? options.reportUri
    : REPORT_URI;

  const headerName = reportOnly
    ? 'Content-Security-Policy-Report-Only'
    : 'Content-Security-Policy';

  return function cspMiddleware(req, res, next) {
    const nonce = generateNonce();
    res.locals.cspNonce = nonce;
    res.setHeader(headerName, buildCspValue(nonce, reportUri));
    next();
  };
}

/**
 * Relaxed CSP middleware for Swagger UI (/docs).
 *
 * @param {Object} [options]
 * @param {string}  [options.reportUri]
 * @returns {import('express').RequestHandler}
 */
function createSwaggerCspMiddleware(options = {}) {
  const reportUri = options.reportUri !== undefined
    ? options.reportUri
    : REPORT_URI;

  return function swaggerCspMiddleware(req, res, next) {
    res.setHeader('Content-Security-Policy', buildSwaggerCspValue(reportUri));
    next();
  };
}

/**
 * Path-based CSP middleware.
 * Applies relaxed Swagger CSP for /docs and /api/docs paths; strict CSP everywhere else.
 *
 * @param {Object} [options]
 * @param {boolean} [options.reportOnly]
 * @param {string}  [options.reportUri]
 * @returns {import('express').RequestHandler}
 */
function createPathBasedCspMiddleware(options = {}) {
  const strictCsp = createCspMiddleware(options);
  const swaggerCsp = createSwaggerCspMiddleware(options);

  return function pathBasedCspMiddleware(req, res, next) {
    if (req.path.startsWith('/docs') || req.path.startsWith('/api/docs')) {
      return swaggerCsp(req, res, next);
    }
    return strictCsp(req, res, next);
  };
}

/**
 * Express router providing the POST /csp-report endpoint.
 * Receives and logs CSP violation reports.
 */
const cspReportRouter = express.Router();

cspReportRouter.post(
  '/csp-report',
  express.json({ type: ['application/json', 'application/csp-report'] }),
  (req, res) => {
    const report = req.body && (req.body['csp-report'] || req.body);
    log.warn('CSP', 'Violation report received', { report });
    res.status(204).end();
  }
);

module.exports = {
  createCspMiddleware,
  createSwaggerCspMiddleware,
  createPathBasedCspMiddleware,
  cspReportRouter,
  generateNonce,
  buildCspValue,
  buildSwaggerCspValue,
};
