/**
 * /api/v2 - Standardized Response Envelope Router (#1553)
 *
 * Mounts a v2 surface using the new envelope from utils/responseFormatter.js:
 *   List:   { data: [...], meta: { total, page, pageSize, cursor } }
 *   Single: { data: {...} }
 *   Error:  { error: { code, message, requestId, timestamp } }
 *
 * /api/v1/ is completely untouched — this router is mounted alongside it,
 * not in place of it, so existing v1 clients see no behavior change.
 *
 * This is a representative slice of the API (donations, wallets, corporate
 * matching), not a full 1:1 port of every v1 route; it establishes the
 * pattern and reusable helpers so further resources can be added the same
 * way as they're versioned forward.
 */

'use strict';

const express = require('express');
const { v2ResponseFormatterMiddleware, v2ErrorResponse } = require('../../utils/responseFormatter');
const { AppError, ERROR_CODES } = require('../../utils/errors');
const log = require('../../utils/log');

const router = express.Router();

router.use(v2ResponseFormatterMiddleware());

router.use('/donations', require('./donations'));
router.use('/wallets', require('./wallets'));
router.use('/corporate-matching', require('./corporateMatching'));

// v2-shaped 404 for anything under /api/v2 that doesn't match a mounted resource.
router.use((req, res) => {
  res.status(404).json(v2ErrorResponse(ERROR_CODES.ENDPOINT_NOT_FOUND.code, `Not found: ${req.method} ${req.originalUrl}`, req.id));
});

// v2-shaped error handler. Scoped to this router so it only affects /api/v2
// responses; /api/v1 keeps using the global errorHandler in middleware/errorHandler.js.
// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      log.error('API_V2', 'Request failed', { path: req.originalUrl, error: err.message });
    }
    return res.status(err.statusCode).json(v2ErrorResponse(err.errorCode, err.message, req.id));
  }

  log.error('API_V2', 'Unhandled error', { path: req.originalUrl, error: err.message });
  return res.status(500).json(v2ErrorResponse(ERROR_CODES.INTERNAL_ERROR.code, 'An internal error occurred', req.id));
});

module.exports = router;
