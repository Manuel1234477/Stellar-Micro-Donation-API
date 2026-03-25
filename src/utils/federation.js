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

/** Regex for a valid federation address */
const FEDERATION_ADDRESS_RE = /^[^*\s]+\*[^*\s]+\.[^*\s]+$/;

/** In-memory cache: address → { result, expiresAt } */
const _cache = new Map();

/** Cache TTL in ms (1 hour) */
const CACHE_TTL_MS = 60 * 60 * 1000;

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

module.exports = { isFederationAddress, resolveAddress, resolveRecipient, clearCache, getCacheSize };
