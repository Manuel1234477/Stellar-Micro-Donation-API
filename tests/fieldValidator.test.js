/**
 * Field Validator Tests
 * 
 * Tests for the field validator utility module
 * Validates unknown field detection logic
 */

const {
  detectUnknownFields,
  hasOnlyAllowedFields,
  validatePayloadFields
} = require('../src/utils/fieldValidator');

describe('Field Validator', () => {
  describe('detectUnknownFields', () => {
    it('should return empty array when all fields are allowed', () => {
      const payload = { name: 'John', age: 30 };
      const allowedFields = ['name', 'age'];
      const result = detectUnknownFields(payload, allowedFields);
      expect(result).toEqual([]);
    });

    it('should detect single unknown field', () => {
      const payload = { name: 'John', age: 30, hacker: 'malicious' };
      const allowedFields = ['name', 'age'];
      const result = detectUnknownFields(payload, allowedFields);
      expect(result).toEqual(['hacker']);
    });

    it('should detect multiple unknown fields', () => {
      const payload = { name: 'John', age: 30, hacker: 'bad', evil: 'worse' };
      const allowedFields = ['name', 'age'];
      const result = detectUnknownFields(payload, allowedFields);
      expect(result).toContain('hacker');
      expect(result).toContain('evil');
      expect(result.length).toBe(2);
    });

    it('should handle empty payload', () => {
      const payload = {};
      const allowedFields = ['name', 'age'];
      const result = detectUnknownFields(payload, allowedFields);
      expect(result).toEqual([]);
    });

    it('should handle null payload', () => {
      const payload = null;
      const allowedFields = ['name', 'age'];
      const result = detectUnknownFields(payload, allowedFields);
      expect(result).toEqual([]);
    });

    it('should handle undefined payload', () => {
      const payload = undefined;
      const allowedFields = ['name', 'age'];
      const result = detectUnknownFields(payload, allowedFields);
      expect(result).toEqual([]);
    });

    it('should handle non-object payload', () => {
      const payload = 'not an object';
      const allowedFields = ['name', 'age'];
      const result = detectUnknownFields(payload, allowedFields);
      expect(result).toEqual([]);
    });

    it('should handle empty allowed fields array', () => {
      const payload = { name: 'John', age: 30 };
      const allowedFields = [];
      const result = detectUnknownFields(payload, allowedFields);
      expect(result).toContain('name');
      expect(result).toContain('age');
      expect(result.length).toBe(2);
    });

    it('should handle null allowed fields', () => {
      const payload = { name: 'John', age: 30 };
      const allowedFields = null;
      const result = detectUnknownFields(payload, allowedFields);
      expect(result).toEqual([]);
    });

    it('should handle non-array allowed fields', () => {
      const payload = { name: 'John', age: 30 };
      const allowedFields = 'not an array';
      const result = detectUnknownFields(payload, allowedFields);
      expect(result).toEqual([]);
    });

    it('should detect unknown fields regardless of position', () => {
      const payload = { hacker: 'first', name: 'John', evil: 'middle', age: 30, bad: 'last' };
      const allowedFields = ['name', 'age'];
      const result = detectUnknownFields(payload, allowedFields);
      expect(result).toContain('hacker');
      expect(result).toContain('evil');
      expect(result).toContain('bad');
      expect(result.length).toBe(3);
    });

    it('should handle special field names', () => {
      const payload = { constructor: 'bad', name: 'John' };
      const allowedFields = ['name'];
      const result = detectUnknownFields(payload, allowedFields);
      expect(result).toContain('constructor');
      // Note: __proto__ is not enumerable and won't appear in Object.keys()
    });

    it('should be case-sensitive', () => {
      const payload = { Name: 'John', AGE: 30 };
      const allowedFields = ['name', 'age'];
      const result = detectUnknownFields(payload, allowedFields);
      expect(result).toContain('Name');
      expect(result).toContain('AGE');
      expect(result.length).toBe(2);
    });
  });

  describe('hasOnlyAllowedFields', () => {
    it('should return true when all fields are allowed', () => {
      const payload = { name: 'John', age: 30 };
      const allowedFields = ['name', 'age'];
      const result = hasOnlyAllowedFields(payload, allowedFields);
      expect(result).toBe(true);
    });

    it('should return false when unknown fields exist', () => {
      const payload = { name: 'John', age: 30, hacker: 'malicious' };
      const allowedFields = ['name', 'age'];
      const result = hasOnlyAllowedFields(payload, allowedFields);
      expect(result).toBe(false);
    });

    it('should return true for empty payload', () => {
      const payload = {};
      const allowedFields = ['name', 'age'];
      const result = hasOnlyAllowedFields(payload, allowedFields);
      expect(result).toBe(true);
    });

    it('should return true for subset of allowed fields', () => {
      const payload = { name: 'John' };
      const allowedFields = ['name', 'age', 'email'];
      const result = hasOnlyAllowedFields(payload, allowedFields);
      expect(result).toBe(true);
    });
  });

  describe('validatePayloadFields', () => {
    it('should return valid:true when all fields are allowed', () => {
      const payload = { name: 'John', age: 30 };
      const allowedFields = ['name', 'age'];
      const result = validatePayloadFields(payload, allowedFields);
      expect(result.valid).toBe(true);
      expect(result.unknownFields).toEqual([]);
    });

    it('should return valid:false when unknown fields exist', () => {
      const payload = { name: 'John', age: 30, hacker: 'malicious' };
      const allowedFields = ['name', 'age'];
      const result = validatePayloadFields(payload, allowedFields);
      expect(result.valid).toBe(false);
      expect(result.unknownFields).toContain('hacker');
    });

    it('should include all unknown fields in result', () => {
      const payload = { name: 'John', hacker: 'bad', evil: 'worse' };
      const allowedFields = ['name'];
      const result = validatePayloadFields(payload, allowedFields);
      expect(result.valid).toBe(false);
      expect(result.unknownFields).toContain('hacker');
      expect(result.unknownFields).toContain('evil');
      expect(result.unknownFields.length).toBe(2);
    });

    it('should handle empty payload', () => {
      const payload = {};
      const allowedFields = ['name', 'age'];
      const result = validatePayloadFields(payload, allowedFields);
      expect(result.valid).toBe(true);
      expect(result.unknownFields).toEqual([]);
    });
  });

  describe('Real-world scenarios', () => {
    it('should validate donation payload correctly', () => {
      const validPayload = { senderId: '123', receiverId: '456', amount: 100, memo: 'test' };
      const allowedFields = ['senderId', 'receiverId', 'amount', 'memo'];
      const result = detectUnknownFields(validPayload, allowedFields);
      expect(result).toEqual([]);
    });

    it('should detect typo in donation payload', () => {
      const invalidPayload = { senderId: '123', receiverId: '456', ammount: 100 }; // typo: ammount
      const allowedFields = ['senderId', 'receiverId', 'amount', 'memo'];
      const result = detectUnknownFields(invalidPayload, allowedFields);
      expect(result).toContain('ammount');
    });

    it('should detect malicious field in wallet payload', () => {
      const maliciousPayload = { address: 'GXXX', label: 'My Wallet', constructor: 'hack' };
      const allowedFields = ['address', 'label', 'ownerName'];
      const result = detectUnknownFields(maliciousPayload, allowedFields);
      expect(result).toContain('constructor');
      // Note: __proto__ is not enumerable and won't be detected by Object.keys()
    });

    it('should validate API key payload correctly', () => {
      const validPayload = { name: 'My Key', role: 'user', expiresInDays: 30, metadata: {} };
      const allowedFields = ['name', 'role', 'expiresInDays', 'metadata'];
      const result = detectUnknownFields(validPayload, allowedFields);
      expect(result).toEqual([]);
    });
  });
});
