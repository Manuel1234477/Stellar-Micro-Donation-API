/**
 * Test Isolation Verification
 * Ensures tests are fully isolated and can run in any order
 */

const {
  resetAllState,
  clearDatabaseTables,
  clearModuleCache,
  resetMockStellarService,
  createIsolatedEnvironment,
  setupTestIsolation
} = require('../../helpers/testIsolation');
const Transaction = require('../../../src/routes/models/transaction');
const MockStellarService = require('../../../src/services/MockStellarService');
const Database = require('../../../src/utils/database');

describe('Test Isolation Verification', () => {
  describe('Transaction Model Isolation', () => {
    beforeEach(() => {
      Transaction._clearAllData();
    });

    afterEach(() => {
      Transaction._clearAllData();
    });

    it('should clear transaction data between tests', () => {
      // Create some transactions
      Transaction.create({
        amount: 100,
        donor: 'GTEST1',
        recipient: 'GTEST2',
        status: 'completed'
      });

      expect(Transaction.loadTransactions().length).toBe(1);

      // Clear data
      Transaction._clearAllData();

      expect(Transaction.loadTransactions().length).toBe(0);
    });

    it('should start with clean state', () => {
      // This test should see no transactions from previous test
      expect(Transaction.loadTransactions().length).toBe(0);
    });
  });

  describe('MockStellarService Isolation', () => {
    let service;

    beforeEach(() => {
      service = new MockStellarService();
    });

    afterEach(() => {
      resetMockStellarService(service);
    });

    it('should create wallet in first test', async () => {
      const wallet = await service.createWallet();
      await service.fundTestnetWallet(wallet.publicKey);

      const balance = await service.getBalance(wallet.publicKey);
      expect(balance.balance).toBe('10000.0000000');
    });

    it('should not see wallets from previous test', async () => {
      // Service should be clean - no wallets from previous test
      const state = service._getState();
      expect(state.wallets.length).toBe(0);
    });

    it('should clear failure simulation state', () => {
      service.enableFailureSimulation('timeout', 1.0);
      expect(service.failureSimulation.enabled).toBe(true);

      resetMockStellarService(service);
      expect(service.failureSimulation.enabled).toBe(false);
    });
  });

  describe('Environment Variable Isolation', () => {
    it('should isolate environment changes - test 1', () => {
      const cleanup = createIsolatedEnvironment({
        TEST_VAR: 'value1',
        DEBUG_MODE: 'true'
      });

      expect(process.env.TEST_VAR).toBe('value1');
      expect(process.env.DEBUG_MODE).toBe('true');

      cleanup();
    });

    it('should not see env vars from previous test', () => {
      // TEST_VAR should not exist after cleanup
      expect(process.env.TEST_VAR).toBeUndefined();
    });

    it('should restore original values', () => {
      const originalValue = process.env.NODE_ENV;
      
      const cleanup = createIsolatedEnvironment({
        NODE_ENV: 'test-override'
      });

      expect(process.env.NODE_ENV).toBe('test-override');

      cleanup();

      expect(process.env.NODE_ENV).toBe(originalValue);
    });
  });

  describe('Database Isolation', () => {
    beforeEach(async () => {
      // Ensure table exists
      await Database.run(`
        CREATE TABLE IF NOT EXISTS idempotency_keys (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          idempotencyKey VARCHAR(255) NOT NULL UNIQUE,
          requestHash VARCHAR(64) NOT NULL,
          response TEXT NOT NULL,
          userId INTEGER,
          createdAt DATETIME NOT NULL,
          expiresAt DATETIME NOT NULL
        )
      `);
    });

    afterEach(async () => {
      await clearDatabaseTables();
    });

    it('should clear database tables', async () => {
      // Insert test data
      await Database.run(
        `INSERT INTO idempotency_keys 
         (idempotencyKey, requestHash, response, createdAt, expiresAt) 
         VALUES (?, ?, ?, ?, ?)`,
        ['test-key', 'hash123', '{}', new Date().toISOString(), new Date().toISOString()]
      );

      const before = await Database.query('SELECT * FROM idempotency_keys');
      expect(before.length).toBeGreaterThan(0);

      await clearDatabaseTables();

      const after = await Database.query('SELECT * FROM idempotency_keys');
      expect(after.length).toBe(0);
    });
  });

  describe('Module Cache Isolation', () => {
    it('should clear module cache', () => {
      // Load a module
      const log1 = require('../../../src/utils/log');
      expect(log1).toBeDefined();

      // Clear cache
      clearModuleCache();

      // Module should be reloadable
      delete require.cache[require.resolve('../../../src/utils/log')];
      const log2 = require('../../../src/utils/log');
      expect(log2).toBeDefined();
    });
  });

  describe('Complete Isolation with setupTestIsolation', () => {
    const isolation = setupTestIsolation();

    beforeEach(async () => {
      await isolation.beforeEach({ TEST_MODE: 'true' });
    });

    afterEach(async () => {
      await isolation.afterEach();
    });

    it('should have clean state in test 1', () => {
      expect(Transaction.loadTransactions().length).toBe(0);
      expect(process.env.TEST_MODE).toBe('true');
    });

    it('should have clean state in test 2', () => {
      expect(Transaction.loadTransactions().length).toBe(0);
      expect(process.env.TEST_MODE).toBe('true');
    });
  });

  describe('Order Independence', () => {
    // These tests should pass regardless of execution order
    
    beforeEach(() => {
      Transaction._clearAllData();
    });

    afterEach(() => {
      Transaction._clearAllData();
    });

    it('test A - creates data', () => {
      Transaction.create({
        amount: 100,
        donor: 'GA',
        recipient: 'GB',
        status: 'completed'
      });
      expect(Transaction.loadTransactions().length).toBe(1);
    });

    it('test B - should not see data from A', () => {
      // Even if A runs first, B should start clean
      expect(Transaction.loadTransactions().length).toBe(0);
    });

    it('test C - creates different data', () => {
      Transaction.create({
        amount: 200,
        donor: 'GC',
        recipient: 'GD',
        status: 'pending'
      });
      expect(Transaction.loadTransactions().length).toBe(1);
    });

    it('test D - should not see data from C', () => {
      expect(Transaction.loadTransactions().length).toBe(0);
    });
  });
});
