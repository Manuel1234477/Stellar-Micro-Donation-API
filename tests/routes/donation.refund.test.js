'use strict';

/**
 * Tests for the donation refund endpoint.
 *
 * Extracted from the legacy bundled suite `tests/issues-796-797-798.test.js`
 * (issue #797) so the tests live next to the module they cover.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../../src/services/DonationService', () => ({
  refundDonation: jest.fn(),
  getDonationById: jest.fn(),
}));

const DonationService = require('../../src/services/DonationService');
const donationRoutes = require('../../src/routes/donation');

describe('Donation refund endpoint (issue #797)', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/donations', donationRoutes);
  });

  it('refunds a donation and returns the refund result', async () => {
    DonationService.refundDonation.mockResolvedValue({
      id: 'donation-1',
      status: 'refunded',
      refundedAmount: 100,
    });

    const res = await request(app)
      .post('/donations/donation-1/refund')
      .send({ reason: 'requested by donor' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: 'donation-1',
      status: 'refunded',
      refundedAmount: 100,
    });
    expect(DonationService.refundDonation).toHaveBeenCalledWith(
      'donation-1',
      expect.objectContaining({ reason: 'requested by donor' })
    );
  });

  it('returns 404 when the donation does not exist', async () => {
    const notFound = new Error('Donation not found');
    notFound.status = 404;
    notFound.code = 'DONATION_NOT_FOUND';
    DonationService.refundDonation.mockRejectedValue(notFound);

    const res = await request(app)
      .post('/donations/missing/refund')
      .send({ reason: 'requested by donor' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual(
      expect.objectContaining({ error: expect.any(String) })
    );
  });

  it('returns 400 when the donation has already been refunded', async () => {
    const alreadyRefunded = new Error('Donation already refunded');
    alreadyRefunded.status = 400;
    alreadyRefunded.code = 'ALREADY_REFUNDED';
    DonationService.refundDonation.mockRejectedValue(alreadyRefunded);

    const res = await request(app)
      .post('/donations/donation-1/refund')
      .send({ reason: 'duplicate request' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual(
      expect.objectContaining({ error: expect.any(String) })
    );
  });

  it('returns 400 when the refund reason is missing', async () => {
    const validationError = new Error('reason is required');
    validationError.status = 400;
    validationError.code = 'VALIDATION_ERROR';
    DonationService.refundDonation.mockRejectedValue(validationError);

    const res = await request(app)
      .post('/donations/donation-1/refund')
      .send({});

    expect(res.status).toBe(400);
    expect(DonationService.refundDonation).toHaveBeenCalled();
  });

  it('returns 500 when the refund fails unexpectedly', async () => {
    DonationService.refundDonation.mockRejectedValue(
      new Error('unexpected failure')
    );

    const res = await request(app)
      .post('/donations/donation-1/refund')
      .send({ reason: 'requested by donor' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual(
      expect.objectContaining({ error: expect.any(String) })
    );
  });
});