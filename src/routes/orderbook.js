/**
 * Orderbook Routes - Stellar DEX Order Book Streaming
 *
 * RESPONSIBILITY: Snapshot and SSE streaming of Stellar DEX order book data
 * OWNER: Backend Team
 * DEPENDENCIES: StellarService, middleware (auth, RBAC)
 *
 * Asset path parameter format:
 *   - Native XLM: "XLM"
 *   - Custom asset: "CODE:ISSUER" (URL-encoded in path, e.g. "USDC:G...")
 *
 * Endpoints:
 *   GET /orderbook/:baseAsset/:counterAsset/snapshot  – current bids/asks
 *   GET /orderbook/:baseAsset/:counterAsset/stream    – SSE real-time updates
 */

'use strict';

const express = require('express');
const router = express.Router({ mergeParams: true });
const requireApiKey = require('../middleware/apiKey');
const { checkPermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../utils/permissions');
const { ValidationError } = require('../utils/errors');
const { getStellarService } = require('../config/stellar');
const log = require('../utils/log');

/**
 * Parse and normalise an asset path parameter.
 * Accepts 'XLM', 'native', or 'CODE:ISSUER' (URL-decoded).
 *
 * @param {string} raw - Raw URL path segment
 * @returns {string} Normalised asset string ('XLM' or 'CODE:ISSUER')
 * @throws {ValidationError} If the format is invalid
 */
function parseAsset(raw) {
  if (!raw || typeof raw !== 'string') throw new ValidationError('Asset must be a non-empty string');
  const s = decodeURIComponent(raw).trim().toUpperCase();
  if (s === 'XLM' || s === 'NATIVE') return 'XLM';
  if (!s.includes(':')) throw new ValidationError(`Invalid asset format "${raw}". Use 'XLM' or 'CODE:ISSUER'`);
  const [code, issuer] = s.split(':');
  if (!code || !issuer) throw new ValidationError(`Invalid asset format "${raw}". Use 'CODE:ISSUER'`);
  return `${code}:${issuer}`;
}

/**
 * GET /orderbook/:baseAsset/:counterAsset/snapshot
 * Return the current order book state (bids and asks) for a trading pair.
 *
 * @param {string} baseAsset    - Selling/base asset ('XLM' or 'CODE:ISSUER', URL-encoded)
 * @param {string} counterAsset - Buying/counter asset ('XLM' or 'CODE:ISSUER', URL-encoded)
 * @query  {number} [limit=20]  - Max entries per side (1-200)
 */
router.get('/snapshot', requireApiKey, checkPermission(PERMISSIONS.DONATIONS_READ), async (req, res, next) => {
  try {
    const base = parseAsset(req.params.baseAsset);
    const counter = parseAsset(req.params.counterAsset);
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 200);

    const stellar = getStellarService();
    const data = await stellar.getOrderBook(base, counter, limit);

    return res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /orderbook/:baseAsset/:counterAsset/stream
 * Stream real-time order book updates via Server-Sent Events.
 *
 * The Horizon stream is closed when the client disconnects to prevent memory leaks.
 * Supports concurrent streams for different asset pairs simultaneously.
 *
 * @param {string} baseAsset    - Selling/base asset ('XLM' or 'CODE:ISSUER', URL-encoded)
 * @param {string} counterAsset - Buying/counter asset ('XLM' or 'CODE:ISSUER', URL-encoded)
 */
router.get('/stream', requireApiKey, checkPermission(PERMISSIONS.DONATIONS_READ), (req, res, next) => {
  let base, counter;
  try {
    base = parseAsset(req.params.baseAsset);
    counter = parseAsset(req.params.counterAsset);
  } catch (err) {
    return next(err);
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const stellar = getStellarService();

  const closeStream = stellar.streamOrderbook(base, counter, (update) => {
    try {
      res.write(`data: ${JSON.stringify(update)}\n\n`);
    } catch (e) {
      log.error('ORDERBOOK_STREAM', 'Failed to write SSE event', { error: e.message });
    }
  });

  req.on('close', () => {
    if (typeof closeStream === 'function') closeStream();
    log.info('ORDERBOOK_STREAM', 'Client disconnected, stream closed', { base, counter });
  });
});

module.exports = router;
module.exports.parseAsset = parseAsset;
