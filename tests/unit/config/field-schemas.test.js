/**
 * Field Schema Registry Tests
 * 
 * Tests for the field schema registry configuration module
 * Validates that all required endpoints have schemas defined
 * and that schemas contain the correct field names.
 */

const {
  getFieldSchema,
  hasFieldSchema,
  getAllEndpointPatterns,
  fieldSchemas
} = require('../../../src/config/fieldSchemas');

describe('Field Schema Registry', () => {
  describe('getFieldSchema', () => {
    it('should return schema for POST /donations/send', () => {
      const schema = getFieldSchema('POST', '/donations/send');
      expect(schema).toEqual(['senderId', 'receiverId', 'amount', 'memo']);
    });

    it('should return schema for POST /donations', () => {
      const schema = getFieldSchema('POST', '/donations');
      expect(schema).toEqual(['amount', 'donor', 'recipient', 'memo']);
    });

    it('should return schema for POST /donations/verify', () => {
      const schema = getFieldSchema('POST', '/donations/verify');
      expect(schema).toEqual(['transactionHash']);
    });

    it('should return schema for PATCH /donations/:id/status', () => {
      const schema = getFieldSchema('PATCH', '/donations/123/status');
      expect(schema).toEqual(['status', 'stellarTxId', 'ledger']);
    });

    it('should return schema for POST /wallets', () => {
      const schema = getFieldSchema('POST', '/wallets');
      expect(schema).toEqual(['address', 'label', 'ownerName']);
    });

    it('should return schema for PATCH /wallets/:id', () => {
      const schema = getFieldSchema('PATCH', '/wallets/456');
      expect(schema).toEqual(['label', 'ownerName']);
    });

    it('should return schema for POST /transactions/sync', () => {
      const schema = getFieldSchema('POST', '/transactions/sync');
      expect(schema).toEqual(['publicKey']);
    });

    it('should return schema for POST /api-keys', () => {
      const schema = getFieldSchema('POST', '/api-keys');
      expect(schema).toEqual(['name', 'role', 'expiresInDays', 'metadata']);
    });

    it('should return schema for POST /api-keys/cleanup', () => {
      const schema = getFieldSchema('POST', '/api-keys/cleanup');
      expect(schema).toEqual(['retentionDays']);
    });

    it('should return null for endpoint without schema', () => {
      const schema = getFieldSchema('GET', '/unknown-endpoint');
      expect(schema).toBeNull();
    });

    it('should handle case-insensitive HTTP methods', () => {
      const schema1 = getFieldSchema('post', '/donations/send');
      const schema2 = getFieldSchema('POST', '/donations/send');
      expect(schema1).toEqual(schema2);
    });

    it('should return null for null method', () => {
      const schema = getFieldSchema(null, '/donations/send');
      expect(schema).toBeNull();
    });

    it('should return null for null path', () => {
      const schema = getFieldSchema('POST', null);
      expect(schema).toBeNull();
    });

    it('should match path parameters correctly', () => {
      const schema1 = getFieldSchema('PATCH', '/donations/123/status');
      const schema2 = getFieldSchema('PATCH', '/donations/abc-def/status');
      expect(schema1).toEqual(schema2);
      expect(schema1).toEqual(['status', 'stellarTxId', 'ledger']);
    });
  });

  describe('hasFieldSchema', () => {
    it('should return true for endpoints with schemas', () => {
      expect(hasFieldSchema('POST', '/donations/send')).toBe(true);
      expect(hasFieldSchema('POST', '/wallets')).toBe(true);
      expect(hasFieldSchema('PATCH', '/donations/123/status')).toBe(true);
    });

    it('should return false for endpoints without schemas', () => {
      expect(hasFieldSchema('GET', '/donations')).toBe(false);
      expect(hasFieldSchema('DELETE', '/wallets/123')).toBe(false);
      expect(hasFieldSchema('POST', '/unknown')).toBe(false);
    });
  });

  describe('getAllEndpointPatterns', () => {
    it('should return all registered endpoint patterns', () => {
      const patterns = getAllEndpointPatterns();
      expect(patterns).toContain('POST /donations/send');
      expect(patterns).toContain('POST /donations');
      expect(patterns).toContain('POST /donations/verify');
      expect(patterns).toContain('PATCH /donations/:id/status');
      expect(patterns).toContain('POST /wallets');
      expect(patterns).toContain('PATCH /wallets/:id');
      expect(patterns).toContain('POST /transactions/sync');
      expect(patterns).toContain('POST /api-keys');
      expect(patterns).toContain('POST /api-keys/cleanup');
    });

    it('should return an array', () => {
      const patterns = getAllEndpointPatterns();
      expect(Array.isArray(patterns)).toBe(true);
    });

    it('should have at least 9 endpoint patterns', () => {
      const patterns = getAllEndpointPatterns();
      expect(patterns.length).toBeGreaterThanOrEqual(9);
    });
  });

  describe('Field Schema Completeness', () => {
    it('should have schemas for all required donation endpoints', () => {
      expect(fieldSchemas['POST /donations/send']).toBeDefined();
      expect(fieldSchemas['POST /donations']).toBeDefined();
      expect(fieldSchemas['POST /donations/verify']).toBeDefined();
      expect(fieldSchemas['PATCH /donations/:id/status']).toBeDefined();
    });

    it('should have schemas for all required wallet endpoints', () => {
      expect(fieldSchemas['POST /wallets']).toBeDefined();
      expect(fieldSchemas['PATCH /wallets/:id']).toBeDefined();
    });

    it('should have schemas for all required transaction endpoints', () => {
      expect(fieldSchemas['POST /transactions/sync']).toBeDefined();
    });

    it('should have schemas for all required API key endpoints', () => {
      expect(fieldSchemas['POST /api-keys']).toBeDefined();
      expect(fieldSchemas['POST /api-keys/cleanup']).toBeDefined();
    });
  });

  describe('Field Schema Content Validation', () => {
    it('POST /donations/send should have correct fields', () => {
      const schema = fieldSchemas['POST /donations/send'];
      expect(schema).toContain('senderId');
      expect(schema).toContain('receiverId');
      expect(schema).toContain('amount');
      expect(schema).toContain('memo');
      expect(schema.length).toBe(4);
    });

    it('POST /donations should have correct fields', () => {
      const schema = fieldSchemas['POST /donations'];
      expect(schema).toContain('amount');
      expect(schema).toContain('donor');
      expect(schema).toContain('recipient');
      expect(schema).toContain('memo');
      expect(schema.length).toBe(4);
    });

    it('POST /donations/verify should have correct fields', () => {
      const schema = fieldSchemas['POST /donations/verify'];
      expect(schema).toContain('transactionHash');
      expect(schema.length).toBe(1);
    });

    it('PATCH /donations/:id/status should have correct fields', () => {
      const schema = fieldSchemas['PATCH /donations/:id/status'];
      expect(schema).toContain('status');
      expect(schema).toContain('stellarTxId');
      expect(schema).toContain('ledger');
      expect(schema.length).toBe(3);
    });

    it('POST /wallets should have correct fields', () => {
      const schema = fieldSchemas['POST /wallets'];
      expect(schema).toContain('address');
      expect(schema).toContain('label');
      expect(schema).toContain('ownerName');
      expect(schema.length).toBe(3);
    });

    it('PATCH /wallets/:id should have correct fields', () => {
      const schema = fieldSchemas['PATCH /wallets/:id'];
      expect(schema).toContain('label');
      expect(schema).toContain('ownerName');
      expect(schema.length).toBe(2);
    });

    it('POST /transactions/sync should have correct fields', () => {
      const schema = fieldSchemas['POST /transactions/sync'];
      expect(schema).toContain('publicKey');
      expect(schema.length).toBe(1);
    });

    it('POST /api-keys should have correct fields', () => {
      const schema = fieldSchemas['POST /api-keys'];
      expect(schema).toContain('name');
      expect(schema).toContain('role');
      expect(schema).toContain('expiresInDays');
      expect(schema).toContain('metadata');
      expect(schema.length).toBe(4);
    });

    it('POST /api-keys/cleanup should have correct fields', () => {
      const schema = fieldSchemas['POST /api-keys/cleanup'];
      expect(schema).toContain('retentionDays');
      expect(schema.length).toBe(1);
    });
  });
});
