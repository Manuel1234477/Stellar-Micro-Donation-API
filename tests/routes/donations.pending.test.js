/**
 * Tests for pending donations route.
 * Originally tracked as issue #795.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../../src/services/DonationService', () => ({
  getPendingDonations: jest.fn(),
}));

const DonationService = require('../../src/services/DonationService');

describe('Pending donations route (#795)', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());

    const donationsRouter = require('../../src/routes/donations');
    app.use('/api/donations', donationsRouter);
  });

  test('returns pending donations', async () => {
    const pending = [
      { id: 1, amount: 10, status: 'pending' },
      { id: 2, amount: 20, status: 'pending' },
    ];
    DonationService.getPendingDonations.mockResolvedValue(pending);

    const res = await request(app).get('/api/donations/pending');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(pending);
    expect(DonationService.getPendingDonations).toHaveBeenCalledTimes(1);
  });

  test('returns empty array when there are no pending donations', async () => {
    DonationService.getPendingDonations.mockResolvedValue([]);

    const res = await request(app).get('/api/donations/pending');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('returns 500 when the service throws', async () => {
    DonationService.getPendingDonations.mockRejectedValue(new Error('boom'));

    const res = await request(app).get('/api/donations/pending');

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
  });
});