'use strict';

/**
 * Tests for POST /donations/verify security fix (#907)
 *
 * Covers:
 *  - donationId is now required
 *  - mismatched hash returns HTTP 422 with VERIFICATION_FAILED
 *  - correct hash succeeds
 *  - correct hash but wrong amount returns 422
 *  - non-existent donation returns 404
 *  - non-existent transaction hash returns 404
 */

const DonationService = require('../../src/services/DonationService');
const { ValidationError, NotFoundError, ERROR_CODES } = require('../../src/utils/errors');

// ── Unit tests for DonationService.verifyTransaction ─────────────────────────

describe('DonationService.verifyTransaction — cross-donation validation', () => {
  let service;
  let mockStellarService;
  let mockDonation;
  let mockOnChainTx;

  beforeEach(() => {
    mockDonation = {
      id: 'donation-1',
      stellarTxId: 'hash-abc123',
      amount: '10',
      donor: 'GABC',
      recipient: 'GXYZ',
      status: 'confirmed',
    };

    mockOnChainTx = {
      id: 'hash-abc123',
      source: 'GABC',
      destination: 'GXYZ',
      amount: '10',
      ledger: 100,
      status: 'confirmed',
    };

    mockStellarService = {
      verifyTransaction: jest.fn().mockResolvedValue({
        verified: true,
        transaction: mockOnChainTx,
      }),
    };

    service = new DonationService(mockStellarService);
    // Stub getDonationById
    service.getDonationById = jest.fn().mockReturnValue(mockDonation);
  });

  test('transactionHash is required', async () => {
    await expect(service.verifyTransaction(null, 'donation-1'))
      .rejects.toThrow('Transaction hash is required');
  });

  test('succeeds when hash, amount, sender, and recipient all match', async () => {
    const result = await service.verifyTransaction('hash-abc123', 'donation-1');
    expect(result.verified).toBe(true);
  });

  test('mismatched hash throws VERIFICATION_FAILED', async () => {
    await expect(service.verifyTransaction('hash-different', 'donation-1'))
      .rejects.toMatchObject({
        message: expect.stringContaining('does not match'),
        errorCode: 'VERIFICATION_FAILED',
      });
  });

  test('correct hash but wrong amount throws VERIFICATION_FAILED', async () => {
    mockOnChainTx.amount = '999'; // different from donation amount 10
    await expect(service.verifyTransaction('hash-abc123', 'donation-1'))
      .rejects.toMatchObject({
        message: expect.stringContaining('amount mismatch'),
        errorCode: 'VERIFICATION_FAILED',
      });
  });

  test('correct hash but wrong sender throws VERIFICATION_FAILED', async () => {
    mockOnChainTx.source = 'GWRONG';
    await expect(service.verifyTransaction('hash-abc123', 'donation-1'))
      .rejects.toMatchObject({
        message: expect.stringContaining('sender mismatch'),
        errorCode: 'VERIFICATION_FAILED',
      });
  });

  test('correct hash but wrong recipient throws VERIFICATION_FAILED', async () => {
    mockOnChainTx.destination = 'GWRONG';
    await expect(service.verifyTransaction('hash-abc123', 'donation-1'))
      .rejects.toMatchObject({
        message: expect.stringContaining('recipient mismatch'),
        errorCode: 'VERIFICATION_FAILED',
      });
  });

  test('non-existent donation (getDonationById throws) propagates error', async () => {
    service.getDonationById = jest.fn().mockImplementation(() => {
      throw new NotFoundError('Donation not found', ERROR_CODES.DONATION_NOT_FOUND);
    });
    await expect(service.verifyTransaction('hash-abc123', 'nonexistent'))
      .rejects.toThrow('Donation not found');
  });

  test('non-existent on-chain transaction propagates error', async () => {
    mockDonation.stellarTxId = 'hash-abc123'; // hash matches donation record
    mockStellarService.verifyTransaction = jest.fn().mockRejectedValue(
      new NotFoundError('Transaction not found on the network', 'TRANSACTION_NOT_FOUND')
    );
    await expect(service.verifyTransaction('hash-abc123', 'donation-1'))
      .rejects.toThrow('Transaction not found on the network');
  });

  test('verifyTransaction without donationId still calls stellar service (backward compat)', async () => {
    const result = await service.verifyTransaction('hash-abc123');
    expect(mockStellarService.verifyTransaction).toHaveBeenCalledWith('hash-abc123');
    expect(result.verified).toBe(true);
  });
});

// ── Route-level HTTP tests ────────────────────────────────────────────────────

describe('POST /donations/verify — HTTP endpoint validation', () => {
  let app;
  let request;
  let mockDonationService;

  beforeAll(() => {
    jest.resetModules();

    // Mock auth middlewares — includig requireAdmin used as requireAuth in wallet.js
    jest.mock('../../src/middleware/rbac', () => ({
      checkPermission: () => (req, res, next) => {
        req.user = { role: 'admin' };
        req.apiKey = { id: 1, role: 'admin' };
        next();
      },
      requireAdmin: (req, res, next) => next(),
    }));
    jest.mock('../../src/middleware/apiKey', () => (req, res, next) => {
      req.apiKey = { id: 1, role: 'admin' };
      next();
    });
    jest.mock('../../src/middleware/rateLimiter', () => ({
      donationRateLimiter: (req, res, next) => next(),
      verificationRateLimiter: (req, res, next) => next(),
      batchRateLimiter: (req, res, next) => next(),
    }));

    app = require('../../src/routes/app');
    request = require('supertest');
  });

  test('missing transactionHash returns 400', async () => {
    const res = await request(app)
      .post('/donations/verify')
      .set('x-api-key', 'test-admin-key')
      .send({ donationId: 'donation-1' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_FIELD');
    expect(res.body.error.message).toMatch(/transactionHash/);
  });

  test('missing donationId returns 400', async () => {
    const res = await request(app)
      .post('/donations/verify')
      .set('x-api-key', 'test-admin-key')
      .send({ transactionHash: 'hash-abc123' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_FIELD');
    expect(res.body.error.message).toMatch(/donationId/);
  });
});
