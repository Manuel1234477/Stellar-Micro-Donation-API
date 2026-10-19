/**
 * Tests for public tier routes.
 *
 * Originally tracked as issue #793 (public tiers endpoint).
 */

const request = require('supertest');
const express = require('express');

jest.mock('../../src/services/TierService', () => ({
  getPublicTiers: jest.fn(),
}));

const TierService = require('../../src/services/TierService');
const tiersRouter = require('../../src/routes/tiers');

describe('Public tiers routes (#793)', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/tiers', tiersRouter);
  });

  describe('GET /api/tiers/public', () => {
    it('returns the list of public tiers', async () => {
      const tiers = [
        { id: 1, name: 'Basic', price: 10 },
        { id: 2, name: 'Pro', price: 25 },
      ];
      TierService.getPublicTiers.mockResolvedValue(tiers);

      const res = await request(app).get('/api/tiers/public');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: tiers });
      expect(TierService.getPublicTiers).toHaveBeenCalledTimes(1);
    });

    it('returns an empty list when there are no public tiers', async () => {
      TierService.getPublicTiers.mockResolvedValue([]);

      const res = await request(app).get('/api/tiers/public');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: [] });
    });

    it('returns 500 when the service throws', async () => {
      TierService.getPublicTiers.mockRejectedValue(new Error('boom'));

      const res = await request(app).get('/api/tiers/public');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });
});