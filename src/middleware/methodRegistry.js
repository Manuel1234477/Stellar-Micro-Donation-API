/**
 * Method Registry — HTTP Method Tracking per Route Path
 * Feature: return-405-for-unsupported-methods
 *
 * RESPONSIBILITY: Track which HTTP methods are registered for each route path
 * so the 405 middleware can distinguish "path known but method unsupported"
 * from "path unknown → 404".
 *
 * DESIGN
 * ──────
 * - A Map keyed by normalised path stores a Set of uppercase method names.
 * - Parameterised paths are stored with their Express-style patterns
 *   (e.g. "/wallets/:id") and matched via regex at request time.
 * - OPTIONS is automatically added to every registered path.
 */

'use strict';

/**
 * @type {Map<string, Set<string>>}
 * path string → set of HTTP methods (uppercase)
 */
const methodRegistry = new Map();

/**
 * Normalise a path for use as a registry key.
 *
 * Rules:
 *   - Always starts with /
 *   - No trailing slash (unless the path IS just "/")
 *   - Lowercase
 *
 * @param {string} path
 * @returns {string}
 */
function normalizePath(path) {
  if (typeof path !== 'string' || path.length === 0) return '/';
  let p = path.toLowerCase();
  if (!p.startsWith('/')) p = '/' + p;
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

/**
 * Convert an Express route pattern (e.g. "/wallets/:id/history")
 * into a RegExp that matches concrete paths.
 *
 * @param {string} pattern  Normalised pattern with :param segments
 * @returns {RegExp}
 */
function patternToRegex(pattern) {
  // Split on :param segments, escape non-param parts, replace params with [^/]+
  const parts = pattern.split(/(:[a-zA-Z_][a-zA-Z0-9_]*)/);
  const escaped = parts
    .map((part, i) => {
      if (i % 2 === 1) {
        // Odd indices are :param captures — replace with segment wildcard
        return '[^/]+';
      }
      // Even indices are literal path segments — escape regex special chars
      return part.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
    })
    .join('');
  return new RegExp('^' + escaped + '(?:\\?.*)?$', 'i');
}

/**
 * Register an HTTP method for a given path pattern.
 * OPTIONS is automatically added.
 *
 * @param {string} method  HTTP verb (GET, POST, …)
 * @param {string} path    Express path pattern (may include :params)
 */
function registerMethod(method, path) {
  const key = normalizePath(path);
  const upper = method.toUpperCase();

  if (!methodRegistry.has(key)) {
    methodRegistry.set(key, new Set(['OPTIONS']));
  }
  methodRegistry.get(key).add(upper);
  // HEAD is implicitly supported whenever GET is registered
  if (upper === 'GET') {
    methodRegistry.get(key).add('HEAD');
  }
}

/**
 * Return the sorted list of supported HTTP methods for a registered path,
 * or null if the path is not found.
 *
 * @param {string} path  Concrete request path (no query string)
 * @returns {string[]|null}
 */
function getSupportedMethods(path) {
  const key = normalizePath(path);
  if (methodRegistry.has(key)) {
    return [...methodRegistry.get(key)].sort();
  }
  return null;
}

/**
 * Find the first registry entry whose pattern matches the given concrete path.
 * Returns the sorted method list for that entry, or null if no match.
 *
 * @param {string} requestPath  e.g. "/wallets/GABC123/history"
 * @returns {string[]|null}
 */
function findMatchingRoute(requestPath) {
  const normalised = normalizePath(requestPath);

  // 1. Exact match first (fast path)
  if (methodRegistry.has(normalised)) {
    return [...methodRegistry.get(normalised)].sort();
  }

  // 2. Pattern match for parameterised routes
  for (const [pattern, methods] of methodRegistry.entries()) {
    if (!pattern.includes(':')) continue; // skip non-parameterised patterns
    const re = patternToRegex(pattern);
    if (re.test(normalised)) {
      return [...methods].sort();
    }
  }

  return null;
}

/**
 * Clear the registry (for testing).
 */
function clearRegistry() {
  methodRegistry.clear();
}

module.exports = {
  methodRegistry,
  registerMethod,
  getSupportedMethods,
  findMatchingRoute,
  normalizePath,
  patternToRegex,
  clearRegistry,
};
