const request = require('supertest');
const app = require('../src/routes/app'); // Path to your express app

describe('Stellar Micro-Donation API', () => {
  
  describe('POST /wallets', () => {
    it('should enforce wallet creation permissions', async () => {
      const address = 'G'.concat('A'.repeat(55));
      const res = await request(app)
        .post('/wallets')
        .send({ address, label: 'My Wallet' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /donations', () => {
    it('should validate API key on donation creation', async () => {
      const donationData = {
        recipient: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
        amount: '10.0'
      };

      const res = await request(app)
        .post('/donations')
        .send(donationData);

      expect([401, 400]).toContain(res.status);
    });
  });

  describe('GET /health', () => {
    it('should return service health payload', async () => {
      const res = await request(app)
        .get('/health');

      expect([200, 503]).toContain(res.status);
      expect(res.body).toHaveProperty('timestamp');
    });
  });
});
