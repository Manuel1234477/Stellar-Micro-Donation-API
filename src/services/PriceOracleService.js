/**
 * Price Oracle Service
 *
 * RESPONSIBILITY: Fetch and cache XLM exchange rates from CoinGecko, falling
 *                 back to the Stellar DEX orderbook when CoinGecko is down
 * OWNER: Backend Team
 * DEPENDENCIES: https (built-in), StellarService (lazily, for the DEX fallback), log utility
 *
 * Fetches XLM/fiat rates with a 5-minute in-memory cache shared by both sources.
 * When CoinGecko is unavailable or rate-limited, the XLM/USDC orderbook on the
 * Stellar DEX provides an on-chain XLM/USD rate with no third-party dependency.
 * The source backing the current cache is reported on GET /health.
 */

const https = require('https');
const log = require('../utils/log');
const { convertToXLMWithMeta } = require('../utils/currencyConversion');

const SUPPORTED_CURRENCIES = ['usd', 'eur', 'gbp'];
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=' +
  SUPPORTED_CURRENCIES.join(',');

/** Price source identifiers, as reported on GET /health */
const PRICE_SOURCES = {
  COINGECKO: 'coingecko',
  STELLAR_DEX: 'stellar_dex',
  NONE: 'none',
};

/**
 * Circle USDC issuers per Stellar network. USDC is dollar-denominated, so the
 * XLM/USDC mid-market price doubles as an XLM/USD rate. Override with
 * XLM_USDC_ASSET ("CODE:ISSUER") to price against a different stablecoin.
 */
