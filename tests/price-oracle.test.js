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

describe('PriceOracleService', () => {
  let oracle;

  beforeEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
    oracle = require('../src/services/PriceOracleService');
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

    it('throws when network fails and no cache exists', async () => {
      mockHttpsGetError('Connection refused');
      await expect(oracle.getRates()).rejects.toThrow();
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
