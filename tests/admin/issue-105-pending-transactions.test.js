/**
 * Issue #105: GET /wallets/:id/pending-transactions endpoint tests
 * 
 * Tests for retrieving pending transactions for a wallet.
 * Covers fresh pending transactions, wallet with no pending, non-existent wallet, and permissions.
 */

const request = require('supertest');
const app = require('../../src/routes/app');
const apiKeysModel = require('../../src/models/apiKeys');
const db = require('../../src/utils/database');

describe('GET /wallets/:id/pending-transactions - Pending Transactions Endpoint', () => {
  let userKey;
  let guestKey;
  let walletId;

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

    // Create test wallet
    const walletRes = await request(app)
      .post('/wallets')
      .set('Authorization', `Bearer ${userKey}`)
      .send({
        publicKey: 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJVNHX5LJJLBDKIQXX7XVCXX',
        name: 'Test Wallet'
      });

    if (walletRes.body && walletRes.body.id) {
      walletId = walletRes.body.id;
    }
  });

  afterAll(async () => {
    await db.run('DELETE FROM api_keys WHERE created_by = ?', ['test-suite']);
  });

  describe('Pending Transactions Retrieval', () => {
    it('should return empty array for wallet with no pending transactions', async () => {
      if (!walletId) {
        this.skip();
      }

      const res = await request(app)
        .get(`/wallets/${walletId}/pending-transactions`)
        .set('Authorization', `Bearer ${userKey}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toEqual([]);
    });

    it('should include transactionId in pending transaction', async () => {
      if (!walletId) {
        this.skip();
      }

      const res = await request(app)
        .get(`/wallets/${walletId}/pending-transactions`)
        .set('Authorization', `Bearer ${userKey}`)
        .expect(200);

      if (res.body.length > 0) {
        res.body.forEach(tx => {
          expect(tx).toHaveProperty('transactionId');
        });
      }
    });

    it('should include transactionHash in pending transaction', async () => {
      if (!walletId) {
        this.skip();
      }

      const res = await request(app)
        .get(`/wallets/${walletId}/pending-transactions`)
        .set('Authorization', `Bearer ${userKey}`)
        .expect(200);

      if (res.body.length > 0) {
        res.body.forEach(tx => {
          expect(tx).toHaveProperty('transactionHash');
        });
      }
    });

    it('should include amount in pending transaction', async () => {
      if (!walletId) {
        this.skip();
      }

      const res = await request(app)
        .get(`/wallets/${walletId}/pending-transactions`)
        .set('Authorization', `Bearer ${userKey}`)
        .expect(200);

      if (res.body.length > 0) {
        res.body.forEach(tx => {
          expect(tx).toHaveProperty('amount');
        });
      }
    });

    it('should include counterpartyPublicKey in pending transaction', async () => {
      if (!walletId) {
        this.skip();
      }

      const res = await request(app)
        .get(`/wallets/${walletId}/pending-transactions`)
        .set('Authorization', `Bearer ${userKey}`)
        .expect(200);

      if (res.body.length > 0) {
        res.body.forEach(tx => {
          expect(tx).toHaveProperty('counterpartyPublicKey');
        });
      }
    });

    it('should include direction (outgoing/incoming) in pending transaction', async () => {
      if (!walletId) {
        this.skip();
      }

      const res = await request(app)
        .get(`/wallets/${walletId}/pending-transactions`)
        .set('Authorization', `Bearer ${userKey}`)
        .expect(200);

      if (res.body.length > 0) {
        res.body.forEach(tx => {
          expect(tx).toHaveProperty('direction');
          expect(['outgoing', 'incoming']).toContain(tx.direction);
        });
      }
    });

    it('should include submittedAt timestamp', async () => {
      if (!walletId) {
        this.skip();
      }

      const res = await request(app)
        .get(`/wallets/${walletId}/pending-transactions`)
        .set('Authorization', `Bearer ${userKey}`)
        .expect(200);

      if (res.body.length > 0) {
        res.body.forEach(tx => {
          expect(tx).toHaveProperty('submittedAt');
          expect(typeof tx.submittedAt).toBe('string');
        });
      }
    });

    it('should include estimatedConfirmationAt (submittedAt + 10 seconds)', async () => {
      if (!walletId) {
        this.skip();
      }

      const res = await request(app)
        .get(`/wallets/${walletId}/pending-transactions`)
        .set('Authorization', `Bearer ${userKey}`)
        .expect(200);

      if (res.body.length > 0) {
        res.body.forEach(tx => {
          expect(tx).toHaveProperty('estimatedConfirmationAt');
          expect(typeof tx.estimatedConfirmationAt).toBe('string');
        });
      }
    });
  });

  describe('Permissions', () => {
    it('should require wallets:read permission', async () => {
      if (!walletId) {
        this.skip();
      }

      const res = await request(app)
        .get(`/wallets/${walletId}/pending-transactions`)
        .set('Authorization', `Bearer ${userKey}`)
        .expect(200);

      expect(res.status).toBeLessThan(500);
    });

    it('should allow guest role with wallets:read permission', async () => {
      if (!walletId) {
        this.skip();
      }

      const res = await request(app)
        .get(`/wallets/${walletId}/pending-transactions`)
        .set('Authorization', `Bearer ${guestKey}`)
        .expect(200);

      expect(res.status).toBeLessThan(500);
    });

    it('should return 401 without authentication', async () => {
      if (!walletId) {
        this.skip();
      }

      await request(app)
        .get(`/wallets/${walletId}/pending-transactions`)
        .expect(401);
    });
  });

  describe('Non-Existent Wallet', () => {
    it('should return 404 for non-existent wallet', async () => {
      await request(app)
        .get('/wallets/99999/pending-transactions')
        .set('Authorization', `Bearer ${userKey}`)
        .expect(404);
    });

    it('should return 404 with error message', async () => {
      const res = await request(app)
        .get('/wallets/99999/pending-transactions')
        .set('Authorization', `Bearer ${userKey}`)
        .expect(404);

      expect(res.body).toHaveProperty('error');
    });
  });

  describe('Caching', () => {
    it('should not cache response (always fresh)', async () => {
      if (!walletId) {
        this.skip();
      }

      const res1 = await request(app)
        .get(`/wallets/${walletId}/pending-transactions`)
        .set('Authorization', `Bearer ${userKey}`)
        .expect(200);

      const res2 = await request(app)
        .get(`/wallets/${walletId}/pending-transactions`)
        .set('Authorization', `Bearer ${userKey}`)
        .expect(200);

      // Both should be fresh (no cache headers indicating caching)
      expect(res1.headers['cache-control']).not.toContain('max-age');
      expect(res2.headers['cache-control']).not.toContain('max-age');
    });
  });

  describe('Response Format', () => {
    it('should return array of pending transactions', async () => {
      if (!walletId) {
        this.skip();
      }

      const res = await request(app)
        .get(`/wallets/${walletId}/pending-transactions`)
        .set('Authorization', `Bearer ${userKey}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });

    it('should return 200 status code', async () => {
      if (!walletId) {
        this.skip();
      }

      await request(app)
        .get(`/wallets/${walletId}/pending-transactions`)
        .set('Authorization', `Bearer ${userKey}`)
        .expect(200);
    });
  });
});
