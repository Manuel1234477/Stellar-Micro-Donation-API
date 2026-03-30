'use strict';

/**
 * Tests for DonationService currency conversion integration
 */

// Jest requires mock factory variables to be prefixed with "mock"
const mockConvertToXLM = jest.fn();

jest.mock('../src/services/PriceOracleService', () => ({
  convertToXLM: (...args) => mockConvertToXLM(...args),
  getRates: jest.fn(),
  SUPPORTED_CURRENCIES: ['usd', 'eur', 'gbp'],
  invalidateCache: jest.fn(),
}));

jest.mock('../src/routes/models/transaction', () => ({
  create: jest.fn((data) => ({ id: '1', ...data })),
  getAll: jest.fn(() => []),
  getById: jest.fn(),
  getDailyTotalByDonor: jest.fn(() => 0),
  updateStatus: jest.fn(),
}));

describe('DonationService – currency conversion', () => {
  let DonationService;

  beforeEach(() => {
    jest.clearAllMocks();
    DonationService = require('../../src/services/DonationService');
  });

  it('passes XLM amount directly without calling oracle', async () => {
    const svc = new DonationService({});

    await svc.createDonationRecord({
      amount: 5,
      currency: 'XLM',
      donor: 'DONOR1',
      recipient: 'RECIPIENT1',
      idempotencyKey: 'key1',
    });

    expect(mockConvertToXLM).not.toHaveBeenCalled();
  });

  it('converts USD amount to XLM before recording', async () => {
    mockConvertToXLM.mockResolvedValue(100);

    const svc = new DonationService({});
    const tx = await svc.createDonationRecord({
      amount: 10,
      currency: 'USD',
      donor: 'DONOR1',
      recipient: 'RECIPIENT1',
      idempotencyKey: 'key2',
    });

    expect(mockConvertToXLM).toHaveBeenCalledWith(10, 'USD');
    expect(tx.amount).toBe(100);
    expect(tx.originalAmount).toBe(10);
    expect(tx.originalCurrency).toBe('USD');
  });

  it('defaults to XLM when currency is omitted', async () => {
    const svc = new DonationService({});

    await svc.createDonationRecord({
      amount: 5,
      donor: 'DONOR1',
      recipient: 'RECIPIENT1',
      idempotencyKey: 'key3',
    });

    expect(mockConvertToXLM).not.toHaveBeenCalled();
  });

  it('throws ValidationError when oracle fails', async () => {
    mockConvertToXLM.mockRejectedValue(new Error('Unsupported currency: JPY'));

    const svc = new DonationService({});
    await expect(
      svc.createDonationRecord({
        amount: 10,
        currency: 'JPY',
        donor: 'DONOR1',
        recipient: 'RECIPIENT1',
        idempotencyKey: 'key4',
      })
    ).rejects.toThrow('Currency conversion failed');
  });

  it('does not store originalCurrency/originalAmount for XLM donations', async () => {
    const svc = new DonationService({});
    const tx = await svc.createDonationRecord({
      amount: 5,
      currency: 'XLM',
      donor: 'DONOR1',
      recipient: 'RECIPIENT1',
      idempotencyKey: 'key5',
    });

    expect(tx.originalCurrency).toBeUndefined();
    expect(tx.originalAmount).toBeUndefined();
  });
});
