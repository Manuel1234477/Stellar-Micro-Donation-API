/**
 * Unknown Field Error Format Tests
 * 
 * Tests for the error response formatter for unknown fields
 * Validates that error responses match the expected format
 */

const { formatUnknownFieldError } = require('../../../src/utils/validationHelpers');

describe('Unknown Field Error Format', () => {
  describe('formatUnknownFieldError', () => {
    it('should return properly structured error response', () => {
      const unknownFields = ['hacker', 'malicious'];
      const result = formatUnknownFieldError(unknownFields);

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('error');
      expect(result.success).toBe(false);
      expect(result.error).toHaveProperty('code');
      expect(result.error).toHaveProperty('message');
      expect(result.error).toHaveProperty('unknownFields');
    });

    it('should include correct error code', () => {
      const unknownFields = ['hacker'];
      const result = formatUnknownFieldError(unknownFields);

      expect(result.error.code).toBe('UNKNOWN_FIELDS');
    });

    it('should include descriptive error message', () => {
      const unknownFields = ['hacker'];
      const result = formatUnknownFieldError(unknownFields);

      expect(result.error.message).toBe('Request contains unknown or unexpected fields');
      expect(typeof result.error.message).toBe('string');
      expect(result.error.message.length).toBeGreaterThan(0);
    });

    it('should include all unknown fields in response', () => {
      const unknownFields = ['hacker', 'malicious', 'evil'];
      const result = formatUnknownFieldError(unknownFields);

      expect(result.error.unknownFields).toEqual(unknownFields);
      expect(result.error.unknownFields.length).toBe(3);
    });

    it('should handle single unknown field', () => {
      const unknownFields = ['hacker'];
      const result = formatUnknownFieldError(unknownFields);

      expect(result.error.unknownFields).toEqual(['hacker']);
      expect(result.error.unknownFields.length).toBe(1);
    });

    it('should handle empty unknown fields array', () => {
      const unknownFields = [];
      const result = formatUnknownFieldError(unknownFields);

      expect(result.error.unknownFields).toEqual([]);
      expect(result.error.unknownFields.length).toBe(0);
    });

    it('should optionally include allowed fields', () => {
      const unknownFields = ['hacker'];
      const allowedFields = ['name', 'age', 'email'];
      const result = formatUnknownFieldError(unknownFields, allowedFields);

      expect(result.error).toHaveProperty('allowedFields');
      expect(result.error.allowedFields).toEqual(allowedFields);
    });

    it('should not include allowed fields when not provided', () => {
      const unknownFields = ['hacker'];
      const result = formatUnknownFieldError(unknownFields);

      expect(result.error.allowedFields).toBeUndefined();
    });

    it('should not include allowed fields when null', () => {
      const unknownFields = ['hacker'];
      const result = formatUnknownFieldError(unknownFields, null);

      expect(result.error.allowedFields).toBeUndefined();
    });

    it('should handle special characters in field names', () => {
      const unknownFields = ['__proto__', 'constructor', '$inject'];
      const result = formatUnknownFieldError(unknownFields);

      expect(result.error.unknownFields).toContain('__proto__');
      expect(result.error.unknownFields).toContain('constructor');
      expect(result.error.unknownFields).toContain('$inject');
    });

    it('should be JSON serializable', () => {
      const unknownFields = ['hacker', 'malicious'];
      const allowedFields = ['name', 'age'];
      const result = formatUnknownFieldError(unknownFields, allowedFields);

      expect(() => JSON.stringify(result)).not.toThrow();
      const json = JSON.stringify(result);
      const parsed = JSON.parse(json);

      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('UNKNOWN_FIELDS');
      expect(parsed.error.unknownFields).toEqual(unknownFields);
      expect(parsed.error.allowedFields).toEqual(allowedFields);
    });
  });

  describe('Error Response Consistency', () => {
    it('should match existing validation error format structure', () => {
      const unknownFields = ['hacker'];
      const result = formatUnknownFieldError(unknownFields);

      // Should have same top-level structure as other validation errors
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('error');
      expect(result.success).toBe(false);

      // Error object should have code and message
      expect(result.error).toHaveProperty('code');
      expect(result.error).toHaveProperty('message');
      expect(typeof result.error.code).toBe('string');
      expect(typeof result.error.message).toBe('string');
    });

    it('should use consistent naming conventions', () => {
      const unknownFields = ['hacker'];
      const result = formatUnknownFieldError(unknownFields);

      // Code should be UPPER_SNAKE_CASE
      expect(result.error.code).toMatch(/^[A-Z_]+$/);

      // Message should be a proper sentence
      expect(result.error.message).toMatch(/^[A-Z]/); // Starts with capital
      expect(result.error.message.length).toBeGreaterThan(10); // Meaningful length
    });
  });

  describe('Real-world error scenarios', () => {
    it('should format error for donation endpoint with typo', () => {
      const unknownFields = ['ammount']; // typo in 'amount'
      const allowedFields = ['senderId', 'receiverId', 'amount', 'memo'];
      const result = formatUnknownFieldError(unknownFields, allowedFields);

      expect(result.success).toBe(false);
      expect(result.error.unknownFields).toContain('ammount');
      expect(result.error.allowedFields).toContain('amount');
    });

    it('should format error for wallet endpoint with extra field', () => {
      const unknownFields = ['extraField', 'anotherExtra'];
      const allowedFields = ['address', 'label', 'ownerName'];
      const result = formatUnknownFieldError(unknownFields, allowedFields);

      expect(result.success).toBe(false);
      expect(result.error.unknownFields.length).toBe(2);
      expect(result.error.allowedFields.length).toBe(3);
    });

    it('should format error for API key endpoint with malicious field', () => {
      const unknownFields = ['__proto__'];
      const allowedFields = ['name', 'role', 'expiresInDays', 'metadata'];
      const result = formatUnknownFieldError(unknownFields, allowedFields);

      expect(result.success).toBe(false);
      expect(result.error.unknownFields).toContain('__proto__');
    });
  });
});
