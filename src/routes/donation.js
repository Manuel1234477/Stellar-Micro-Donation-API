'use strict';

/**
 * Backwards-compatible entry point (issue #1779).
 *
 * Donation routes live in donations/ — add new endpoints there, not here.
 * This file only re-exports that router so existing imports keep working.
 *
 * Note (issue #1988): the require below is intentionally at module top level
 * (not inside a function) so a missing or broken donations router fails at
 * load time rather than on the first request. All in-function requires in the
 * donation routes have been hoisted to the top of their respective modules in
 * src/routes/donations/.
 */
module.exports = require('./donations');