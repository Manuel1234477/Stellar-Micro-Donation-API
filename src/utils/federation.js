/**
 * Federation Utility - Stellar Federation Protocol Layer
 *
 * RESPONSIBILITY: Resolve Stellar federation addresses to public keys,
 *   with in-memory caching and graceful error handling.
 * OWNER: Backend Team
 * DEPENDENCIES: stellar-sdk (Federation.Server), log
 *
 * Federation address format: <name>*<domain>  e.g. alice*example.com
 * Resolution flow:
 *   1. Fetch stellar.toml from https://<domain>/.well-known/stellar.toml
 *   2. Extract FEDERATION_SERVER URL
 *   3. Query federation server: GET <url>?q=<address>&type=name
 *   4. Return { account_id, memo_type?, memo? }
 */

'use strict';

const { Federation } = require('stellar-sdk');
const log = require('./log');
const { assertSafeOutboundUrl } = require('./ssrf');

/** Regex for a valid federation address */
const FEDERATION_ADDRESS_RE = /^[^*\s]+\*[^*\s]+\.[^*\s]+$/;

/** In-memory cache: address → { result, expiresAt } */
const _cache = new Map();

/** Cache TTL in ms (1 hour) */
const CACHE_TTL_MS = 60 * 60 * 1000;

/** Maximum number of entries in the federation cache before eviction starts */
const MAX_CACHE_SIZE = parseInt(process.env.FEDERATION_CACHE_MAX_SIZE, 10) || 5000;

/** How often (ms) to sweep expired entries from the cache */
const CLEANUP_INTERVAL_MS = parseInt(process.env.FEDERATION_CACHE_CLEANUP_INTERVAL_MS, 10) || 300000;

/** Background cleanup timer handle */
let _cleanupTimer = null;

/**
 * Check whether a string looks like a federation address.
 * @param {string} value
 * @returns {boolean}
 */
function isFederationAddress(value) {
  return typeof value === 'string' && FEDERATION_ADDRESS_RE.test(value);
}

/**
 * Resolve a federation address to a Stellar public key (with 1-hour cache).
 *
 * @param {string} address - Federation address, e.g. "alice*example.com"
 * @param {object} [opts]
 * @param {Function} [opts._resolverFn] - Override for unit testing (replaces SDK call)
 * @returns {Promise<{account_id: string, memo_type?: string, memo?: string}>}
 * @throws {Error} If the address is invalid, not found, or the server is unreachable
 */
async function resolveAddress(address, { _resolverFn } = {}) {
  if (!isFederationAddress(address)) {
    throw new Error(`Invalid federation address: "${address}"`);
  }

  // Cache hit
  const cached = _cache.get(address);
  if (cached && Date.now() < cached.expiresAt) {
    log.debug('FEDERATION', 'Cache hit', { address });
    return cached.result;
  }

  log.debug('FEDERATION', 'Resolving federation address', { address });

  // SSRF: validate the home domain before fetching stellar.toml / querying federation server
  const domain = address.split('*')[1];
  await assertSafeOutboundUrl(`https://${domain}/.well-known/stellar.toml`);

  try {
    let result;
    if (_resolverFn) {
      result = await _resolverFn(address);
    } else {
      result = await Federation.Server.resolve(address);
    }

    if (!result || !result.account_id) {
      throw new Error(`Federation address not found: "${address}"`);
    }

    _cache.set(address, { result, expiresAt: Date.now() + CACHE_TTL_MS });
    // Enforce max cache size — evict oldest entry if over limit
    if (_cache.size > MAX_CACHE_SIZE) {
      const oldest = _cache.keys().next().value;
      if (oldest) _cache.delete(oldest);
    }
    log.debug('FEDERATION', 'Resolved federation address', { address, account_id: result.account_id });
    return result;
  } catch (error) {
    // Re-throw with a clean message; don't cache failures
    const msg = error.message || String(error);
    log.warn('FEDERATION', 'Failed to resolve federation address', { address, error: msg });
    throw new Error(`Federation resolution failed for "${address}": ${msg}`);
  }
}

/**
 * Resolve a value that may be either a federation address or a raw public key.
 * If it's a raw key, returns it unchanged.
 *
 * @param {string} recipientOrAddress
 * @param {object} [opts] - Passed through to resolveAddress
 * @returns {Promise<string>} Stellar public key
 */
async function resolveRecipient(recipientOrAddress, opts = {}) {
  if (!isFederationAddress(recipientOrAddress)) {
    return recipientOrAddress; // already a public key
  }
  const { account_id } = await resolveAddress(recipientOrAddress, opts);
  return account_id;
}

/**
 * Clear the federation cache (useful for testing).
 */
function clearCache() {
  _cache.clear();
}

/**
 * Get current cache size (useful for testing).
 * @returns {number}
 */
function getCacheSize() {
  return _cache.size;
}

/**
 * Remove all expired entries from the federation cache.
 * @returns {number} Number of expired entries removed
 */
function cleanupCache() {
  const now = Date.now();
  let removed = 0;
  for (const [address, entry] of _cache) {
    if (now >= entry.expiresAt) {
      _cache.delete(address);
      removed++;
    }
  }
  return removed;
}

/**
 * Start periodic background cleanup of expired federation cache entries.
 * Safe to call multiple times — only one timer runs.
 */
function startCacheCleanup() {
  if (_cleanupTimer) return;
  _cleanupTimer = setInterval(cleanupCache, CLEANUP_INTERVAL_MS);
  if (_cleanupTimer.unref) _cleanupTimer.unref();
}

/**
 * Stop the background federation cache cleanup timer.
 */
function stopCacheCleanup() {
  if (_cleanupTimer) {
    clearInterval(_cleanupTimer);
    _cleanupTimer = null;
  }
}

module.exports = { isFederationAddress, resolveAddress, resolveRecipient, clearCache, getCacheSize, cleanupCache, startCacheCleanup, stopCacheCleanup };
