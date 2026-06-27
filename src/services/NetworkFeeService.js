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

const REQUEST_TIMEOUT_MS = parseInt(process.env.HORIZON_API_TIMEOUT_MS, 10) || 5_000;
const MAX_RETRY_ATTEMPTS = parseInt(process.env.HORIZON_MAX_RETRY_ATTEMPTS, 10) || 3;
const RETRY_BASE_DELAY_MS = parseInt(process.env.HORIZON_RETRY_BASE_DELAY_MS, 10) || 200;
const RETRY_MAX_DELAY_MS = parseInt(process.env.HORIZON_RETRY_MAX_DELAY_MS, 10) || 2_000;

/** HTTP status codes that warrant a retry */
const RETRYABLE_STATUSES = new Set([408, 429, 502, 503, 504]);

/**
 * Exponential backoff with ±20 % jitter (mirrors StellarService._getBackoffDelay).
 * @param {number} attempt - 1-indexed
 * @returns {number} delay in ms
 */
function backoffDelay(attempt) {
  const exp = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
  const capped = Math.min(exp, RETRY_MAX_DELAY_MS);
  const jitter = capped * (Math.random() * 0.4 - 0.2);
  return Math.max(0, Math.round(capped + jitter));
}

/**
 * Fetch JSON from a URL using Node's built-in http/https.
 * Retries on transient network errors and retryable HTTP status codes.
 * @param {string} url
 * @returns {Promise<Object>}
 */
async function fetchJson(url) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      const result = await new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        const req = client.get(url, { timeout: REQUEST_TIMEOUT_MS }, (res) => {
          if (RETRYABLE_STATUSES.has(res.statusCode)) {
            res.resume();
            reject(Object.assign(new Error(`Horizon returned HTTP ${res.statusCode}`), { statusCode: res.statusCode }));
            return;
          }
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try { resolve(JSON.parse(data)); }
            catch (e) { reject(new Error(`Failed to parse Horizon response: ${e.message}`)); }
          });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Horizon request timed out')); });
      });
      return result;
    } catch (err) {
      lastErr = err;
      const isRetryable = RETRYABLE_STATUSES.has(err.statusCode) ||
        ['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH'].includes(err.code) ||
        (err.message && (err.message.includes('timed out') || err.message.includes('ECONNRESET')));

      if (!isRetryable || attempt === MAX_RETRY_ATTEMPTS) throw err;

      const delay = backoffDelay(attempt);
      log.debug('NETWORK_FEE_SERVICE', 'Retrying Horizon fee_stats request', {
        attempt, delay, error: err.message,
      });
      await new Promise(r => setTimeout(r, delay)); // eslint-disable-line local/no-bare-timers
    }
  }
  throw lastErr;
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
