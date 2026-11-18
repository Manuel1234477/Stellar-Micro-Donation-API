'use strict';

/**
 * Route deprecation helpers (#1778)
 *
 * Deprecated paths kept for one release after a route consolidation use these
 * so every one of them advertises the same headers:
 *
 *   Deprecation: true
 *   Sunset: <HTTP date>
 *   Link: <successor>; rel="successor-version"
 *
 * `deprecated()` marks a request and lets the canonical handler answer it
 * (used when the old path must keep its old request/response shape until
 * sunset). `redirectDeprecated()` answers with a 308 to the successor.
 */

const log = require('../utils/log');

/** Shared sunset date for paths deprecated by route consolidation. */
const DEPRECATION_SUNSET = 'Sat, 01 Jan 2027 00:00:00 GMT';

function resolveSuccessor(successor, req) {
  return typeof successor === 'function' ? successor(req) : successor;
}

/**
 * Set the deprecation headers on a response.
 *
 * @param {import('express').Response} res
 * @param {string} [successorPath]
 * @param {string} [sunset]
 */
function setDeprecationHeaders(res, successorPath, sunset = DEPRECATION_SUNSET) {
  res.set('Deprecation', 'true');
  res.set('Sunset', sunset);
  if (successorPath) res.set('Link', `<${successorPath}>; rel="successor-version"`);
}

/**
 * Mark a deprecated path; the request continues to the next handler.
 *
 * @param {string|function(import('express').Request): string} successor - Canonical path
 * @param {Object} [options]
 * @param {string} [options.sunset]
 * @returns {import('express').RequestHandler}
 */
function deprecated(successor, options = {}) {
  return (req, res, next) => {
    const successorPath = resolveSuccessor(successor, req);
    setDeprecationHeaders(res, successorPath, options.sunset);
    log.debug('DEPRECATION', 'Deprecated route called', {
      method: req.method,
      path: req.originalUrl,
      successor: successorPath,
    });
    next();
  };
}

/**
 * Redirect a deprecated path to its successor with 308 (method and body preserved).
 *
 * @param {string|function(import('express').Request): string} successor
 * @param {Object} [options]
 * @param {string} [options.sunset]
 * @returns {import('express').RequestHandler}
 */
function redirectDeprecated(successor, options = {}) {
  return (req, res) => {
    const successorPath = resolveSuccessor(successor, req);
    setDeprecationHeaders(res, successorPath, options.sunset);
    const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    res.redirect(308, successorPath + qs);
  };
}

module.exports = {
  DEPRECATION_SUNSET,
  setDeprecationHeaders,
  deprecated,
  redirectDeprecated,
};
