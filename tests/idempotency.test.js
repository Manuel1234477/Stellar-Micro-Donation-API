/**
 * Idempotency Tests
 * Tests for idempotency service and middleware
 */

const IdempotencyService = require('../src/services/IdempotencyService');
const Database = require('../src/utils/database');

describe('Idempotency Service - Unit Tests', () => {
  beforeAll(async () => {
    // Create idempotency table for testing
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

  beforeEach(async () => {
    // Clean up before each test
    await Database.run('DELETE FROM idempotency_keys');
  });

  describe('Idempotency Key Validation', () => {
    it('should accept valid idempotency key format', () => {
      const validation = IdempotencyService.validateKey('valid-key-1234567890');
      expect(validation.valid).toBe(true);
    });

    it('should reject empty key', () => {
      const validation = IdempotencyService.validateKey('');
      expect(validation.valid).toBe(false);
      expect(validation.error).toContain('non-empty');
    });

    it('should reject short key', () => {
      const validation = IdempotencyService.validateKey('short');
      expect(validation.valid).toBe(false);
      expect(validation.error).toContain('16 characters');
    });

    it('should reject key with invalid characters', () => {
      const validation = IdempotencyService.validateKey('invalid@key#123456');
      expect(validation.valid).toBe(false);
      expect(validation.error).toContain('alphanumeric');
    });

    it('should reject key that is too long', () => {
      const longKey = 'a'.repeat(256);
      const validation = IdempotencyService.validateKey(longKey);
      expect(validation.valid).toBe(false);
      expect(validation.error).toContain('255 characters');
    });
  });

  describe('Request Hash Generation', () => {
    it('should generate consistent hash for same data', () => {
      const data = { amount: 100, recipient: 'GTEST123' };
      const hash1 = IdempotencyService.generateRequestHash(data);
      const hash2 = IdempotencyService.generateRequestHash(data);
      
      expect(hash1).toBe(hash2);
    });

    it('should generate different hash for different data', () => {
      const data1 = { amount: 100, recipient: 'GTEST123' };
      const data2 = { amount: 200, recipient: 'GTEST123' };
      
      const hash1 = IdempotencyService.generateRequestHash(data1);
      const hash2 = IdempotencyService.generateRequestHash(data2);
      
      expect(hash1).not.toBe(hash2);
    });

    it('should generate same hash regardless of property order', () => {
      const data1 = { amount: 100, recipient: 'GTEST123', memo: 'test' };
      const data2 = { recipient: 'GTEST123', memo: 'test', amount: 100 };
      
      const hash1 = IdempotencyService.generateRequestHash(data1);
      const hash2 = IdempotencyService.generateRequestHash(data2);
      
      expect(hash1).toBe(hash2);
    });
  });

  describe('Storage and Retrieval', () => {
    it('should store and retrieve idempotency record successfully', async () => {
      const key = 'test-key-1234567890';
      const hash = 'test-hash';
      const response = { success: true, data: { id: 1 } };
      
      await IdempotencyService.store(key, hash, response, 1);
      
      const retrieved = await IdempotencyService.get(key);
      
      expect(retrieved).not.toBeNull();
      expect(retrieved.response).toEqual(response);
      expect(retrieved.requestHash).toBe(hash);
      expect(retrieved.isIdempotent).toBe(true);
    });

    it('should return null for non-existent key', async () => {
      const retrieved = await IdempotencyService.get('non-existent-key');
      expect(retrieved).toBeNull();
    });

    it('should not return expired records', async () => {
      const key = 'expired-key-1234567890';
      const hash = 'test-hash';
      const response = { success: true };
      
      // Store with past expiry
      const pastExpiry = new Date(Date.now() - 1000).toISOString();
      await Database.run(
        `INSERT INTO idempotency_keys 
         (idempotencyKey, requestHash, response, userId, createdAt, expiresAt) 
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
        [key, hash, JSON.stringify(response), 1, pastExpiry]
      );
      
      const retrieved = await IdempotencyService.get(key);
      expect(retrieved).toBeNull();
    });
  });

  describe('Duplicate Detection', () => {
    it('should find duplicate by hash', async () => {
      const key1 = 'key1-1234567890abcdef';
      const key2 = 'key2-1234567890abcdef';
      const hash = 'same-hash';
      const response = { success: true };
      
      await IdempotencyService.store(key1, hash, response, 1);
      
      const duplicate = await IdempotencyService.findByHash(hash, key2);
      
      expect(duplicate).not.toBeNull();
      expect(duplicate.idempotencyKey).toBe(key1);
      expect(duplicate.isDuplicate).toBe(true);
    });

    it('should not find duplicate when excluding same key', async () => {
      const key = 'key-1234567890abcdef';
      const hash = 'test-hash';
      const response = { success: true };
      
      await IdempotencyService.store(key, hash, response, 1);
      
      const duplicate = await IdempotencyService.findByHash(hash, key);
      
      expect(duplicate).toBeNull();
    });
  });

  describe('Key Generation', () => {
    it('should generate unique keys', () => {
      const key1 = IdempotencyService.generateKey();
      const key2 = IdempotencyService.generateKey();
      
      expect(key1).not.toBe(key2);
      expect(key1).toMatch(/^idem_\d+_[a-f0-9]{32}$/);
    });

    it('should generate valid keys', () => {
      const key = IdempotencyService.generateKey();
      const validation = IdempotencyService.validateKey(key);
      
      expect(validation.valid).toBe(true);
    });
  });

  describe('Expired Records Cleanup', () => {
    it('should delete expired records and preserve active ones', async () => {
      // Add expired record
      const expiredKey = 'expired-1234567890';
      const pastExpiry = new Date(Date.now() - 1000).toISOString();
      await Database.run(
        `INSERT INTO idempotency_keys 
         (idempotencyKey, requestHash, response, userId, createdAt, expiresAt) 
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
        [expiredKey, 'hash1', '{}', 1, pastExpiry]
      );
      
      // Add active record
      const activeKey = 'active-1234567890';
      const futureExpiry = new Date(Date.now() + 86400000).toISOString();
      await Database.run(
        `INSERT INTO idempotency_keys 
         (idempotencyKey, requestHash, response, userId, createdAt, expiresAt) 
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
        [activeKey, 'hash2', '{}', 1, futureExpiry]
      );
      
      const deleted = await IdempotencyService.cleanupExpired();
      
      expect(deleted).toBe(1);
      
      // Verify expired is gone
      const expiredRecord = await IdempotencyService.get(expiredKey);
      expect(expiredRecord).toBeNull();
      
      // Verify active still exists
      const activeRecord = await IdempotencyService.get(activeKey);
      expect(activeRecord).not.toBeNull();
    });
  });

  describe('Statistics', () => {
    it('should return correct statistics', async () => {
      // Add some records
      await IdempotencyService.store('key1-1234567890', 'hash1', {}, 1);
      await IdempotencyService.store('key2-1234567890', 'hash2', {}, 1);
      
      // Add expired record
      const pastExpiry = new Date(Date.now() - 1000).toISOString();
      await Database.run(
        `INSERT INTO idempotency_keys 
         (idempotencyKey, requestHash, response, userId, createdAt, expiresAt) 
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
        ['expired-1234567890', 'hash3', '{}', 1, pastExpiry]
      );
      
      const stats = await IdempotencyService.getStats();
      
      expect(stats.total).toBe(3);
      expect(stats.active).toBe(2);
      expect(stats.expired).toBe(1);
    });
  });

  describe('Record Deletion', () => {
    it('should delete specific idempotency key successfully', async () => {
      const key = 'delete-test-1234567890';
      await IdempotencyService.store(key, 'hash', {}, 1);
      
      const deleted = await IdempotencyService.delete(key);
      expect(deleted).toBe(true);
      
      const retrieved = await IdempotencyService.get(key);
      expect(retrieved).toBeNull();
    });

    it('should return false for non-existent key', async () => {
      const deleted = await IdempotencyService.delete('non-existent');
      expect(deleted).toBe(false);
    });
  });
});
