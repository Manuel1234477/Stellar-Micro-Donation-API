'use strict';

/**
 * Abort Context - propagates an AbortController's signal to nested async work
 * without threading it through every function signature in between.
 *
 * Used so that when a Horizon API call times out (StellarService's own
 * per-operation timeout, see withTimeout()), the underlying fetch() request
 * is actually aborted instead of just being abandoned to finish in the
 * background. The HTTP client (StellarService._createHttpClient) reads the
 * current signal via getCurrentAbortSignal() and passes it to fetch().
 */

const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

/**
 * Run `fn` with `controller` set as the current abort context.
 * Any async work started synchronously inside `fn` (including across
 * awaits) can read the controller's signal via getCurrentAbortSignal().
 *
 * @param {AbortController} controller
 * @param {Function} fn
 * @returns {*} The return value of `fn()`
 */
function runWithAbortController(controller, fn) {
  return storage.run(controller, fn);
}

/**
 * @returns {AbortSignal|undefined} The current abort signal, if any.
 */
function getCurrentAbortSignal() {
  return storage.getStore()?.signal;
}

module.exports = { runWithAbortController, getCurrentAbortSignal };
