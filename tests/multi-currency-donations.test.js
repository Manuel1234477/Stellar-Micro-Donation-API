'use strict';

/**
 * Multi-Currency Donations Tests
 *
 * Covers:
 * - PriceOracleService: BTC support, 60-second TTL, oracle failure fallback
 * - DonationService: currency conversion for USD, EUR, BTC; XLM passthrough
 * - StatsService.getCurrencyBreakdown: per-currency totals
 */

const https = require('https');
const { EventEmitter } = require('events');

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function mockHttpsGetError(msg) {
  const req = new EventEmitter();
  req.destroy = jest.fn();
  jest.spyOn(https, 'get').mockImplementation(() => {
    process.nextTick(() => req.emit('error', new Error(msg)));
    return req;
  });
}

// CoinGecko response shape used by the updated PriceOracleService
const MOCK_COINGECKO = {
  stellar: { usd: 0.10, eur: 0.09 },
  bitcoin: { usd: 50000 },
};

// ─── PriceOracleService ───────────────────────────────────────────────────────

describe('PriceOracleService – multi-currency', () => {
  let oracle;

  beforeAll(() => {
    // Load the real module (not mocked) using isolateModules
    jest.isolateModules(() => {
      oracle = jest.requireActual('../src/services/PriceOracleService');
    });
  });

  beforeEach(() => {
    jest.restoreAllMocks();
    oracle.invalidateCache();
  });

  afterEach(() => jest.restoreAllMocks());

  it('SUPPORTED_CURRENCIES includes usd, eur, btc', () => {
    expect(oracle.SUPPORTED_CURRENCIES).toEqual(expect.arrayContaining(['usd', 'eur', 'btc']));
  });

  it('converts USD → XLM (10 USD / 0.10 = 100 XLM)', async () => {
    mockHttpsGet(MOCK_COINGECKO);
    const { xlmAmount, rate } = await oracle.convertToXLM(10, 'USD');
    expect(xlmAmount).toBeCloseTo(100, 5);
    expect(rate).toBe(0.10);
  });

  it('converts EUR → XLM (9 EUR / 0.09 = 100 XLM)', async () => {
    mockHttpsGet(MOCK_COINGECKO);
    const { xlmAmount } = await oracle.convertToXLM(9, 'EUR');
    expect(xlmAmount).toBeCloseTo(100, 5);
  });

  it('converts BTC → XLM (1 BTC = 50000 USD / 0.10 = 500000 XLM)', async () => {
    mockHttpsGet(MOCK_COINGECKO);
    const { xlmAmount } = await oracle.convertToXLM(1, 'BTC');
    expect(xlmAmount).toBeCloseTo(500000, 0);
  });

  it('returns XLM unchanged with rate=1', async () => {
    const { xlmAmount, rate } = await oracle.convertToXLM(42, 'XLM');
    expect(xlmAmount).toBe(42);
    expect(rate).toBe(1);
  });

  it('is case-insensitive', async () => {
    mockHttpsGet(MOCK_COINGECKO);
    const { xlmAmount: a } = await oracle.convertToXLM(10, 'usd');
    oracle.invalidateCache();
    jest.restoreAllMocks();
    mockHttpsGet(MOCK_COINGECKO);
    const { xlmAmount: b } = await oracle.convertToXLM(10, 'USD');
    expect(a).toBeCloseTo(b, 5);
  });

  it('throws for unsupported currency', async () => {
    mockHttpsGet(MOCK_COINGECKO);
    await expect(oracle.convertToXLM(10, 'JPY')).rejects.toThrow('Unsupported currency');
  });

  describe('60-second TTL cache', () => {
    it('does not re-fetch within 60 s', async () => {
      mockHttpsGet(MOCK_COINGECKO);
      await oracle.getRates();
      await oracle.getRates();
      expect(https.get).toHaveBeenCalledTimes(1);
    });

    it('re-fetches after cache is invalidated', async () => {
      mockHttpsGet(MOCK_COINGECKO);
      await oracle.getRates();
      oracle.invalidateCache();
      jest.restoreAllMocks();
      mockHttpsGet({ stellar: { usd: 0.20, eur: 0.18 }, bitcoin: { usd: 60000 } });
      const rates = await oracle.getRates();
      expect(rates.usd).toBe(0.20);
    });
  });

  describe('oracle failure fallback', () => {
    it('throws when network fails and no cache exists', async () => {
      mockHttpsGetError('Connection refused');
      await expect(oracle.getRates()).rejects.toThrow('Connection refused');
    });

    it('serves cached rates when network fails within TTL', async () => {
      // Populate cache
      mockHttpsGet(MOCK_COINGECKO);
      await oracle.getRates();
      jest.restoreAllMocks();

      // Network fails but cache is still valid
      mockHttpsGetError('Network error');
      const rates = await oracle.getRates(); // should return cached value
      expect(rates.usd).toBe(0.10);
    });
  });
});

// ─── DonationService – currency integration ───────────────────────────────────

const mockConvertToXLM = jest.fn();

jest.mock('../src/services/PriceOracleService', () => ({
  convertToXLM: (...args) => mockConvertToXLM(...args),
  getRates: jest.fn(),
  SUPPORTED_CURRENCIES: ['usd', 'eur', 'btc'],
  invalidateCache: jest.fn(),
}));