const USDC_ISSUERS = new Map([
  // Issuer addresses are public account IDs, not credentials.
  // eslint-disable-next-line no-secrets/no-secrets
  ['mainnet', 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'],
  // eslint-disable-next-line no-secrets/no-secrets
  ['testnet', 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'],
]);

/** Only the top of the book is needed to derive a mid-market price */
const DEX_ORDERBOOK_DEPTH = 1;

let cache = {
  rates: null,   // { usd: 0.12, eur: 0.11, gbp: 0.09 }
  fetchedAt: 0,  // epoch ms
  source: PRICE_SOURCES.NONE,
};

/**
 * Fetch rates from CoinGecko (raw HTTP, no extra deps).
 * Sends the COINGECKO_API_KEY demo-plan header when configured; without a key
 * CoinGecko still answers but with stricter public rate limits.
 * @returns {Promise<Object>} rates map e.g. { usd: 0.12, eur: 0.11, gbp: 0.09 }
 */
function fetchFromCoinGecko() {
  const options = { timeout: 5000 };
  if (process.env.COINGECKO_API_KEY) {
    options.headers = { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY };
  }
  return new Promise((resolve, reject) => {
    https
      .get(COINGECKO_URL, options, (res) => {
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
 * Resolve the counter asset used for DEX price discovery.
 * @returns {string} Asset in "CODE:ISSUER" form
 * @throws {Error} When no issuer is known for the active network
 */
function resolveDexCounterAsset() {
  if (process.env.XLM_USDC_ASSET) return process.env.XLM_USDC_ASSET;

  const network = (process.env.STELLAR_NETWORK || process.env.STELLAR_ENVIRONMENT || 'testnet').toLowerCase();
  const issuer = USDC_ISSUERS.get(network);
  if (!issuer) {
    throw new Error(`No USDC issuer known for network "${network}". Set XLM_USDC_ASSET to "CODE:ISSUER".`);
  }
  return `USDC:${issuer}`;
}

/**
 * Derive the mid-market price from the best bid and the best ask of an
 * orderbook. Prices are quoted in counter asset per base asset, so for the
 * XLM/USDC book this is USD per XLM.
 *
 * @param {Object} orderbook - Horizon orderbook payload ({ bids, asks })
 * @returns {number} Mid-market price
 * @throws {Error} When either side of the book is empty or unusable
 */
function midMarketPrice(orderbook) {
  const bestBid = parseFloat(orderbook && orderbook.bids && orderbook.bids[0] && orderbook.bids[0].price);
  const bestAsk = parseFloat(orderbook && orderbook.asks && orderbook.asks[0] && orderbook.asks[0].price);

  if (!Number.isFinite(bestBid) || bestBid <= 0) {
    throw new Error('Orderbook has no usable bid');
  }
  if (!Number.isFinite(bestAsk) || bestAsk <= 0) {
    throw new Error('Orderbook has no usable ask');
  }

  return (bestBid + bestAsk) / 2;
}

/**
 * Fetch the XLM/USD rate from the Stellar DEX via the Horizon orderbook API.
 * Only USD is available from this source; USDC is the quote asset.
 *
 * @returns {Promise<Object>} rates map e.g. { usd: 0.12 }
 */
async function fetchFromStellarDex() {
  const { getStellarService } = require('../config/stellar');
  const counterAsset = resolveDexCounterAsset();
  const orderbook = await getStellarService().getOrderBook('XLM', counterAsset, DEX_ORDERBOOK_DEPTH);
  return { usd: midMarketPrice(orderbook) };
}

/**
 * Return cached rates, refreshing if stale.
 *
 * Refresh order: CoinGecko, then the Stellar DEX orderbook, then the stale
 * cache. A fresh DEX price is preferred over a stale cached one; the stale
 * cache is only used when both sources are unreachable.
 *
 * @returns {Promise<Object>} rates map
 */
async function getRates() {
  const now = Date.now();
  if (cache.rates && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.rates;
  }

  // Call through module.exports so Jest spies can intercept individual sources
  const self = module.exports;

  let coinGeckoError;
  try {
    const rates = await self.fetchFromCoinGecko();
    cache = { rates, fetchedAt: now, source: PRICE_SOURCES.COINGECKO };
    log.info('PRICE_ORACLE', 'Exchange rates refreshed', { source: cache.source, rates });
    return rates;
  } catch (err) {
    coinGeckoError = err;
    log.warn('PRICE_ORACLE', 'CoinGecko unavailable, falling back to Stellar DEX', { error: err.message });
  }

  try {
    const rates = await self.fetchFromStellarDex();
    cache = { rates, fetchedAt: now, source: PRICE_SOURCES.STELLAR_DEX };
    log.info('PRICE_ORACLE', 'Exchange rates refreshed', { source: cache.source, rates });
    return rates;
  } catch (dexErr) {
    log.warn('PRICE_ORACLE', 'Stellar DEX orderbook unavailable', { error: dexErr.message });

    if (cache.rates) {
      log.warn('PRICE_ORACLE', 'Serving stale cached rates', { source: cache.source });
      return cache.rates;
    }

    throw new Error(
      `Failed to fetch exchange rates — CoinGecko: ${coinGeckoError.message}; Stellar DEX: ${dexErr.message}`
    );
  }
}

/**
 * Report which source backs the currently cached rates, for GET /health.
 *
 * Reads in-memory state only — never triggers a fetch — so it is safe to call
 * from the health endpoint's bounded-time checks.
 *
 * @returns {{source: string, cached: boolean, stale: boolean, ageMs: (number|null), ttlMs: number, lastUpdatedAt: (string|null), currencies: string[]}}
 */
function getPriceSourceStatus() {
  const cached = Boolean(cache.rates);
  const ageMs = cached ? Date.now() - cache.fetchedAt : null;

  return {
    source: cache.source || PRICE_SOURCES.NONE,
    cached,
    stale: cached ? ageMs >= CACHE_TTL_MS : false,
    ageMs,
    ttlMs: CACHE_TTL_MS,
    lastUpdatedAt: cached ? new Date(cache.fetchedAt).toISOString() : null,
    currencies: cached ? Object.keys(cache.rates).map((c) => c.toUpperCase()) : [],
  };
}

/**
 * Convert an amount in the given fiat currency to XLM using the central
 * rounding policy (round-half-even, 7 decimal places).
 *
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
  // rates[key] = price of 1 XLM in that currency (e.g. 0.10 USD/XLM)
  // rateXLMperUnit = how many XLM 1 unit buys = 1 / rates[key]
  const xlmPrice = rates[key];
  if (!xlmPrice || xlmPrice <= 0) {
    // The DEX fallback only prices XLM against USDC, so non-USD currencies are
    // unavailable while it is the active source.
    throw new Error(`Invalid rate for ${currency} (active price source: ${cache.source})`);
  }

  const rateXLMperUnit = 1 / xlmPrice;
  const { xlm } = convertToXLMWithMeta(amount, currency, rateXLMperUnit, new Date().toISOString());
  return xlm;
}

/**
 * Invalidate the cache (useful for testing).
 */
function invalidateCache() {
  cache = { rates: null, fetchedAt: 0, source: PRICE_SOURCES.NONE };
}

module.exports = {
  getRates,
  convertToXLM,
  invalidateCache,
  _clearCache: invalidateCache,
  fetchFromCoinGecko,
  fetchFromStellarDex,
  midMarketPrice,
  getPriceSourceStatus,
  SUPPORTED_CURRENCIES,
  PRICE_SOURCES,
  CACHE_TTL_MS,
};
