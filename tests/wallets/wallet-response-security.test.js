const { toWalletResponse } = require('../../src/utils/responseSanitizer');

describe('Wallet Response Security', () => {
  describe('toWalletResponse schema enforcement', () => {
    it('should strip sensitive fields from wallet object', () => {
      const rawWallet = {
        id: '123',
        publicKey: 'G1234567890',
        address: 'G1234567890',
        label: 'My Wallet',
        ownerName: 'Alice',
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-01T00:00:00Z',
        encryptedSecret: 'super-secret-encrypted-data',
        privateKey: 'S1234567890',
        secretKey: 'S1234567890',
        accessToken: 'token-xyz',
        funded: true,
        sponsored: false
      };

      const sanitized = toWalletResponse(rawWallet);

      // Verify sensitive fields are removed
      expect(sanitized).not.toHaveProperty('encryptedSecret');
      expect(sanitized).not.toHaveProperty('privateKey');
      expect(sanitized).not.toHaveProperty('secretKey');
      expect(sanitized).not.toHaveProperty('accessToken');

      // Verify safe fields remain
      expect(sanitized).toHaveProperty('id', '123');
      expect(sanitized).toHaveProperty('publicKey', 'G1234567890');
      expect(sanitized).toHaveProperty('address', 'G1234567890');
      expect(sanitized).toHaveProperty('label', 'My Wallet');
      expect(sanitized).toHaveProperty('funded', true);

      // Verify only allowed keys are present
      const allowedKeys = ['id', 'publicKey', 'address', 'label', 'ownerName', 'createdAt', 'updatedAt', 'funded', 'sponsored'];
      Object.keys(sanitized).forEach(key => {
        expect(allowedKeys).toContain(key);
      });
    });

    it('should handle undefined or null wallet gracefully', () => {
      expect(toWalletResponse(null)).toBeNull();
      expect(toWalletResponse(undefined)).toBeUndefined();
    });
    
    it('should gracefully handle wallets with address but no publicKey', () => {
      const rawWallet = {
        id: '123',
        address: 'G1234567890',
        label: 'Wallet'
      };
      const sanitized = toWalletResponse(rawWallet);
      expect(sanitized).toHaveProperty('publicKey', 'G1234567890');
      expect(sanitized).toHaveProperty('address', 'G1234567890');
    });

    it('should gracefully handle wallets with publicKey but no address', () => {
      const rawWallet = {
        id: '123',
        publicKey: 'G1234567890',
        label: 'Wallet'
      };
      const sanitized = toWalletResponse(rawWallet);
      expect(sanitized).toHaveProperty('publicKey', 'G1234567890');
      expect(sanitized).toHaveProperty('address', 'G1234567890');
    });
  });
});

const request = require('supertest');
const express = require('express');
const Database = require('../../src/utils/database');

describe('API Response Sanitization Integration', () => {
  let app;
  let testPublicKey;
  let testWalletId;

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    
    // Mock middleware
    app.use((req, res, next) => {
      req.user = { id: 1, role: 'admin' };
      next();
    });
    
    // Mount routes
    const walletRoutes = require('../../src/routes/wallet');
    app.use('/api/v1/wallets', walletRoutes);
    
    testPublicKey = 'GSEC' + 'T'.repeat(51);
  });

  beforeEach(async () => {
    await Database.run('DELETE FROM users WHERE publicKey LIKE ?', ['%GSEC%']);
    
    // Insert a dummy wallet with sensitive data
    const result = await Database.run(
      'INSERT INTO users (publicKey, encryptedSecret, accessToken, createdAt) VALUES (?, ?, ?, ?)',
      [testPublicKey, 'super-secret-key-123', 'access-token-456', new Date().toISOString()]
    );
    testWalletId = result.lastID;
  });

  afterEach(async () => {
    await Database.run('DELETE FROM users WHERE publicKey LIKE ?', ['%GSEC%']);
  });

  test('GET /api/v1/wallets/:id should not expose sensitive fields', async () => {
    const response = await request(app).get(`/api/v1/wallets/${testWalletId}`);
    
    expect(response.status).toBe(200);
    expect(response.body.data).toBeDefined();
    
    // Test Sensitive Field Exclusion
    expect(response.body.data).not.toHaveProperty('encryptedSecret');
    expect(response.body.data).not.toHaveProperty('accessToken');
    expect(response.body.data).not.toHaveProperty('privateKey');
    
    // Test Schema Validation
    expect(response.body.data).toHaveProperty('id', testWalletId);
    expect(response.body.data).toHaveProperty('publicKey', testPublicKey);
  });

  test('GET /api/v1/wallets/admin/deleted should not expose sensitive fields', async () => {
    // Soft-delete the wallet
    await Database.run('UPDATE users SET deleted_at = ? WHERE id = ?', [new Date().toISOString(), testWalletId]);

    const response = await request(app).get('/api/v1/wallets/admin/deleted');
    
    expect(response.status).toBe(200);
    
    // Find our test wallet
    const wallet = response.body.data.wallets.find(w => w.id === testWalletId);
    expect(wallet).toBeDefined();
    
    // Regression Protection: Verify no sensitive fields leak through admin routes
    expect(wallet).not.toHaveProperty('encryptedSecret');
    expect(wallet).not.toHaveProperty('accessToken');
  });
});
