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
const router = express.Router();
const requireApiKey = require('../middleware/apiKey');
const { checkPermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../utils/permissions');
const { ValidationError } = require('../utils/errors');
const { getStellarService } = require('../config/stellar');

const stellarService = getStellarService();

// In-memory offer store (maps offerId -> offer metadata for listing)
// In production this would be persisted to the database.
const offerStore = new Map();

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
 *   sourceSecret  {string} - Seller's Stellar secret key
 *   sellingAsset  {string} - Asset to sell ('XLM' or 'CODE:ISSUER')
 *   buyingAsset   {string} - Asset to buy  ('XLM' or 'CODE:ISSUER')
 *   amount        {string} - Amount of selling asset
 *   price         {string} - Price ratio ('n/d') or decimal
 */
router.post('/', requireApiKey, checkPermission(PERMISSIONS.DONATIONS_CREATE), async (req, res) => {
  try {
    const { sourceSecret, sellingAsset, buyingAsset, amount, price } = req.body;

    if (!sourceSecret) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'sourceSecret is required' } });
    if (!amount) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'amount is required' } });
    if (!price) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'price is required' } });

    const normSelling = normaliseAsset(sellingAsset);
    const normBuying = normaliseAsset(buyingAsset);

    const result = await stellarService.createOffer({
      sourceSecret,
      sellingAsset: normSelling,
      buyingAsset: normBuying,
      amount: amount.toString(),
      price: price.toString(),
      offerId: 0,
    });

    // Persist metadata for listing
    offerStore.set(result.offerId, {
      id: result.offerId,
      sellingAsset: normSelling,
      buyingAsset: normBuying,
      amount: amount.toString(),
      price: price.toString(),
      transactionId: result.transactionId,
      ledger: result.ledger,
      createdAt: new Date().toISOString(),
      status: 'active',
    });

    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    const status = err.statusCode || err.status || 400;
    return res.status(status).json({ success: false, error: { code: err.errorCode || 'OFFER_CREATE_FAILED', message: err.message } });
  }
});

/**
 * GET /offers
 * List all active offers (from in-memory store).
 */
router.get('/', requireApiKey, checkPermission(PERMISSIONS.DONATIONS_READ), (req, res) => {
  const offers = Array.from(offerStore.values()).filter(o => o.status === 'active');
  return res.status(200).json({ success: true, data: offers });
});

/**
 * DELETE /offers/:id
 * Cancel an existing DEX offer.
 *
 * Body:
 *   sourceSecret  {string} - Seller's Stellar secret key
 *   sellingAsset  {string} - Asset being sold in the offer
 *   buyingAsset   {string} - Asset being bought in the offer
 */
router.delete('/:id', requireApiKey, checkPermission(PERMISSIONS.DONATIONS_CREATE), async (req, res) => {
  try {
    const offerId = parseInt(req.params.id, 10);
    if (isNaN(offerId)) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Offer ID must be an integer' } });

    const { sourceSecret, sellingAsset, buyingAsset } = req.body;
    if (!sourceSecret) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'sourceSecret is required' } });

    const normSelling = normaliseAsset(sellingAsset);
    const normBuying = normaliseAsset(buyingAsset);

    const result = await stellarService.cancelOffer({ sourceSecret, sellingAsset: normSelling, buyingAsset: normBuying, offerId });

    const stored = offerStore.get(offerId);
    if (stored) stored.status = 'cancelled';

    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    const status = err.statusCode || err.status || 400;
    return res.status(status).json({ success: false, error: { code: err.errorCode || 'OFFER_CANCEL_FAILED', message: err.message } });
  }
});

/**
 * GET /orderbook/:baseAsset/:counterAsset
 * Query the Stellar DEX order book for a trading pair.
 *
 * Params:
 *   baseAsset    - Selling asset ('XLM' or 'CODE:ISSUER', URL-encoded)
 *   counterAsset - Buying asset  ('XLM' or 'CODE:ISSUER', URL-encoded)
 *
 * Query:
 *   limit {number} - Max bids/asks to return (default 20, max 200)
 */
router.get('/orderbook/:baseAsset/:counterAsset', requireApiKey, checkPermission(PERMISSIONS.DONATIONS_READ), async (req, res) => {
  try {
    const normBase = normaliseAsset(decodeURIComponent(req.params.baseAsset));
    const normCounter = normaliseAsset(decodeURIComponent(req.params.counterAsset));

    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 200);

    const result = await stellarService.getOrderBook(normBase, normCounter, limit);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    const status = err.statusCode || err.status || 400;
    return res.status(status).json({ success: false, error: { code: err.errorCode || 'ORDERBOOK_FAILED', message: err.message } });
  }
});

// Expose store for testing
router._offerStore = offerStore;

module.exports = router;
