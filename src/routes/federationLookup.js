'use strict';

/**
 * Federation Lookup Routes - Public Endpoint Layer
 *
 * RESPONSIBILITY: Expose federation address resolution and reverse lookup
 *   as public HTTP endpoints backed by TTL caching.
 * OWNER: Backend Team
 * DEPENDENCIES: stellar-sdk (lazy), log
 *
 * Endpoints (no auth required):
 *   GET /federation/resolve?address=user*domain.org  → resolves to public key
 *   GET /federation/reverse?publicKey=G...           → reverse lookup (best-effort)
 */

const express = require('express');
const router = express.Router();
const log = require('../utils/log');

/** Regex for a valid federation address */
const FEDERATION_ADDRESS_RE = /^[^*\s]+\*[^*\s]+\.[^*\s]+$/;

/** TTL in ms from env (default 300 s) */
const CACHE_TTL_MS = (parseInt(process.env.FEDERATION_CACHE_TTL, 10) || 300) * 1000;

/** Forward cache: address → { result, expiresAt } */
const _forwardCache = new Map();

/** Reverse cache: publicKey → { result, expiresAt } */
const _reverseCache = new Map();

/**
 * Resolve a federation address with TTL caching.
 * @param {string} address
 * @param {Function} [_resolverFn] - Override for testing
 * @returns {Promise<{account_id: string, memo_type?: string, memo?: string}>}
 */
async function resolveFederationAddress(address, _resolverFn) {
  const cached = _forwardCache.get(address);
  if (cached && Date.now() < cached.expiresAt) {
    log.debug('FEDERATION_LOOKUP', 'Cache hit (forward)', { address });
    return { ...cached.result, _cached: true };
  }

  let result;
  if (_resolverFn) {
    result = await _resolverFn(address);
  } else {
    const { Federation } = require('stellar-sdk');
    const server = new Federation.Server('https://horizon-testnet.stellar.org');
    result = await server.resolveAddress(address);
  }

  if (!result || !result.account_id) {
    throw new Error(`Federation address not found: "${address}"`);
  }

  _forwardCache.set(address, { result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}

/**
 * GET /federation/resolve?address=user*domain.org
 * Resolve a federation address to a Stellar public key.
 * No authentication required.
 */
router.get('/resolve', async (req, res) => {
  const { address } = req.query;

  if (!address) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_PARAMETER', message: 'address query parameter is required' }
    });
  }

  if (!FEDERATION_ADDRESS_RE.test(address)) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_FORMAT', message: 'Invalid federation address format. Expected: user*domain.org' }
    });
  }

  try {
    const result = await resolveFederationAddress(address, req._resolverFn);
    const cached = !!result._cached;
    const { _cached, ...data } = result; // eslint-disable-line no-unused-vars

    return res.json({ success: true, data: { address, ...data }, cached });
  } catch (error) {
    const msg = error.message || String(error);

    if (/ETIMEDOUT|ECONNREFUSED|timeout|timed out|ENOTFOUND/i.test(msg)) {
      return res.status(504).json({
        success: false,
        error: { code: 'FEDERATION_TIMEOUT', message: `Federation server timed out for address: ${address}` }
      });
    }
    if (/not found|404/i.test(msg)) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: `Federation address not found: ${address}` }
      });
    }

    log.warn('FEDERATION_LOOKUP', 'Resolution failed', { address, error: msg });
    return res.status(502).json({
      success: false,
      error: { code: 'FEDERATION_ERROR', message: msg }
    });
  }
});

/**
 * GET /federation/reverse?publicKey=G...
 * Reverse federation lookup: resolve a public key to a federation address.
 * No authentication required.
 */
router.get('/reverse', async (req, res) => {
  const { publicKey } = req.query;

  if (!publicKey) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_PARAMETER', message: 'publicKey query parameter is required' }
    });
  }

  if (!/^G[A-Z2-7]{55}$/.test(publicKey)) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_FORMAT', message: 'Invalid Stellar public key format' }
    });
  }

  const cached = _reverseCache.get(publicKey);
  if (cached && Date.now() < cached.expiresAt) {
    log.debug('FEDERATION_LOOKUP', 'Cache hit (reverse)', { publicKey });
    return res.json({ success: true, data: cached.result, cached: true });
  }

  try {
    let result;
    if (req._reverseResolverFn) {
      result = await req._reverseResolverFn(publicKey);
    } else {
      const { Federation } = require('stellar-sdk');
      const server = new Federation.Server('https://horizon-testnet.stellar.org');
      result = await server.resolveAccountId(publicKey);
    }

    const data = {
      publicKey,
      federationAddress: result.stellar_address || result.federation_address || null,
      memoType: result.memo_type || null,
      memo: result.memo || null,
    };

    _reverseCache.set(publicKey, { result: data, expiresAt: Date.now() + CACHE_TTL_MS });
    return res.json({ success: true, data, cached: false });
  } catch (error) {
    const msg = error.message || String(error);

    if (/ETIMEDOUT|ECONNREFUSED|timeout|timed out|ENOTFOUND/i.test(msg)) {
      return res.status(504).json({
        success: false,
        error: { code: 'FEDERATION_TIMEOUT', message: `Federation server timed out for key: ${publicKey}` }
      });
    }
    if (/not found|404/i.test(msg)) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: `No federation address found for public key: ${publicKey}` }
      });
    }

    log.warn('FEDERATION_LOOKUP', 'Reverse resolution failed', { publicKey, error: msg });
    return res.status(502).json({
      success: false,
      error: { code: 'FEDERATION_ERROR', message: msg }
    });
  }
});

/** Clear caches (for testing) */
function clearCaches() {
  _forwardCache.clear();
  _reverseCache.clear();
}

module.exports = { router, resolveFederationAddress, clearCaches, _forwardCache, _reverseCache };
