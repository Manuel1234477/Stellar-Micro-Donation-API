/**
 * @fileoverview Tests for Stellar inflation destination management endpoints
 */
const request = require('supertest');
const app = require('../src/routes/app');
const Database = require('../src/utils/database');
const { PERMISSIONS } = require('../src/utils/permissions');
const MockStellarService = require('../src/services/MockStellarService');

describe('Inflation Destination API', () => {
  let user, apiKey, wallet, sourceSecret, destinationPublicKey;

  beforeAll(async () => {
    // Setup test user, wallet, and API key
    user = await Database.run('INSERT INTO users (publicKey, ownerName) VALUES (?, ?)', ['GTESTUSERPUBLICKEY', 'Test User']);
    wallet = { id: user.lastID, publicKey: 'GTESTUSERPUBLICKEY', ownerId: user.lastID };
    apiKey = 'test-api-key';
    sourceSecret = 'SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
    destinationPublicKey = 'GDESTINATIONPUBLICKEYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
    // Mock permission assignment
    // ...
  });

  afterAll(async () => {
    // Cleanup test data
    await Database.run('DELETE FROM users WHERE id = ?', [wallet.id]);
  });

  test('Setting a valid inflation destination succeeds', async () => {
    const res = await request(app)
      .put(`/wallets/${wallet.id}/inflation-destination`)
      .set('x-api-key', apiKey)
      .send({ destinationPublicKey, sourceSecret });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.inflationDestination).toBe(destinationPublicKey);
  });

  test('Getting inflation destination returns current value', async () => {
    const res = await request(app)
      .get(`/wallets/${wallet.id}/inflation-destination`)
      .set('x-api-key', apiKey);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('inflationDestination');
  });

  test('Invalid public key returns 400', async () => {
    const res = await request(app)
      .put(`/wallets/${wallet.id}/inflation-destination`)
      .set('x-api-key', apiKey)
      .send({ destinationPublicKey: 'INVALID', sourceSecret });
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('Unauthorized request returns 403', async () => {
    const res = await request(app)
      .put(`/wallets/${wallet.id}/inflation-destination`)
      .send({ destinationPublicKey, sourceSecret });
    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
  });

  test('MockStellarService correctly tracks state changes', async () => {
    const mockSvc = new MockStellarService();
    await mockSvc.setInflationDestination(sourceSecret, destinationPublicKey);
    const dest = await mockSvc.getInflationDestination(wallet.publicKey);
    expect(dest).toBe(destinationPublicKey);
  });
});
