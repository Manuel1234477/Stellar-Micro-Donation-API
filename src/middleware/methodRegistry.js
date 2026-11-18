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
 * - Each explicit method+path registration is counted so startup can fail
 *   when the same endpoint is defined twice (issue #1779). Express silently
 *   lets the first definition win, which hides the second one.
 */

'use strict';

/**
 * @type {Map<string, Set<string>>}
 * path string → set of HTTP methods (uppercase)
 */
const methodRegistry = new Map();

/**
 * @type {Map<string, number>}
 * "METHOD /path" → number of times that endpoint was registered
 */
const registrationCounts = new Map();

/**
 * Normalise a path for use as a registry key.
 *
 * Rules:
 *   - Always starts with /
 *   - Repeated slashes collapse to one (nested routers mounted at "/" produce
 *     prefixes like "/api/v1/donations/" + "/batch")
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
  p = p.replace(/\/{2,}/g, '/');
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

  const registrationKey = `${upper} ${key}`;
  registrationCounts.set(registrationKey, (registrationCounts.get(registrationKey) || 0) + 1);

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
 * List endpoints that were registered more than once.
 *
 * @returns {{ method: string, path: string, count: number }[]}
 */
function findDuplicateRegistrations() {
  const duplicates = [];
  for (const [registrationKey, count] of registrationCounts.entries()) {
    if (count > 1) {
      const [method, path] = registrationKey.split(' ');
      duplicates.push({ method, path, count });
    }
  }
  return duplicates;
}

/**
 * Throw if any endpoint was registered more than once.
 *
 * @throws {Error} listing every duplicated method + path
 */
function assertNoDuplicateRoutes() {
  const duplicates = findDuplicateRegistrations();
  if (duplicates.length === 0) return;
  const list = duplicates
    .map(({ method, path, count }) => `  ${method} ${path} (registered ${count} times)`)
    .join('\n');
  throw new Error(
    `Duplicate route registrations detected. Only the first definition would ever run:\n${list}\n` +
    'Remove or merge the duplicate definitions.'
  );
}

/**
 * Clear the registry (for testing).
 */
function clearRegistry() {
  methodRegistry.clear();
  registrationCounts.clear();
}

module.exports = {
  methodRegistry,
  registerMethod,
  getSupportedMethods,
  findMatchingRoute,
  normalizePath,
  patternToRegex,
  clearRegistry,
  findDuplicateRegistrations,
  assertNoDuplicateRoutes,
};
