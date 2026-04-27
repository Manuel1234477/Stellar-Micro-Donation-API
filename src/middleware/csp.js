/**
 * Content Security Policy Middleware
 *
 * RESPONSIBILITY: Generate per-request CSP nonces and set strict CSP headers
 * OWNER: Security Team
 *
 * Features:
 *   - Cryptographically random nonce per request (exposed via res.locals.cspNonce)
 *   - Strict directives: default-src 'none', script-src 'nonce-{nonce}'
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
 *
 * @returns {string} 16-byte random nonce encoded as base64url
 */
function generateNonce() {
  return crypto.randomBytes(16).toString('base64url');
}

/**
 * Build the CSP header value for a given nonce.
 *
 * @param {string} nonce
 * @param {string} reportUri
 * @returns {string}
 */
function buildCspValue(nonce, reportUri) {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "report-uri " + reportUri,
  ].join('; ');
}

/**
 * CSP middleware factory.
 *
 * Reads configuration from environment:
 *   - CSP_REPORT_ONLY=true  → use Content-Security-Policy-Report-Only header
 *   - CSP_REPORT_URI        → violation report endpoint (default: /csp-report)
 *
 * @param {Object} [options]
 * @param {boolean} [options.reportOnly]  - Override CSP_REPORT_ONLY env var
 * @param {string}  [options.reportUri]   - Override CSP_REPORT_URI env var
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

  /**
   * @param {import('express').Request}  req
   * @param {import('express').Response} res
   * @param {import('express').NextFunction} next
   */
  return function cspMiddleware(req, res, next) {
    const nonce = generateNonce();
    res.locals.cspNonce = nonce;
    res.setHeader(headerName, buildCspValue(nonce, reportUri));
    next();
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
  cspReportRouter,
  generateNonce,
  buildCspValue,
};
