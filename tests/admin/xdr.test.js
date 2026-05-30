const request = require('supertest');
const app = require('../../src/routes/app');
const { createApiKey } = require('../../src/models/apiKeys');
const Transaction = require('../../src/routes/models/transaction');
const StellarSdk = require('stellar-sdk');
const db = require('../../src/utils/database');

describe('XDR Inspection API', () => {
  let adminKey;
  let userKey;

  beforeAll(async () => {
    // Setup admin and user keys
    const adminResult = await createApiKey({ name: 'Admin Key', role: 'admin' });
    adminKey = adminResult.key;

    const userResult = await createApiKey({ name: 'User Key', role: 'user' });
    userKey = userResult.key;
  });

  afterAll(async () => {
    await db.close();
  });

  describe('POST /admin/inspect/xdr', () => {
    // Valid XDR for a simple payment transaction (testnet)
    const validXDR = 'AAAAAgAAAABnu6DlvW89y4qXgZ23bA1w8sX/uV6G9v9Y4L+0N1m4WAAAAZAABm8wAAAABAAAAAAAAAAAAAAABAAAAAAAAAAEAAAAA57ug5b1vPcuKl4Gdt2wNcPLF/7lehvb/WOC/tDdZuFgAAAAAAAAAAACYloAAAAAAAAAAAA==';

    it('should allow admin to inspect valid XDR', async () => {
      const response = await request(app)
        .post('/admin/inspect/xdr')
        .set('x-api-key', adminKey)
        .send({ xdr: validXDR });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('hash');
      expect(response.body.data.network).toBe('TESTNET');
    });

    it('should reject non-admin requests', async () => {
      const response = await request(app)
        .post('/admin/inspect/xdr')
        .set('x-api-key', userKey)
        .send({ xdr: validXDR });

      expect(response.status).toBe(403);
    });

    it('should return error for invalid XDR', async () => {
      const response = await request(app)
        .post('/admin/inspect/xdr')
        .set('x-api-key', adminKey)
        .send({ xdr: 'INVALID_XDR_DATA' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /admin/inspect/xdr/:id', () => {
    let testTx;

    beforeAll(() => {
      testTx = Transaction.create({
        amount: 10,
        donor: 'GD donor',
        recipient: 'GD recipient',
        status: 'completed',
        envelopeXdr: 'AAAAAgAAAABnu6DlvW89y4qXgZ23bA1w8sX/uV6G9v9Y4L+0N1m4WAAAAZAABm8wAAAABAAAAAAAAAAAAAAABAAAAAAAAAAEAAAAA57ug5b1vPcuKl4Gdt2wNcPLF/7lehvb/WOC/tDdZuFgAAAAAAAAAAACYloAAAAAAAAAAAA=='
      });
    });

    it('should allow admin to inspect stored transaction XDR', async () => {
      const response = await request(app)
        .get(`/admin/inspect/xdr/${testTx.id}`)
        .set('x-api-key', adminKey);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.decoded).toHaveProperty('hash');
      expect(response.body.data.raw).toBe(testTx.envelopeXdr);
    });

    it('should return 404 for non-existent transaction', async () => {
      const response = await request(app)
        .get('/admin/inspect/xdr/non-existent-id')
        .set('x-api-key', adminKey);

      expect(response.status).toBe(404);
    });
  });
});
