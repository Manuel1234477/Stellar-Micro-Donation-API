/**
 * Price Oracle Service
 *
 * RESPONSIBILITY: Fetch and cache XLM exchange rates from CoinGecko
 * OWNER: Backend Team
 * DEPENDENCIES: https (built-in), log utility
 *
 * Fetches XLM/fiat rates with a 5-minute in-memory cache.
 * Falls back gracefully when the external API is unavailable.
 */

const https = require('https');
const log = require('../utils/log');

const SUPPORTED_CURRENCIES = ['usd', 'eur', 'gbp'];
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=' +
  SUPPORTED_CURRENCIES.join(',');

let cache = {
  rates: null,   // { usd: 0.12, eur: 0.11, gbp: 0.09 }
  fetchedAt: 0,  // epoch ms
};

/**
 * Fetch rates from CoinGecko (raw HTTP, no extra deps).
 * @returns {Promise<Object>} rates map e.g. { usd: 0.12, eur: 0.11, gbp: 0.09 }
 */
function fetchFromCoinGecko() {
  return new Promise((resolve, reject) => {
    https
      .get(COINGECKO_URL, { timeout: 5000 }, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            if (!json.stellar) {
              return reject(new Error('Unexpected CoinGecko response shape'));
            }
            resolve(json.stellar); // { usd: ..., eur: ..., gbp: ... }
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject)
      .on('timeout', function () {
        this.destroy(new Error('CoinGecko request timed out'));
      });
  });
}

/**
 * Return cached rates, refreshing if stale.
 * @returns {Promise<Object>} rates map
 */
async function getRates() {
  const now = Date.now();
  if (cache.rates && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.rates;
  }

  try {
    const rates = await fetchFromCoinGecko();
    cache = { rates, fetchedAt: now };
    log.info('PRICE_ORACLE', 'Exchange rates refreshed', { rates });
    return rates;
  } catch (err) {
    log.warn('PRICE_ORACLE', 'Failed to fetch exchange rates', { error: err.message });
    if (cache.rates) {
      log.warn('PRICE_ORACLE', 'Serving stale cached rates');
      return cache.rates;
    }
    throw err;
  }
}

/**
 * Convert an amount in the given fiat currency to XLM.
 * @param {number} amount
 * @param {string} currency  e.g. "USD"
 * @returns {Promise<number>} XLM amount (7 decimal places)
 */
async function convertToXLM(amount, currency) {
  const key = currency.toLowerCase();
  if (key === 'xlm') return amount;

  if (!SUPPORTED_CURRENCIES.includes(key)) {
    throw new Error(`Unsupported currency: ${currency}. Supported: XLM, ${SUPPORTED_CURRENCIES.map(c => c.toUpperCase()).join(', ')}`);
  }

  const rates = await getRates();
  const xlmPerUnit = rates[key]; // e.g. 0.12 USD per 1 XLM  →  1 USD = 1/0.12 XLM
  if (!xlmPerUnit || xlmPerUnit <= 0) {
    throw new Error(`Invalid rate for ${currency}`);
  }

  return parseFloat((amount / xlmPerUnit).toFixed(7));
}

/**
 * Invalidate the cache (useful for testing).
 */
function invalidateCache() {
  cache = { rates: null, fetchedAt: 0 };
}

module.exports = { getRates, convertToXLM, invalidateCache, SUPPORTED_CURRENCIES };