jest.mock('../src/routes/models/transaction', () => ({
  create: jest.fn((data) => ({ id: 'tx-1', ...data })),
  getAll: jest.fn(() => []),
  getById: jest.fn(),
  getDailyTotalByDonor: jest.fn(() => 0),
  updateStatus: jest.fn(),
}));

describe('DonationService – multi-currency createDonationRecord', () => {
  let DonationService;

  beforeEach(() => {
    jest.clearAllMocks();
    DonationService = require('../src/services/DonationService');
  });

  it('XLM: does not call oracle, stores no originalCurrency', async () => {
    const svc = new DonationService({});
    const tx = await svc.createDonationRecord({
      amount: 5, currency: 'XLM',
      donor: 'DONOR', recipient: 'RECIP', idempotencyKey: 'k1',
    });
    expect(mockConvertToXLM).not.toHaveBeenCalled();
    expect(tx.originalCurrency).toBeUndefined();
    expect(tx.originalAmount).toBeUndefined();
  });

  it('USD: calls oracle, stores originalAmount/originalCurrency/conversionRate', async () => {
    mockConvertToXLM.mockResolvedValue({ xlmAmount: 100, rate: 0.10 });
    const svc = new DonationService({});
    const tx = await svc.createDonationRecord({
      amount: 10, currency: 'USD',
      donor: 'DONOR', recipient: 'RECIP', idempotencyKey: 'k2',
    });
    expect(mockConvertToXLM).toHaveBeenCalledWith(10, 'USD');
    expect(tx.amount).toBe(100);
    expect(tx.originalAmount).toBe(10);
    expect(tx.originalCurrency).toBe('USD');
    expect(tx.conversionRate).toBe(0.10);
  });

  it('EUR: converts correctly', async () => {
    mockConvertToXLM.mockResolvedValue({ xlmAmount: 111.1111111, rate: 0.09 });
    const svc = new DonationService({});
    const tx = await svc.createDonationRecord({
      amount: 10, currency: 'EUR',
      donor: 'DONOR', recipient: 'RECIP', idempotencyKey: 'k3',
    });
    expect(tx.originalCurrency).toBe('EUR');
    expect(tx.amount).toBeCloseTo(111.1111111, 4);
  });

  it('BTC: converts correctly', async () => {
    mockConvertToXLM.mockResolvedValue({ xlmAmount: 50, rate: 500000 });
    const svc = new DonationService({});
    const tx = await svc.createDonationRecord({
      amount: 0.0001, currency: 'BTC',
      donor: 'DONOR', recipient: 'RECIP', idempotencyKey: 'k4',
    });
    expect(tx.originalCurrency).toBe('BTC');
    expect(tx.amount).toBe(50);
  });

  it('defaults to XLM when currency is omitted', async () => {
    const svc = new DonationService({});
    await svc.createDonationRecord({
      amount: 5, donor: 'DONOR', recipient: 'RECIP', idempotencyKey: 'k5',
    });
    expect(mockConvertToXLM).not.toHaveBeenCalled();
  });

  it('throws ValidationError when oracle fails', async () => {
    mockConvertToXLM.mockRejectedValue(new Error('Unsupported currency: JPY'));
    const svc = new DonationService({});
    await expect(
      svc.createDonationRecord({
        amount: 10, currency: 'JPY',
        donor: 'DONOR', recipient: 'RECIP', idempotencyKey: 'k6',
      })
    ).rejects.toThrow('Currency conversion failed');
  });
});

// ─── StatsService.getCurrencyBreakdown ───────────────────────────────────────

describe('StatsService.getCurrencyBreakdown', () => {
  let StatsService;
  let Transaction;

  beforeEach(() => {
    Transaction = require('../src/routes/models/transaction');
    StatsService = require('../src/services/StatsService');
  });

  it('groups donations by originalCurrency', () => {
    jest.spyOn(Transaction, 'getAll').mockReturnValue([
      { amount: 100, originalAmount: 10, originalCurrency: 'USD' },
      { amount: 200, originalAmount: 20, originalCurrency: 'USD' },
      { amount: 111, originalAmount: 10, originalCurrency: 'EUR' },
      { amount: 50 }, // XLM (no originalCurrency)
    ]);

    const breakdown = StatsService.getCurrencyBreakdown();
    const usd = breakdown.find((b) => b.currency === 'USD');
    const eur = breakdown.find((b) => b.currency === 'EUR');
    const xlm = breakdown.find((b) => b.currency === 'XLM');

    expect(usd).toBeDefined();
    expect(usd.count).toBe(2);
    expect(usd.totalOriginalAmount).toBeCloseTo(30, 5);
    expect(usd.totalXlmAmount).toBeCloseTo(300, 5);

    expect(eur).toBeDefined();
    expect(eur.count).toBe(1);

    expect(xlm).toBeDefined();
    expect(xlm.count).toBe(1);
    expect(xlm.totalXlmAmount).toBeCloseTo(50, 5);
  });

  it('returns empty array when no transactions exist', () => {
    jest.spyOn(Transaction, 'getAll').mockReturnValue([]);
    expect(StatsService.getCurrencyBreakdown()).toEqual([]);
  });
});
