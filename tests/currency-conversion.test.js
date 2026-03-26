/**
 * Tests for PriceOracleService and currency conversion in DonationService.
 */

'use strict';

const https = require('https');
const { EventEmitter } = require('events');

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Build a minimal fake HTTPS response that emits `data` + `end`.
 */
function fakeResponse(body) {
  const emitter = new EventEmitter();
  emitter.statusCode = 200;
  process.nextTick(() => {
    emitter.emit('data', JSON.stringify(body));
    emitter.emit('end');
  });
  return emitter;
}

// ─── PriceOracleService ──────────────────────────────────────────────────────

describe('PriceOracleService', () => {
  let oracle;
  let httpsGetSpy;

  beforeEach(() => {
    // Re-require a fresh instance for each test
    jest.resetModules();
    oracle = require('../src/services/PriceOracleService');
    oracle._clearCache();
  });

  afterEach(() => {
    if (httpsGetSpy) httpsGetSpy.mockRestore();
  });

  const mockRates = { stellar: { usd: 0.12, eur: 0.11, gbp: 0.095 } };

  function mockHttpsGet(responseBody) {
    httpsGetSpy = jest.spyOn(https, 'get').mockImplementation((_url, cb) => {
      const res = fakeResponse(responseBody);
      cb(res);
      const req = new EventEmitter();
      req.end = () => {};
      return req;
    });
  }

  test('getRates fetches from CoinGecko and normalises keys to uppercase', async () => {
    mockHttpsGet(mockRates);
    const rates = await oracle.getRates();
    expect(rates).toEqual({ USD: 0.12, EUR: 0.11, GBP: 0.095 });
    expect(httpsGetSpy).toHaveBeenCalledTimes(1);
  });

  test('getRates returns cached result within TTL without re-fetching', async () => {
    mockHttpsGet(mockRates);
    await oracle.getRates();
    await oracle.getRates();
    expect(httpsGetSpy).toHaveBeenCalledTimes(1);
  });

  test('getRates re-fetches after cache expires', async () => {
    mockHttpsGet(mockRates);
    await oracle.getRates();

    // Manually expire the cache
    oracle._cache.fetchedAt = Date.now() - 6 * 60 * 1000;

    await oracle.getRates();
    expect(httpsGetSpy).toHaveBeenCalledTimes(2);
  });

  test('convertToXLM returns amount unchanged for XLM', async () => {
    const result = await oracle.convertToXLM(100, 'XLM');
    expect(result).toBe(100);
  });

  test('convertToXLM converts USD to XLM correctly', async () => {
    mockHttpsGet(mockRates);
    // 10 USD / 0.12 USD-per-XLM ≈ 83.3333333 XLM
    const result = await oracle.convertToXLM(10, 'USD');
    expect(result).toBeCloseTo(10 / 0.12, 5);
  });

  test('convertToXLM is case-insensitive for currency', async () => {
    mockHttpsGet(mockRates);
    const upper = await oracle.convertToXLM(10, 'USD');
    oracle._clearCache();
    mockHttpsGet(mockRates);
    const lower = await oracle.convertToXLM(10, 'usd');
    expect(upper).toBe(lower);
  });

  test('convertToXLM throws for unsupported currency', async () => {
    mockHttpsGet(mockRates);
    await expect(oracle.convertToXLM(10, 'JPY')).rejects.toThrow('Unsupported currency');
  });

  test('getCacheInfo returns null rates before first fetch', () => {
    const info = oracle.getCacheInfo();
    expect(info.rates).toBeNull();
    expect(info.fetchedAt).toBeNull();
    expect(info.ttlMs).toBe(5 * 60 * 1000);
  });

  test('getCacheInfo returns populated rates after fetch', async () => {
    mockHttpsGet(mockRates);
    await oracle.getRates();
    const info = oracle.getCacheInfo();
    expect(info.rates).toEqual({ USD: 0.12, EUR: 0.11, GBP: 0.095 });
    expect(info.fetchedAt).toBeGreaterThan(0);
  });

  test('concurrent getRates calls only trigger one HTTP request', async () => {
    mockHttpsGet(mockRates);
    const [r1, r2, r3] = await Promise.all([
      oracle.getRates(),
      oracle.getRates(),
      oracle.getRates(),
    ]);
    expect(httpsGetSpy).toHaveBeenCalledTimes(1);
    expect(r1).toEqual(r2);
    expect(r2).toEqual(r3);
  });

  test('getRates rejects when API returns unexpected format', async () => {
    mockHttpsGet({ unexpected: true });
    await expect(oracle.getRates()).rejects.toThrow('Unexpected CoinGecko response format');
  });
});

// ─── DonationService currency integration ───────────────────────────────────

describe('DonationService – currency conversion', () => {
  let DonationService;
  let donationService;
  let priceOracle;
  let Transaction;

  beforeEach(() => {
    jest.resetModules();

    // Stub PriceOracleService
    jest.mock('../src/services/PriceOracleService', () => ({
      convertToXLM: jest.fn(),
      getRates: jest.fn(),
      getCacheInfo: jest.fn(),
      _clearCache: jest.fn(),
    }));

    priceOracle = require('../src/services/PriceOracleService');
    DonationService = require('../src/services/DonationService');
    Transaction = require('../src/routes/models/transaction');
    Transaction._clearAllData();

    donationService = new DonationService({});
  });

  afterEach(() => {
    Transaction._clearAllData();
  });

  test('createDonationRecord defaults to XLM and skips conversion', async () => {
    priceOracle.convertToXLM.mockResolvedValue(50);

    const tx = await donationService.createDonationRecord({
      amount: 50,
      donor: 'DONOR_ADDR',
      recipient: 'RECIPIENT_ADDR',
    });

    expect(priceOracle.convertToXLM).not.toHaveBeenCalled();
    expect(tx.amount).toBe(50);
    expect(tx.originalCurrency).toBe('XLM');
    expect(tx.originalAmount).toBe(50);
  });

  test('createDonationRecord converts USD to XLM and stores original values', async () => {
    priceOracle.convertToXLM.mockResolvedValue(83.3333333);

    const tx = await donationService.createDonationRecord({
      amount: 10,
      currency: 'USD',
      donor: 'DONOR_ADDR',
      recipient: 'RECIPIENT_ADDR',
    });

    expect(priceOracle.convertToXLM).toHaveBeenCalledWith(10, 'USD');
    expect(tx.amount).toBeCloseTo(83.3333333);
    expect(tx.originalAmount).toBe(10);
    expect(tx.originalCurrency).toBe('USD');
  });

  test('createDonationRecord propagates oracle errors', async () => {
    priceOracle.convertToXLM.mockRejectedValue(new Error('Unsupported currency: JPY'));

    await expect(
      donationService.createDonationRecord({
        amount: 10,
        currency: 'JPY',
        donor: 'DONOR_ADDR',
        recipient: 'RECIPIENT_ADDR',
      })
    ).rejects.toThrow('Unsupported currency: JPY');
  });

  test('createDonationRecord normalises currency to uppercase', async () => {
    priceOracle.convertToXLM.mockResolvedValue(9.09);

    const tx = await donationService.createDonationRecord({
      amount: 1,
      currency: 'eur',
      donor: 'DONOR_ADDR',
      recipient: 'RECIPIENT_ADDR',
    });

    expect(priceOracle.convertToXLM).toHaveBeenCalledWith(1, 'EUR');
    expect(tx.originalCurrency).toBe('EUR');
  });
});
