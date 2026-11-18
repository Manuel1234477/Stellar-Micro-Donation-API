'use strict';

/**
 * Tests for PriceOracleService – fetching, caching, and conversion
 */

const https = require('https');
const { EventEmitter } = require('events');

function mockHttpsGet(responseBody) {
  const res = new EventEmitter();
  const req = new EventEmitter();
  req.destroy = jest.fn();

  jest.spyOn(https, 'get').mockImplementation((_url, _opts, cb) => {
    const handler = typeof _opts === 'function' ? _opts : cb;
    if (handler) handler(res);
    process.nextTick(() => {
      res.emit('data', JSON.stringify(responseBody));
      res.emit('end');
    });
    return req;
  });
}

function mockHttpsGetError(errorMessage) {
  const req = new EventEmitter();
  req.destroy = jest.fn();

  jest.spyOn(https, 'get').mockImplementation(() => {
    process.nextTick(() => req.emit('error', new Error(errorMessage)));
    return req;
  });
}

/**
 * Load a fresh oracle instance whose DEX fallback talks to a stubbed
 * StellarService, so no Horizon call is ever made.
 */
function loadOracleWithDex(getOrderBook) {
  jest.resetModules();
  jest.doMock('../../src/config/stellar', () => ({
    getStellarService: () => ({ getOrderBook }),
  }));
  return require('../../src/services/PriceOracleService');
}

