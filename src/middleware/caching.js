/**
 * HTTP Caching Middleware
 *
 * Provides ETag-based and Last-Modified conditional request handling.
 * Generates ETags from response body hashes. Returns 304 Not Modified
 * when the client's cached version matches the current resource.
 *
 * Security: ETags are opaque SHA-256 hashes — no sensitive data is leaked.
 *
 * Usage:
 *   router.get('/resource', cacheMiddleware('public', 60), handler);
 */

'use strict';

const crypto = require('crypto');

/**
 * Cache-Control max-age values (seconds) per resource type.
 * @type {Object.<string, number>}
 */
const MAX_AGE = {
  wallet: 30,
  campaign: 60,
  stats: 120,
  'exchange-rate': 300,
  default: 60,
};

/**
 * Generate a strong ETag from a JSON-serialisable value.
 * Uses SHA-256 so the tag is opaque and leaks no resource data.
 *
 * @param {*} data - The response body to hash.
 * @returns {string} Quoted ETag string, e.g. `"abc123"`.
 */
function generateETag(data) {
  const hash = crypto
    .createHash('sha256')
    .update(typeof data === 'string' ? data : JSON.stringify(data))
    .digest('hex')
    .slice(0, 32);
  return `"${hash}"`;
}

/**
 * Build a Cache-Control header value.
 *
 * @param {string} visibility - `'public'` or `'private'`.
 * @param {number} maxAge - max-age in seconds.
 * @returns {string}
 */
function buildCacheControl(visibility, maxAge) {
  return `${visibility}, max-age=${maxAge}`;
}

/**
 * Express middleware factory that adds ETag / Last-Modified / Cache-Control
 * headers and handles conditional GET requests (If-None-Match, If-Modified-Since).
 *
 * @param {string} [resourceType='default'] - Key into MAX_AGE map.
 * @param {string} [visibility='private'] - `'public'` or `'private'`.
 * @returns {import('express').RequestHandler}
 */
function cacheMiddleware(resourceType = 'default', visibility = 'private') {
  const maxAge = MAX_AGE[resourceType] ?? MAX_AGE.default;

  return function httpCacheHandler(req, res, next) {
    // Only cache safe methods
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return next();
    }

    const originalJson = res.json.bind(res);

    res.json = function cachedJson(body) {
      // Only cache successful responses
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return originalJson(body);
      }

      const etag = generateETag(body);
      const lastModified = new Date().toUTCString();

      res.setHeader('ETag', etag);
      res.setHeader('Last-Modified', lastModified);
      res.setHeader('Cache-Control', buildCacheControl(visibility, maxAge));

      // If-None-Match check
      const ifNoneMatch = req.headers['if-none-match'];
      if (ifNoneMatch) {
        const tags = ifNoneMatch.split(',').map((t) => t.trim());
        if (tags.includes(etag) || tags.includes('*')) {
          res.status(304);
          return res.end();
        }
      }

      // If-Modified-Since check (only when no If-None-Match)
      if (!ifNoneMatch) {
        const ifModifiedSince = req.headers['if-modified-since'];
        if (ifModifiedSince) {
          const since = new Date(ifModifiedSince).getTime();
          const modified = new Date(lastModified).getTime();
          if (!isNaN(since) && modified <= since) {
            res.status(304);
            return res.end();
          }
        }
      }

      return originalJson(body);
    };

    next();
  };
}

module.exports = { cacheMiddleware, generateETag, buildCacheControl, MAX_AGE };
