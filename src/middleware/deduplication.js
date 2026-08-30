/**
 * Body Hash Deduplication Middleware
 *
 * Provides server-side request deduplication via SHA-256 body hash fingerprinting.
 * Catches duplicate mutating requests (POST, PUT, PATCH) even when no Idempotency-Key
 * is supplied — a safety net for mobile clients on unstable connections.
 *
 * Algorithm:
 *   1. Normalise the parsed request body (sort keys recursively, JSON.stringify).
 *   2. Compute SHA-256("{apiKey}:{method}:{path}:{normalisedBody}").
 *   3. On cache hit within TTL → return cached response + X-Deduplicated: true header.
 *   4. On cache miss → continue to route handler, cache the response before sending.
 *
 * Precedence rule: if an Idempotency-Key header is present this middleware is a no-op;
 * the existing idempotency layer handles the request exclusively.
 *
 * Configuration:
 *   options.ttlMs  — deduplication window in ms.
 *   env BODY_DEDUP_WINDOW_SECONDS — fallback env-var (seconds). Default: 60 s.
 */

'use strict';

const crypto = require('crypto');

/** @type {Map<string, {status: number, body: *, expiresAt: number}>} */
const _cache = new Map();

/** HTTP methods eligible for deduplication. */
const MUTABLE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Normalise a parsed request body to a canonical JSON string.
 * Object keys are sorted recursively so key-order differences produce the same hash.
 *
 * @param {*} body
 * @returns {string}
 */
function normaliseBody(body) {
  if (body === null || body === undefined) return '';
  if (typeof body !== 'object') return String(body);

  function sortedReplacer(_key, value) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, v]) => v !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
      );
    }
    return value;
  }

  return JSON.stringify(body, sortedReplacer);
}

/**
 * Compute the deduplication cache key for a request.
 * Scoped by apiKey so two different callers with the same body are NOT deduplicated.
 *
 * @param {string} apiKey
 * @param {string} method
 * @param {string} path
 * @param {*}      body
 * @returns {string} SHA-256 hex digest
 */
function computeHash(apiKey, method, path, body) {
  const payload = `${apiKey}:${method}:${path}:${normaliseBody(body)}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/** Evict all expired entries — called on every middleware invocation to keep the Map lean. */
function evictExpired() {
  const now = Date.now();
  for (const [key, entry] of _cache.entries()) {
    if (entry.expiresAt <= now) _cache.delete(key);
  }
}

/**
 * Clear the entire deduplication cache.
 * Called by tests/setup.js between test files for isolation.
 */
function clearCache() {
  _cache.clear();
}

/**
 * Factory — returns an Express middleware function.
 *
 * @param {object} [options]
 * @param {number} [options.ttlMs] - Deduplication window in ms.
 * @returns {import('express').RequestHandler}
 */
function createDeduplicationMiddleware(options = {}) {
  const ttlMs =
    options.ttlMs ??
    (parseInt(process.env.BODY_DEDUP_WINDOW_SECONDS, 10) || 60) * 1000;

  return function deduplicationMiddleware(req, res, next) {
    // Only deduplicate mutating requests.
    if (!MUTABLE_METHODS.has(req.method)) return next();

    // Precedence: explicit Idempotency-Key → skip body-hash logic.
    const idempotencyKey =
      req.headers['idempotency-key'] || req.headers['x-idempotency-key'];
    if (idempotencyKey) return next();

    // Opportunistic eviction.
    evictExpired();

    // Resolve the caller's API key identifier.
    const apiKey =
      (req.apiKey && (req.apiKey.id || req.apiKey.key)) ||
      req.headers['x-api-key'] ||
      'anonymous';

    const hash = computeHash(apiKey, req.method, req.path, req.body);
    const now = Date.now();
    const cached = _cache.get(hash);

    if (cached && cached.expiresAt > now) {
      // Cache hit — replay the original response.
      res.setHeader('X-Deduplication-Source', 'body-hash');
      res.setHeader('X-Deduplicated', 'true');
      return res.status(cached.status).json(cached.body);
    }

    // Cache miss — wrap res.json to capture the response before it is sent.
    const originalJson = res.json.bind(res);
    res.json = function interceptJson(data) {
      const statusCode = res.statusCode;
      // Only cache successful (2xx) responses.
      if (statusCode >= 200 && statusCode < 300) {
        _cache.set(hash, {
          status: statusCode,
          body: data,
          expiresAt: Date.now() + ttlMs,
        });
      }
      res.json = originalJson; // restore
      return originalJson(data);
    };

    return next();
  };
}

module.exports = { createDeduplicationMiddleware, clearCache, computeHash, normaliseBody };
