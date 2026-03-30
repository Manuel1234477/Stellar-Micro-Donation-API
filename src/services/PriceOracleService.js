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

const SUPPORTED_CURRENCIES = ['usd', 'eur', 'btc'];
const CACHE_TTL_MS = 60 * 1000; // 60 seconds
const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=stellar,bitcoin&vs_currencies=usd,eur';

let cache = {
  rates: null,   // { usd: 0.12, eur: 0.11, gbp: 0.09 }
  fetchedAt: 0,  // epoch ms
};

/**
 * Fetch rates from CoinGecko (raw HTTP, no extra deps).
 * Returns a normalised map: { usd: <XLM per USD>, eur: <XLM per EUR>, btc: <XLM per BTC> }
 * where each value is "how many XLM you get for 1 unit of that currency".
 * @returns {Promise<Object>}
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
            // XLM price in USD and EUR
            const xlmUsd = json.stellar.usd;
            const xlmEur = json.stellar.eur;
            // BTC price in USD; derive XLM/BTC rate
            const btcUsd = json.bitcoin && json.bitcoin.usd;

            const rates = { usd: xlmUsd, eur: xlmEur };
            if (btcUsd && xlmUsd) {
              // rates[key] = "price of 1 XLM in that currency"
              // For BTC: 1 XLM = (xlmUsd / btcUsd) BTC
              rates.btc = xlmUsd / btcUsd;
            }
            resolve(rates);
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
 * Convert an amount in the given currency to XLM.
 * @param {number} amount
 * @param {string} currency  e.g. "USD", "EUR", "BTC"
 * @returns {Promise<{ xlmAmount: number, rate: number }>}
 */
async function convertToXLM(amount, currency) {
  const key = currency.toLowerCase();
  if (key === 'xlm') return { xlmAmount: amount, rate: 1 };

  if (!SUPPORTED_CURRENCIES.includes(key)) {
    throw new Error(`Unsupported currency: ${currency}. Supported: XLM, ${SUPPORTED_CURRENCIES.map(c => c.toUpperCase()).join(', ')}`);
  }

  const rates = await getRates();
  const xlmPerUnit = rates[key]; // e.g. for USD: 1 USD = (1/xlmUsd) XLM
  if (!xlmPerUnit || xlmPerUnit <= 0) {
    throw new Error(`Invalid rate for ${currency}`);
  }

  // rates[key] is the XLM price in that currency (e.g. 0.10 USD per XLM)
  // So 1 unit of currency = 1/rate XLM
  const xlmAmount = parseFloat((amount / xlmPerUnit).toFixed(7));
  return { xlmAmount, rate: xlmPerUnit };
}

/**
 * Invalidate the cache (useful for testing).
 */
function invalidateCache() {
  cache = { rates: null, fetchedAt: 0 };
}

module.exports = { getRates, convertToXLM, invalidateCache, SUPPORTED_CURRENCIES };
