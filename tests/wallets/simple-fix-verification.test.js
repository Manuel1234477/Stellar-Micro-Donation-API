/**
 * Simple verification test for fix-wallet-transactions-404
 * Tests the actual fix without complex mocking
 */

const request = require('supertest');
const express = require('express');
const Database = require('../../src/utils/database');

describe('Simple Fix Verification - wallet transactions 404', () => {
  let app;
  let testPublicKey;
  let testWalletId;

  beforeAll(async () => {
    // Create a minimal Express app to test the route
    app = express();
    app.use(express.json());
    
    // Mock the middleware to focus on the core logic
    app.use((req, res, next) => {
      req.user = { id: 1, role: 'admin' };
      next();
    });
    
    // Import and mount the wallet routes
    const walletRoutes = require('../../src/routes/wallet');
    app.use('/api/v1/wallets', walletRoutes);
    
    testPublicKey = 'GTEST' + 'T'.repeat(51);
  });

  beforeEach(async () => {
    // Clean up test data
    await Database.run('DELETE FROM transactions WHERE memo LIKE ?', ['%simple-test%']);
    await Database.run('DELETE FROM users WHERE publicKey LIKE ?', ['%GTEST%']);
    
    // Create a test wallet
    const result = await Database.run(
      'INSERT INTO users (publicKey, createdAt) VALUES (?, ?)',
      [testPublicKey, new Date().toISOString()]
    );
    testWalletId = result.lastID;
    
    // Create a test transaction
    await Database.run(
      'INSERT INTO transactions (senderId, receiverId, amount, memo, timestamp, idempotencyKey) VALUES (?, ?, ?, ?, ?, ?)',
      [testWalletId, testWalletId, 100.0, 'simple-test-tx', new Date().toISOString(), `simple-test-${Date.now()}`]
    );
  });

  afterEach(async () => {
    // Clean up test data
    await Database.run('DELETE FROM transactions WHERE memo LIKE ?', ['%simple-test%']);
    await Database.run('DELETE FROM users WHERE publicKey LIKE ?', ['%GTEST%']);
  });

  test('Existing wallet with transactions returns 200 with transaction data', async () => {
    const response = await request(app)
      .get(`/api/v1/wallets/${testPublicKey}/transactions`)
      .set('X-API-Key', 'test-key');

    console.log('Response status:', response.status);
    console.log('Response body:', JSON.stringify(response.body, null, 2));

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data.length).toBeGreaterThan(0);
  });

  test('Non-existent wallet returns 404', async () => {
    const nonExistentKey = 'GNONE' + 'N'.repeat(51);
    
    const response = await request(app)
      .get(`/api/v1/wallets/${nonExistentKey}/transactions`)
      .set('X-API-Key', 'test-key');

    console.log('Non-existent wallet response status:', response.status);
    console.log('Non-existent wallet response body:', JSON.stringify(response.body, null, 2));

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Wallet not found');
  });

  test('Soft-deleted wallet returns 404', async () => {
    // Soft-delete the test wallet
    await Database.run(
      'UPDATE users SET deleted_at = ? WHERE id = ?',
      [new Date().toISOString(), testWalletId]
    );
    
    const response = await request(app)
      .get(`/api/v1/wallets/${testPublicKey}/transactions`)
      .set('X-API-Key', 'test-key');

    console.log('Soft-deleted wallet response status:', response.status);
    console.log('Soft-deleted wallet response body:', JSON.stringify(response.body, null, 2));

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Wallet not found');
  });
});