describe('PriceOracleService', () => {
  let oracle;

  beforeEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
    oracle = require('../../src/services/PriceOracleService');
    oracle.invalidateCache();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getRates()', () => {
    it('fetches and returns rates from CoinGecko', async () => {
      mockHttpsGet({ stellar: { usd: 0.12, eur: 0.11, gbp: 0.09 } });
      const rates = await oracle.getRates();
      expect(rates).toEqual({ usd: 0.12, eur: 0.11, gbp: 0.09 });
    });

    it('caches rates and does not re-fetch within TTL', async () => {
      mockHttpsGet({ stellar: { usd: 0.12, eur: 0.11, gbp: 0.09 } });
      await oracle.getRates();
      await oracle.getRates();
      expect(https.get).toHaveBeenCalledTimes(1);
    });

    it('re-fetches after cache is invalidated', async () => {
      mockHttpsGet({ stellar: { usd: 0.12, eur: 0.11, gbp: 0.09 } });
      await oracle.getRates();

      oracle.invalidateCache();
      jest.restoreAllMocks();
      mockHttpsGet({ stellar: { usd: 0.13, eur: 0.12, gbp: 0.10 } });

      const rates = await oracle.getRates();
      expect(rates.usd).toBe(0.13);
    });

    it('reports CoinGecko as the active source after a successful fetch', async () => {
      mockHttpsGet({ stellar: { usd: 0.12, eur: 0.11, gbp: 0.09 } });
      await oracle.getRates();
      expect(oracle.getPriceSourceStatus().source).toBe(oracle.PRICE_SOURCES.COINGECKO);
    });

    it('throws when both sources fail and no cache exists', async () => {
      const dexOracle = loadOracleWithDex(jest.fn().mockRejectedValue(new Error('Horizon down')));
      mockHttpsGetError('Connection refused');
      await expect(dexOracle.getRates()).rejects.toThrow();
    });
  });

  // ── Stellar DEX fallback (Issue #1567) ─────────────────────────────────────

  describe('Stellar DEX orderbook fallback', () => {
    const book = { bids: [{ price: '0.1000000' }], asks: [{ price: '0.1200000' }] };

    it('falls back to the DEX mid-market price when CoinGecko fails', async () => {
      const getOrderBook = jest.fn().mockResolvedValue(book);
      const dexOracle = loadOracleWithDex(getOrderBook);
      mockHttpsGetError('CoinGecko rate limited');

      const rates = await dexOracle.getRates();

      expect(rates.usd).toBeCloseTo(0.11, 7);
      expect(dexOracle.getPriceSourceStatus().source).toBe(dexOracle.PRICE_SOURCES.STELLAR_DEX);
    });

    it('queries the XLM/USDC orderbook', async () => {
      const getOrderBook = jest.fn().mockResolvedValue(book);
      const dexOracle = loadOracleWithDex(getOrderBook);
      mockHttpsGetError('CoinGecko rate limited');

      await dexOracle.getRates();

      expect(getOrderBook).toHaveBeenCalledWith('XLM', expect.stringMatching(/^USDC:G/), 1);
    });

    it('does not query the DEX while CoinGecko succeeds', async () => {
      const getOrderBook = jest.fn().mockResolvedValue(book);
      const dexOracle = loadOracleWithDex(getOrderBook);
      mockHttpsGet({ stellar: { usd: 0.12, eur: 0.11, gbp: 0.09 } });

      await dexOracle.getRates();

      expect(getOrderBook).not.toHaveBeenCalled();
    });

    it('caches the DEX price for the same TTL as CoinGecko', async () => {
      const getOrderBook = jest.fn().mockResolvedValue(book);
      const dexOracle = loadOracleWithDex(getOrderBook);
      mockHttpsGetError('CoinGecko rate limited');

      await dexOracle.getRates();
      await dexOracle.getRates();

      expect(getOrderBook).toHaveBeenCalledTimes(1);
      expect(dexOracle.getPriceSourceStatus().ttlMs).toBe(5 * 60 * 1000);
    });

    it('converts USD to XLM using the DEX price', async () => {
      const dexOracle = loadOracleWithDex(jest.fn().mockResolvedValue(book));
      mockHttpsGetError('CoinGecko rate limited');

      const xlm = await dexOracle.convertToXLM(1.1, 'USD');

      expect(xlm).toBeCloseTo(10, 5);
    });

    it('reports "none" as the source before any successful fetch', () => {
      const dexOracle = loadOracleWithDex(jest.fn());
      expect(dexOracle.getPriceSourceStatus()).toMatchObject({
        source: dexOracle.PRICE_SOURCES.NONE,
        cached: false,
        stale: false,
      });
    });

    it('names both failed sources when the DEX also fails', async () => {
      const dexOracle = loadOracleWithDex(jest.fn().mockRejectedValue(new Error('Horizon 503')));
      mockHttpsGetError('CoinGecko rate limited');

      await expect(dexOracle.getRates()).rejects.toThrow(/CoinGecko.*Stellar DEX/);
    });

    it('serves the stale cache when both sources fail after a successful fetch', async () => {
      const dexOracle = loadOracleWithDex(jest.fn().mockRejectedValue(new Error('Horizon 503')));

      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
      mockHttpsGet({ stellar: { usd: 0.12, eur: 0.11, gbp: 0.09 } });
      await dexOracle.getRates();

      nowSpy.mockReturnValue(1_000_000 + 6 * 60 * 1000);
      https.get.mockRestore();
      mockHttpsGetError('CoinGecko rate limited');

      const rates = await dexOracle.getRates();

      expect(rates.usd).toBe(0.12);
      expect(dexOracle.getPriceSourceStatus()).toMatchObject({
        source: dexOracle.PRICE_SOURCES.COINGECKO,
        stale: true,
      });
    });
  });

  // ── mid-market price derivation ────────────────────────────────────────────

  describe('midMarketPrice()', () => {
    it('averages the best bid and the best ask', () => {
      expect(oracle.midMarketPrice({
        bids: [{ price: '0.1000000' }, { price: '0.0900000' }],
        asks: [{ price: '0.1200000' }, { price: '0.1300000' }],
      })).toBeCloseTo(0.11, 7);
    });

    it('throws when the bid side is empty', () => {
      expect(() => oracle.midMarketPrice({ bids: [], asks: [{ price: '0.12' }] })).toThrow(/bid/);
    });

    it('throws when the ask side is empty', () => {
      expect(() => oracle.midMarketPrice({ bids: [{ price: '0.10' }], asks: [] })).toThrow(/ask/);
    });

    it('throws on a non-numeric price', () => {
      expect(() => oracle.midMarketPrice({ bids: [{ price: 'abc' }], asks: [{ price: '0.12' }] })).toThrow();
    });

    it('throws on a zero price', () => {
      expect(() => oracle.midMarketPrice({ bids: [{ price: '0' }], asks: [{ price: '0.12' }] })).toThrow();
    });
  });

  describe('convertToXLM()', () => {
    beforeEach(() => {
      mockHttpsGet({ stellar: { usd: 0.10, eur: 0.09, gbp: 0.08 } });
    });

    it('returns amount unchanged for XLM', async () => {
      const result = await oracle.convertToXLM(5, 'XLM');
      expect(result).toBe(5);
    });

    it('converts USD to XLM correctly (10 USD / 0.10 = 100 XLM)', async () => {
      const result = await oracle.convertToXLM(10, 'USD');
      expect(result).toBeCloseTo(100, 5);
    });

    it('converts EUR to XLM correctly', async () => {
      const result = await oracle.convertToXLM(9, 'EUR');
      expect(result).toBeCloseTo(100, 5);
    });

    it('converts GBP to XLM correctly', async () => {
      const result = await oracle.convertToXLM(8, 'GBP');
      expect(result).toBeCloseTo(100, 5);
    });

    it('is case-insensitive for currency code', async () => {
      const upper = await oracle.convertToXLM(10, 'USD');
      oracle.invalidateCache();
      jest.restoreAllMocks();
      mockHttpsGet({ stellar: { usd: 0.10, eur: 0.09, gbp: 0.08 } });
      const lower = await oracle.convertToXLM(10, 'usd');
      expect(upper).toBeCloseTo(lower, 5);
    });

    it('throws for unsupported currency', async () => {
      await expect(oracle.convertToXLM(10, 'JPY')).rejects.toThrow('Unsupported currency');
    });
  });

  describe('SUPPORTED_CURRENCIES', () => {
    it('includes usd, eur, gbp', () => {
      expect(oracle.SUPPORTED_CURRENCIES).toEqual(
        expect.arrayContaining(['usd', 'eur', 'gbp'])
      );
    });
  });
});
