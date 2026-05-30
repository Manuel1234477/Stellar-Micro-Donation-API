/**
 * Network Fee Service
 *
 * RESPONSIBILITY: Fetch and cache Stellar network fee statistics from Horizon
 * OWNER: Backend Team
 * DEPENDENCIES: Cache utility, https (built-in)
 *
 * Security: Only exposes public fee data from Horizon. No sensitive data is
 * included in responses. Horizon URL is server-controlled, not user-supplied.
 */

'use strict';

const https = require('https');
const http = require('http');
const Cache = require('../utils/cache');
const log = require('../utils/log');

const CACHE_KEY = 'network:fee_stats';
const CACHE_TTL_MS = 30_000; // 30 seconds

/**
 * Fetch JSON from a URL using Node's built-in http/https.
 * @param {string} url
 * @returns {Promise<Object>}
 */
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse Horizon response: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Horizon request timed out')); });
  });
}

/**
 * Determine congestion level from Horizon's ledger_capacity_usage.
 * @param {string|number} capacityUsage - Value between 0 and 1
 * @returns {'low'|'medium'|'high'}
 */
function getCongestionLevel(capacityUsage) {
  const usage = parseFloat(capacityUsage) || 0;
  if (usage >= 0.8) return 'high';
  if (usage >= 0.5) return 'medium';
  return 'low';
}

/**
 * Build fee recommendations from Horizon fee_charged percentiles.
 * @param {Object} feeCharged - fee_charged object from Horizon
 * @returns {{ fast: string, standard: string, slow: string }}
 */
function buildRecommendations(feeCharged) {
  return {
    fast: feeCharged.p90 || feeCharged.max || '1000',
    standard: feeCharged.p50 || feeCharged.mode || '100',
    slow: feeCharged.p10 || feeCharged.min || '100',
  };
}

/**
 * Fetch fee stats from Horizon and cache for 30 seconds.
 * @param {string} horizonUrl - Base Horizon URL
 * @returns {Promise<Object>} Fee stats response object
 */
async function getFeeStats(horizonUrl) {
  const cached = Cache.get(CACHE_KEY);
  if (cached) {
    return { ...cached, cached: true };
  }

  log.info('NETWORK_FEE_SERVICE', 'Fetching fee stats from Horizon', { horizonUrl });

  const raw = await fetchJson(`${horizonUrl}/fee_stats`);

  const result = {
    current: {
      lastLedger: raw.last_ledger,
      lastLedgerBaseFee: raw.last_ledger_base_fee,
      ledgerCapacityUsage: raw.ledger_capacity_usage,
      feeCharged: raw.fee_charged,
      maxFee: raw.max_fee,
    },
    recommendations: buildRecommendations(raw.fee_charged || {}),
    congestion: getCongestionLevel(raw.ledger_capacity_usage),
    cachedAt: new Date().toISOString(),
    cached: false,
  };

  Cache.set(CACHE_KEY, result, CACHE_TTL_MS);
  return result;
}

module.exports = { getFeeStats, getCongestionLevel, buildRecommendations };
