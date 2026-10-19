'use strict';

/**
 * Backwards-compatible entry point (issue #1779).
 *
 * Wallet routes live in wallets/ — add new endpoints there, not here.
 * This file only re-exports that router so existing imports keep working.
 */
module.exports = require('./wallets');
