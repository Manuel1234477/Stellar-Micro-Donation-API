/**
 * Offers Routes - Stellar DEX Integration
 *
 * RESPONSIBILITY: HTTP request handling for DEX offer management and order book queries
 * OWNER: Backend Team
 * DEPENDENCIES: StellarService, middleware (auth, rbac)
 *
 * Exposes endpoints for creating, listing, and cancelling Stellar DEX offers,
 * as well as querying the order book for any trading pair.
 */

const express = require('express');
const { clientErrorMessage } = require('../utils/clientErrorMessage');
const router = express.Router();
const requireApiKey = require('../middleware/apiKey');
const asyncHandler = require('../utils/asyncHandler');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../middleware/payloadSizeLimiter');
const { checkPermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../utils/permissions');
const { ValidationError } = require('../utils/errors');
const { getStellarService } = require('../config/stellar');
const { validateLimit } = require('../utils/pagination');

const Database = require('../utils/database');

const stellarService = getStellarService();

/**
 * Parse asset string into a normalised form.
 * Accepts 'XLM', 'native', or 'CODE:ISSUER'.
 * @param {string} asset
 * @returns {string}
 */
function normaliseAsset(asset) {
  if (!asset || typeof asset !== 'string') throw new ValidationError('Asset must be a non-empty string');
  const upper = asset.trim().toUpperCase();
  if (upper === 'XLM' || upper === 'NATIVE') return 'XLM';
  if (!upper.includes(':')) throw new ValidationError(`Invalid asset format "${asset}". Use 'XLM' or 'CODE:ISSUER'`);
  const [code, issuer] = upper.split(':');
  if (!code || !issuer) throw new ValidationError(`Invalid asset format "${asset}". Use 'CODE:ISSUER'`);
  return `${code}:${issuer}`;
}

/**
 * POST /offers
 * Create a new DEX sell offer.
 *
 * Body:
 *   signedXDR     {string} - Pre-signed transaction XDR envelope
 *   sellingAsset  {string} - Asset to sell ('XLM' or 'CODE:ISSUER')
 *   buyingAsset   {string} - Asset to buy  ('XLM' or 'CODE:ISSUER')
 *   amount        {string} - Amount of selling asset
 *   price         {string} - Price ratio ('n/d') or decimal
 */
router.post('/', requireApiKey, checkPermission(PERMISSIONS.DONATIONS_CREATE), payloadSizeLimiter(ENDPOINT_LIMITS.default), asyncHandler(async (req, res) => {
  try {
    const { signedXDR, sellingAsset, buyingAsset, amount, price } = req.body;

    if (!signedXDR) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'signedXDR is required' } });
    if (!amount) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'amount is required' } });
    if (!price) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'price is required' } });

    const normSelling = normaliseAsset(sellingAsset);
    const normBuying = normaliseAsset(buyingAsset);

    const result = await stellarService.submitSignedTransaction(signedXDR);

    // Persist metadata for listing
    await Database.run(
      `INSERT OR REPLACE INTO offers
         (id, selling_asset, buying_asset, amount, price, transaction_id, ledger, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
      [
        String(result.offerId),
        normSelling,
        normBuying,
        amount.toString(),
        price.toString(),
        result.transactionId,
        result.ledger,
        new Date().toISOString(),
      ]
    );

    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    const status = err.statusCode || err.status || 400;
    return res.status(status).json({ success: false, error: { code: err.errorCode || 'OFFER_CREATE_FAILED', message: clientErrorMessage('OFFERS', err, status) } });
  }
}));

/**
 * GET /offers
 * List all active offers (from the database).
 */
router.get('/', requireApiKey, checkPermission(PERMISSIONS.DONATIONS_READ), asyncHandler(async (req, res) => {
  const rows = await Database.query(
    `SELECT id, selling_asset, buying_asset, amount, price, transaction_id, ledger, status, created_at
     FROM offers WHERE status = 'active'`
  );
  const offers = rows.map(r => ({
    id: r.id,
    sellingAsset: r.selling_asset,
    buyingAsset: r.buying_asset,
    amount: r.amount,
    price: r.price,
    transactionId: r.transaction_id,
    ledger: r.ledger,
    createdAt: r.created_at,
    status: r.status,
  }));
  return res.status(200).json({ success: true, data: offers });
}));

/**
 * DELETE /offers/:id
 * Cancel an existing DEX offer.
 *
 * Body:
 *   signedXDR     {string} - Pre-signed transaction XDR envelope
 *   sellingAsset  {string} - Asset being sold in the offer
 *   buyingAsset   {string} - Asset being bought in the offer
 */
router.delete('/:id', requireApiKey, checkPermission(PERMISSIONS.DONATIONS_CREATE), asyncHandler(async (req, res) => {
  try {
    const offerId = parseInt(req.params.id, 10);
    if (isNaN(offerId)) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Offer ID must be an integer' } });

    const { signedXDR, sellingAsset, buyingAsset } = req.body;
    if (!signedXDR) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'signedXDR is required' } });

    const _normSelling = normaliseAsset(sellingAsset);
    const _normBuying = normaliseAsset(buyingAsset);

    const result = await stellarService.submitSignedTransaction(signedXDR);

    await Database.run(
      `UPDATE offers SET status = 'cancelled' WHERE id = ?`,
      [String(offerId)]
    );

    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    const status = err.statusCode || err.status || 400;
    return res.status(status).json({ success: false, error: { code: err.errorCode || 'OFFER_CANCEL_FAILED', message: clientErrorMessage('OFFERS', err, status) } });
  }
}));

/**
 * GET /orderbook/:baseAsset/:counterAsset
 * Query the Stellar DEX order book for a trading pair.
 *
 * Params:
 *   baseAsset    - Selling asset ('XLM' or 'CODE:ISSUER', URL-encoded)
 *   counterAsset - Buying asset  ('XLM' or 'CODE:ISSUER', URL-encoded)
 *
 * Query:
 *   limit {number} - Max bids/asks to return (default 20, max 100)
 */
router.get('/orderbook/:baseAsset/:counterAsset', requireApiKey, checkPermission(PERMISSIONS.DONATIONS_READ), asyncHandler(async (req, res) => {
  try {
    const normBase = normaliseAsset(decodeURIComponent(req.params.baseAsset));
    const normCounter = normaliseAsset(decodeURIComponent(req.params.counterAsset));

    const limitResult = validateLimit(req.query.limit, { defaultValue: 20 });
    if (!limitResult.valid) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_LIMIT', message: limitResult.error },
      });
    }
    const limit = limitResult.value;

    const result = await stellarService.getOrderBook(normBase, normCounter, limit);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    const status = err.statusCode || err.status || 400;
    return res.status(status).json({ success: false, error: { code: err.errorCode || 'ORDERBOOK_FAILED', message: clientErrorMessage('OFFERS', err, status) } });
  }
}));

module.exports = router;
