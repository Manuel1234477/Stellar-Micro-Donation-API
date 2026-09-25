/**
 * Wallet Routes - Composition Layer
 *
 * RESPONSIBILITY: Mount decomposed wallet sub-routers (issue #1212)
 * OWNER: Backend Team
 * DEPENDENCIES: Wallet sub-routers in ./wallets/
 *
 * This file now serves as a thin composition layer that mounts focused
 * sub-routers, each handling specific wallet operations:
 * - index.js: CRUD + bulk operations
 * - metadata.js: Wallet metadata (get, update, delete)
 * - balance-history.js: Balance and transaction history
 * - home-domain.js: Home domain management
 * - inflation.js: Inflation destination
 * - sponsorship.js: Account sponsorship
 * - trustlines.js: Trustline management
 * - data-entries.js: Account data
 * - merge.js: Account merging
 * - limits-config.js: Wallet limits and config
 *
 * See docs/WALLET_ROUTES_COMPOSITION.md for architecture details.
 */

const express = require('express');
const router = express.Router();
const { toWalletResponse, ALLOWED_WALLET_FIELDS } = require('../utils/responseSanitizer');

/**
  * Response sanitizer middleware applied to all wallet endpoints.
  * Ensures internal/sensitive fields are stripped from all wallet responses.
  */
function walletResponseSanitizer(req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = function (body) {
    if (body && typeof body === 'object') {
      if (body.data) {
        if (Array.isArray(body.data)) {
          body.data = body.data.map(item => (item && typeof item === 'object' && (item.id || item.publicKey || item.address) ? toWalletResponse(item) : item));
        } else if (typeof body.data === 'object') {
          if (Array.isArray(body.data.wallets)) {
            body.data.wallets = body.data.wallets.map(item => (item && typeof item === 'object' ? toWalletResponse(item) : item));
          } else if (body.data.id || body.data.publicKey || body.data.address) {
            body.data = toWalletResponse(body.data);
          }
        }
      }
    }
    return originalJson(body);
  };
  next();
}

// Apply response sanitizer middleware to all wallet endpoints
router.use(walletResponseSanitizer);

// Mount decomposed sub-routers
const indexRouter = require('./wallets/index');
const metadataRouter = require('./wallets/metadata');
const balanceHistoryRouter = require('./wallets/balance-history');
const homeDomainRouter = require('./wallets/home-domain');
const inflationRouter = require('./wallets/inflation');
const sponsorshipRouter = require('./wallets/sponsorship');
const trustlinesRouter = require('./wallets/trustlines');
const dataEntriesRouter = require('./wallets/data-entries');
const mergeRouter = require('./wallets/merge');
const limitsConfigRouter = require('./wallets/limits-config');

// Mount all routes (sub-routers handle their own paths)
router.use('/', indexRouter);
router.use('/', metadataRouter);
router.use('/', balanceHistoryRouter);
router.use('/', homeDomainRouter);
router.use('/', inflationRouter);
router.use('/', sponsorshipRouter);
router.use('/', trustlinesRouter);
router.use('/', dataEntriesRouter);
router.use('/', mergeRouter);
router.use('/', limitsConfigRouter);

module.exports = router;
module.exports.ALLOWED_WALLET_FIELDS = ALLOWED_WALLET_FIELDS;
module.exports.walletResponseSanitizer = walletResponseSanitizer;

