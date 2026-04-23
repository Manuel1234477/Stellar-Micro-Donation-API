'use strict';

/**
 * Wraps an async route handler so that any rejected promise is forwarded to
 * Express's next(err) instead of becoming an unhandled rejection.
 *
 * Usage:
 *   router.get('/path', asyncHandler(async (req, res) => {
 *     const data = await someAsyncOperation();
 *     res.json(data);
 *   }));
 *
 * @param {Function} fn - async route handler (req, res, next)
 * @returns {Function} Express-compatible middleware
 */
const asyncHandler = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

module.exports = asyncHandler;
