/**
 * Transaction Cost Breakdown Tests
 *
 * Covers: calculateCostBreakdown utility, GET /donations/cost-breakdown endpoint,
 * platform fee configuration, USD equivalents, stroops precision, edge cases.
 */

'use strict';

jest.mock('../src/utils/log', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

// Mock heavy middleware / DB dependencies so route loads cleanly
jest.mock('../src/middleware/rbac', () => ({
  checkPermission: () => (req, res, next) => next(),
  requireAdmin: () => (req, res, next) => next(),
  attachUserRole: () => (req, res, next) => { req.user = { role: 'user' }; next(); },
}));
jest.mock('../src/middleware/apiKey', () => (req, res, next) => next());
jest.mock('../src/middleware/idempotency', () => ({
  requireIdempotency: (req, res, next) => next(),
  storeIdempotencyResponse: jest.fn().mockResolvedValue(),
}));
jest.mock('../src/middleware/rateLimiter', () => ({
  donationRateLimiter: (req, res, next) => next(),
  verificationRateLimiter: (req, res, next) => next(),
}));
jest.mock('../src/utils/database');
jest.mock('../src/config/stellar', () => ({
  getStellarService: () => ({
    sendDonation: jest.fn(),
    verifyTransaction: jest.fn(),
  }),
}));
jest.mock('../src/services/DonationService', () => {
  return jest.fn().mockImplementation(() => ({
    getAllDonations: jest.fn().mockReturnValue([]),
    getRecentDonations: jest.fn().mockReturnValue([]),
    getDonationById: jest.fn().mockReturnValue(null),
    getDonationLimits: jest.fn().mockReturnValue({}),
    updateDonationStatus: jest.fn(),
    verifyTransaction: jest.fn(),
    sendCustodialDonation: jest.fn(),
    createDonationRecord: jest.fn(),
  }));
});

const request = require('supertest');
const express = require('express');
const {
  calculateCostBreakdown,
  STELLAR_BASE_FEE_STROOPS,
  STELLAR_BASE_FEE_XLM,
  toStroopPrecision,
  xlmToUsd,
} = require('../src/utils/costBreakdown');

function makeApp() {
  const donationRoutes = require('../src/routes/donation');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { role: 'user' }; next(); });
  app.use('/donations', donationRoutes);
  app.use((err, req, res, _next) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. calculateCostBreakdown utility – success
// ═════════════════════════════════════════════════════════════════════════════

describe('calculateCostBreakdown – success', () => {

  test('returns all required fields', () => {
    const result = calculateCostBreakdown({ amount: 10 });
    expect(result).toHaveProperty('donationAmount');
    expect(result).toHaveProperty('networkFee');
    expect(result).toHaveProperty('platformFee');
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('xlmUsdRate');
    expect(result).toHaveProperty('precision');
  });

  test('donationAmount.xlm equals input amount at 7dp', () => {
    const result = calculateCostBreakdown({ amount: 5 });
    expect(result.donationAmount.xlm).toBe('5.0000000');
  });

  test('networkFee.xlm equals base fee (no surge)', () => {
    const result = calculateCostBreakdown({ amount: 10 });
    expect(result.networkFee.xlm).toBe('0.0000100');
  });

  test('networkFee.baseFeeStroops is 100', () => {
    const result = calculateCostBreakdown({ amount: 10 });
    expect(result.networkFee.baseFeeStroops).toBe(100);
  });

  test('platformFee.xlm is 0 by default', () => {
    const result = calculateCostBreakdown({ amount: 10 });
    expect(result.platformFee.xlm).toBe('0.0000000');
    expect(result.platformFee.percent).toBe(0);
  });

  test('total = donationAmount + networkFee + platformFee', () => {
    const result = calculateCostBreakdown({ amount: 100 });
    const expected = (100 + STELLAR_BASE_FEE_XLM).toFixed(7);
    expect(result.total.xlm).toBe(expected);
  });

  test('all XLM values have exactly 7 decimal places', () => {
    const result = calculateCostBreakdown({ amount: 1.23456789 });
    const sevenDp = /^\d+\.\d{7}$/;
    expect(result.donationAmount.xlm).toMatch(sevenDp);
    expect(result.networkFee.xlm).toMatch(sevenDp);
    expect(result.platformFee.xlm).toMatch(sevenDp);
    expect(result.total.xlm).toMatch(sevenDp);
  });

  test('USD values are null when xlmUsdRate is 0', () => {
    const result = calculateCostBreakdown({ amount: 10, xlmUsdRate: 0 });
    expect(result.donationAmount.usd).toBeNull();
    expect(result.networkFee.usd).toBeNull();
    expect(result.platformFee.usd).toBeNull();
    expect(result.total.usd).toBeNull();
    expect(result.rateTimestamp).toBeNull();
  });

  test('USD values are calculated when xlmUsdRate is provided', () => {
    const result = calculateCostBreakdown({ amount: 10, xlmUsdRate: 0.12 });
    expect(result.donationAmount.usd).toBe('1.20');
    expect(result.networkFee.usd).toBeDefined();
    expect(result.total.usd).toBeDefined();
    expect(result.rateTimestamp).not.toBeNull();
  });

  test('rateTimestamp is an ISO string when rate is provided', () => {
    const result = calculateCostBreakdown({ amount: 10, xlmUsdRate: 0.5 });
    expect(() => new Date(result.rateTimestamp)).not.toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. calculateCostBreakdown – surge fee
// ═════════════════════════════════════════════════════════════════════════════

describe('calculateCostBreakdown – surge fee', () => {

  test('surge multiplier of 2 doubles the network fee', () => {
    const result = calculateCostBreakdown({ amount: 10, surgeFeeMultiplier: 2 });
    expect(result.networkFee.xlm).toBe((STELLAR_BASE_FEE_XLM * 2).toFixed(7));
    expect(result.networkFee.surgeFeeMultiplier).toBe(2);
  });

  test('surge multiplier of 10 multiplies fee by 10', () => {
    const result = calculateCostBreakdown({ amount: 10, surgeFeeMultiplier: 10 });
    expect(result.networkFee.xlm).toBe((STELLAR_BASE_FEE_XLM * 10).toFixed(7));
  });

  test('surge multiplier of 1 equals base fee', () => {
    const result = calculateCostBreakdown({ amount: 10, surgeFeeMultiplier: 1 });
    expect(result.networkFee.xlm).toBe('0.0000100');
  });

  test('total includes surge fee', () => {
    const result = calculateCostBreakdown({ amount: 100, surgeFeeMultiplier: 5 });
    const expected = (100 + STELLAR_BASE_FEE_XLM * 5).toFixed(7);
    expect(result.total.xlm).toBe(expected);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. calculateCostBreakdown – platform fee
// ═════════════════════════════════════════════════════════════════════════════

describe('calculateCostBreakdown – platform fee', () => {

  test('1% platform fee on 100 XLM = 1 XLM', () => {
    const result = calculateCostBreakdown({ amount: 100, platformFeePercent: 1 });
    expect(result.platformFee.xlm).toBe('1.0000000');
    expect(result.platformFee.percent).toBe(1);
  });

  test('2.5% platform fee on 200 XLM = 5 XLM', () => {
    const result = calculateCostBreakdown({ amount: 200, platformFeePercent: 2.5 });
    expect(result.platformFee.xlm).toBe('5.0000000');
  });

  test('0% platform fee produces zero platformFee', () => {
    const result = calculateCostBreakdown({ amount: 50, platformFeePercent: 0 });
    expect(result.platformFee.xlm).toBe('0.0000000');
  });

  test('total includes platform fee', () => {
    const result = calculateCostBreakdown({ amount: 100, platformFeePercent: 2 });
    const expected = (100 + STELLAR_BASE_FEE_XLM + 2).toFixed(7);
    expect(result.total.xlm).toBe(expected);
  });

  test('platform fee USD is calculated correctly', () => {
    const result = calculateCostBreakdown({
      amount: 100, platformFeePercent: 1, xlmUsdRate: 0.10,
    });
    expect(result.platformFee.usd).toBe('0.10'); // 1 XLM * 0.10
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. calculateCostBreakdown – precision
// ═════════════════════════════════════════════════════════════════════════════

describe('calculateCostBreakdown – precision', () => {

  test('small amount 0.0000001 XLM (1 stroop) is handled', () => {
    const result = calculateCostBreakdown({ amount: 0.0000001 });
    expect(result.donationAmount.xlm).toBe('0.0000001');
  });

  test('large amount 9999999.9999999 XLM is handled', () => {
    const result = calculateCostBreakdown({ amount: 9999999.9999999 });
    expect(result.donationAmount.xlm).toMatch(/^\d+\.\d{7}$/);
  });

  test('precision field is set correctly', () => {
    const result = calculateCostBreakdown({ amount: 1 });
    expect(result.precision).toBe('7 decimal places (stroops)');
  });

  test('toStroopPrecision rounds correctly', () => {
    expect(toStroopPrecision(1.123456789)).toBe('1.1234568');
    expect(toStroopPrecision(0.0000001)).toBe('0.0000001');
    expect(toStroopPrecision(100)).toBe('100.0000000');
  });

  test('xlmToUsd rounds to 2 decimal places', () => {
    expect(xlmToUsd(10, 0.123456)).toBe('1.23');
    expect(xlmToUsd(1, 0.005)).toBe('0.01');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. calculateCostBreakdown – validation errors
// ═════════════════════════════════════════════════════════════════════════════

describe('calculateCostBreakdown – validation errors', () => {

  test('throws for zero amount', () => {
    expect(() => calculateCostBreakdown({ amount: 0 })).toThrow(/positive/i);
  });

  test('throws for negative amount', () => {
    expect(() => calculateCostBreakdown({ amount: -5 })).toThrow(/positive/i);
  });

  test('throws for NaN amount', () => {
    expect(() => calculateCostBreakdown({ amount: 'abc' })).toThrow(/positive/i);
  });

  test('throws for surgeFeeMultiplier < 1', () => {
    expect(() => calculateCostBreakdown({ amount: 10, surgeFeeMultiplier: 0.5 })).toThrow(/surgeFeeMultiplier/i);
  });

  test('throws for negative surgeFeeMultiplier', () => {
    expect(() => calculateCostBreakdown({ amount: 10, surgeFeeMultiplier: -1 })).toThrow(/surgeFeeMultiplier/i);
  });

  test('throws for platformFeePercent > 100', () => {
    expect(() => calculateCostBreakdown({ amount: 10, platformFeePercent: 101 })).toThrow(/platformFeePercent/i);
  });

  test('throws for negative platformFeePercent', () => {
    expect(() => calculateCostBreakdown({ amount: 10, platformFeePercent: -1 })).toThrow(/platformFeePercent/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. GET /donations/cost-breakdown – API route
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /donations/cost-breakdown', () => {
  let app;

  beforeAll(() => { app = makeApp(); });
  beforeEach(() => { delete process.env.PLATFORM_FEE_PERCENT; });
  afterEach(() => jest.clearAllMocks());

  test('200 with valid amount', async () => {
    const res = await request(app).get('/donations/cost-breakdown?amount=10');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.donationAmount.xlm).toBe('10.0000000');
  });

  test('400 when amount is missing', async () => {
    const res = await request(app).get('/donations/cost-breakdown');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/amount/i);
  });

  test('400 for invalid amount', async () => {
    const res = await request(app).get('/donations/cost-breakdown?amount=abc');
    expect(res.status).toBe(400);
  });

  test('400 for zero amount', async () => {
    const res = await request(app).get('/donations/cost-breakdown?amount=0');
    expect(res.status).toBe(400);
  });

  test('includes network fee in response', async () => {
    const res = await request(app).get('/donations/cost-breakdown?amount=50');
    expect(res.body.data.networkFee.xlm).toBe('0.0000100');
    expect(res.body.data.networkFee.baseFeeStroops).toBe(100);
  });

  test('platform fee defaults to 0 when env not set', async () => {
    const res = await request(app).get('/donations/cost-breakdown?amount=100');
    expect(res.body.data.platformFee.xlm).toBe('0.0000000');
    expect(res.body.data.platformFee.percent).toBe(0);
  });

  test('platform fee uses PLATFORM_FEE_PERCENT env variable', async () => {
    process.env.PLATFORM_FEE_PERCENT = '2';
    const res = await request(app).get('/donations/cost-breakdown?amount=100');
    expect(res.body.data.platformFee.xlm).toBe('2.0000000');
    expect(res.body.data.platformFee.percent).toBe(2);
    delete process.env.PLATFORM_FEE_PERCENT;
  });

  test('surge fee multiplier applied from query param', async () => {
    const res = await request(app).get('/donations/cost-breakdown?amount=10&surgeFeeMultiplier=3');
    expect(res.body.data.networkFee.surgeFeeMultiplier).toBe(3);
    expect(res.body.data.networkFee.xlm).toBe((STELLAR_BASE_FEE_XLM * 3).toFixed(7));
  });

  test('USD values included when xlmUsdRate provided', async () => {
    const res = await request(app).get('/donations/cost-breakdown?amount=10&xlmUsdRate=0.12');
    expect(res.body.data.donationAmount.usd).toBe('1.20');
    expect(res.body.data.rateTimestamp).not.toBeNull();
  });

  test('USD values null when xlmUsdRate not provided', async () => {
    const res = await request(app).get('/donations/cost-breakdown?amount=10');
    expect(res.body.data.donationAmount.usd).toBeNull();
    expect(res.body.data.rateTimestamp).toBeNull();
  });

  test('total equals sum of all components', async () => {
    const res = await request(app).get('/donations/cost-breakdown?amount=100');
    const d = res.body.data;
    const expected = (
      parseFloat(d.donationAmount.xlm) +
      parseFloat(d.networkFee.xlm) +
      parseFloat(d.platformFee.xlm)
    ).toFixed(7);
    expect(d.total.xlm).toBe(expected);
  });

  test('precision field is present', async () => {
    const res = await request(app).get('/donations/cost-breakdown?amount=1');
    expect(res.body.data.precision).toBe('7 decimal places (stroops)');
  });

  test('sender query param is accepted without error', async () => {
    const res = await request(app)
      .get('/donations/cost-breakdown?amount=10&sender=GSENDER123456789012345678901234567890123456789012');
    expect(res.status).toBe(200);
  });
});
