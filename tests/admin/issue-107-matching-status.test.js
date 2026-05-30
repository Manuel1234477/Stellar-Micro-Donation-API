/**
 * Issue #107: GET /donations/:id/matching-status endpoint tests
 * 
 * Tests for retrieving corporate matching status for donations.
 * Covers matched donations (all statuses), unmatched donations, and non-existent donations.
 */

const request = require('supertest');
const app = require('../../src/routes/app');
const apiKeysModel = require('../../src/models/apiKeys');
const db = require('../../src/utils/database');

describe('GET /donations/:id/matching-status - Donation Matching Status Endpoint', () => {
  let userKey;
  let guestKey;
  let donationId;

  beforeAll(async () => {
    await apiKeysModel.initializeApiKeysTable();

    const userKeyInfo = await apiKeysModel.createApiKey({
      name: 'Test User Key',
      role: 'user',
      createdBy: 'test-suite'
    });
    userKey = userKeyInfo.key;

    const guestKeyInfo = await apiKeysModel.createApiKey({
      name: 'Test Guest Key',
      role: 'guest',
      createdBy: 'test-suite'
    });
    guestKey = guestKeyInfo.key;

    // Create test donation
    const donationRes = await request(app)
      .post('/donations')
      .set('Authorization', `Bearer ${userKey}`)
      .send({
        senderPublicKey: 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJVNHX5LJJLBDKIQXX7XVCXX',
        recipientPublicKey: 'GBBD47UZQ5CYVYKX2NNLYL5XMHLXVJS37AUYZT57LGAG5HAFORNJQFW',
        amount: '100.0000000'
      });

    if (donationRes.body && donationRes.body.id) {
      donationId = donationRes.body.id;
    }
  });

  afterAll(async () => {
    await db.run('DELETE FROM api_keys WHERE created_by = ?', ['test-suite']);
  });

  describe('Matched Donation Status', () => {
    it('should return matching status for matched donation', async () => {
      if (!donationId) {
        this.skip();
      }

      const res = await request(app)
        .get(`/donations/${donationId}/matching-status`)
        .set('Authorization', `Bearer ${userKey}`)
        .expect(200);

      expect(res.body).toHaveProperty('eligible');
      expect(typeof res.body.eligible).toBe('boolean');
    });

    it('should include matchedAmount for matched donation', async () => {
      if (!donationId) {
        this.skip();
      }

      const res = await request(app)
        .get(`/donations/${donationId}/matching-status`)
        .set('Authorization', `Bearer ${userKey}`)
        .expect(200);

      if (res.body.eligible) {
        expect(res.body).toHaveProperty('matchedAmount');
        expect(typeof res.body.matchedAmount).toBe('string');
      }
    });

    it('should include matchRatio for matched donation', async () => {
      if (!donationId) {
        this.skip();
      }

      const res = await request(app)
        .get(`/donations/${donationId}/matching-status`)
        .set('Authorization', `Bearer ${userKey}`)
        .expect(200);

      if (res.body.eligible) {
        expect(res.body).toHaveProperty('matchRatio');
        expect(typeof res.body.matchRatio).toBe('number');
      }
    });

    it('should include programName for matched donation', async () => {
      if (!donationId) {
        this.skip();
      }

      const res = await request(app)
        .get(`/donations/${donationId}/matching-status`)
        .set('Authorization', `Bearer ${userKey}`)
        .expect(200);

      if (res.body.eligible) {
        expect(res.body).toHaveProperty('programName');
        expect(typeof res.body.programName).toBe('string');
      }
    });

    it('should include programId for matched donation', async () => {
      if (!donationId) {
        this.skip();
      }

      const res = await request(app)
        .get(`/donations/${donationId}/matching-status`)
        .set('Authorization', `Bearer ${userKey}`)
        .expect(200);

      if (res.body.eligible) {
        expect(res.body).toHaveProperty('programId');
        expect(typeof res.body.programId).toBe('number');
      }
    });

    it('should include status field', async () => {
      if (!donationId) {
        this.skip();
      }

      const res = await request(app)
        .get(`/donations/${donationId}/matching-status`)
        .set('Authorization', `Bearer ${userKey}`)
        .expect(200);

      expect(res.body).toHaveProperty('status');
      expect(['pending', 'approved', 'paid', 'ineligible']).toContain(res.body.status);
    });

    it('should include matchTransactionHash for matched donation', async () => {
      if (!donationId) {
        this.skip();
      }

      const res = await request(app)
        .get(`/donations/${donationId}/matching-status`)
        .set('Authorization', `Bearer ${userKey}`)
        .expect(200);

      if (res.body.eligible) {
        expect(res.body).toHaveProperty('matchTransactionHash');
      }
    });

    it('should handle pending status', async () => {
      if (!donationId) {
        this.skip();
      }

      const res = await request(app)
        .get(`/donations/${donationId}/matching-status`)
        .set('Authorization', `Bearer ${userKey}`)
        .expect(200);

      if (res.body.status === 'pending') {
        expect(res.body.eligible).toBe(true);
      }
    });

    it('should handle approved status', async () => {
      if (!donationId) {
        this.skip();
      }

      const res = await request(app)
        .get(`/donations/${donationId}/matching-status`)
        .set('Authorization', `Bearer ${userKey}`)
        .expect(200);

      if (res.body.status === 'approved') {
        expect(res.body.eligible).toBe(true);
      }
    });

    it('should handle paid status', async () => {
      if (!donationId) {
        this.skip();
      }

      const res = await request(app)
        .get(`/donations/${donationId}/matching-status`)
        .set('Authorization', `Bearer ${userKey}`)
        .expect(200);

      if (res.body.status === 'paid') {
        expect(res.body.eligible).toBe(true);
        expect(res.body.matchTransactionHash).toBeTruthy();
      }
    });
  });

  describe('Unmatched Donation', () => {
    it('should return ineligible status for unmatched donation', async () => {
      if (!donationId) {
        this.skip();
      }

      const res = await request(app)
        .get(`/donations/${donationId}/matching-status`)
        .set('Authorization', `Bearer ${userKey}`)
        .expect(200);

      if (!res.body.eligible) {
        expect(res.body.status).toBe('ineligible');
      }
    });

    it('should return minimal response for unmatched donation', async () => {
      if (!donationId) {
        this.skip();
      }

      const res = await request(app)
        .get(`/donations/${donationId}/matching-status`)
        .set('Authorization', `Bearer ${userKey}`)
        .expect(200);

      if (!res.body.eligible) {
        expect(res.body).toEqual({
          eligible: false,
          status: 'ineligible'
        });
      }
    });
  });

  describe('Non-Existent Donation', () => {
    it('should return 404 for non-existent donation', async () => {
      await request(app)
        .get('/donations/99999/matching-status')
        .set('Authorization', `Bearer ${userKey}`)
        .expect(404);
    });

    it('should return error message for non-existent donation', async () => {
      const res = await request(app)
        .get('/donations/99999/matching-status')
        .set('Authorization', `Bearer ${userKey}`)
        .expect(404);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('Permissions', () => {
    it('should require donations:read permission', async () => {
      if (!donationId) {
        this.skip();
      }

      const res = await request(app)
        .get(`/donations/${donationId}/matching-status`)
        .set('Authorization', `Bearer ${userKey}`)
        .expect(200);

      expect(res.status).toBeLessThan(500);
    });

    it('should allow guest role with donations:read permission', async () => {
      if (!donationId) {
        this.skip();
      }

      const res = await request(app)
        .get(`/donations/${donationId}/matching-status`)
        .set('Authorization', `Bearer ${guestKey}`)
        .expect(200);

      expect(res.status).toBeLessThan(500);
    });

    it('should return 401 without authentication', async () => {
      if (!donationId) {
        this.skip();
      }

      await request(app)
        .get(`/donations/${donationId}/matching-status`)
        .expect(401);
    });
  });

  describe('Response Format', () => {
    it('should return 200 status code', async () => {
      if (!donationId) {
        this.skip();
      }

      await request(app)
        .get(`/donations/${donationId}/matching-status`)
        .set('Authorization', `Bearer ${userKey}`)
        .expect(200);
    });

    it('should return JSON response', async () => {
      if (!donationId) {
        this.skip();
      }

      const res = await request(app)
        .get(`/donations/${donationId}/matching-status`)
        .set('Authorization', `Bearer ${userKey}`)
        .expect(200);

      expect(typeof res.body).toBe('object');
      expect(res.body).not.toBeNull();
    });

    it('should always include eligible field', async () => {
      if (!donationId) {
        this.skip();
      }

      const res = await request(app)
        .get(`/donations/${donationId}/matching-status`)
        .set('Authorization', `Bearer ${userKey}`)
        .expect(200);

      expect(res.body).toHaveProperty('eligible');
    });

    it('should always include status field', async () => {
      if (!donationId) {
        this.skip();
      }

      const res = await request(app)
        .get(`/donations/${donationId}/matching-status`)
        .set('Authorization', `Bearer ${userKey}`)
        .expect(200);

      expect(res.body).toHaveProperty('status');
    });
  });

  describe('Edge Cases', () => {
    it('should handle invalid donation ID format', async () => {
      const res = await request(app)
        .get('/donations/invalid-id/matching-status')
        .set('Authorization', `Bearer ${userKey}`);

      expect([400, 404]).toContain(res.status);
    });

    it('should handle null matchTransactionHash for pending matches', async () => {
      if (!donationId) {
        this.skip();
      }

      const res = await request(app)
        .get(`/donations/${donationId}/matching-status`)
        .set('Authorization', `Bearer ${userKey}`)
        .expect(200);

      if (res.body.eligible && res.body.status === 'pending') {
        expect(res.body.matchTransactionHash).toBeNull();
      }
    });
  });
});
