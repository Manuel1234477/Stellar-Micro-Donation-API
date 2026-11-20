'use strict';

/**
 * Backwards-compatible entry point (issue #1779).
 *
 * Transaction routes live in transactions/ — add new endpoints there, not here.
 * This file only re-exports that router so existing imports keep working.
 */
module.exports = require('./transactions');
