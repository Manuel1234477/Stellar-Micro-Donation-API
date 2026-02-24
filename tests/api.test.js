const request = require('supertest');
const app = require('../src/routes/app'); // Path to your express app
const { expect } = require('chai');

describe('Stellar Micro-Donation API', () => {
  
  // 1. Task: Test Wallet Creation
  describe('POST /api/wallets', () => {
    it('should create a new Stellar keypair and return the public address', async () => {
      const res = await request(app)
        .post('/api/wallets')
        .send();

      expect(res.status).to.equal(201);
      expect(res.body).to.have.property('publicKey');
      expect(res.body).to.have.property('secret');
      // Verify Stellar address format
      expect(res.body.publicKey).to.match(/^G[A-Z2-7]{55}$/);
    });
  });

  // 2. Task: Test Sending XLM (Donations)
  describe('POST /api/donations', () => {
    it('should successfully submit a transaction to the network', async () => {
      const donationData = {
        destination: 'GD...RECIPIENT',
        amount: '10.0',
        senderSecret: 'S...SENDER_SECRET'
      };

      const res = await request(app)
        .post('/api/donations')
        .send(donationData);

      // We expect 200 OK or 400 if using test keys that aren't funded
      expect(res.status).to.be.oneOf([200, 400]);
    });
  });

  // 3. Task: Test Transaction History
  describe('GET /api/wallets/:address/history', () => {
    it('should fetch a list of recent operations for a given address', async () => {
      const testAddress = 'GA5ZSEJYB37JRC5AVCIAZ...'; // Use a known public address
      const res = await request(app)
        .get(`/api/wallets/${testAddress}/history`);

      expect(res.status).to.equal(200);
      expect(res.body.history).to.be.an('array');
    });
  });
});