/**
 * Tests for Structured Error Codes
 * Verifies error code structure, consistency, and backward compatibility
 */

const { 
  ERROR_CODES, 
  AppError, 
  ValidationError, 
  UnauthorizedError, 
  ForbiddenError, 
  NotFoundError, 
  BusinessLogicError, 
  InternalError, 
  DatabaseError, 
  DuplicateError 
} = require('../../../src/utils/errors');

describe('Structured Error Codes', () => {
  describe('ERROR_CODES structure', () => {
    test('should have all required error code properties', () => {
      Object.values(ERROR_CODES).forEach(errorCode => {
        expect(errorCode).toHaveProperty('code');
        expect(errorCode).toHaveProperty('numeric');
        expect(typeof errorCode.code).toBe('string');
        expect(typeof errorCode.numeric).toBe('number');
      });
    });

    test('should have unique numeric codes', () => {
      const numericCodes = Object.values(ERROR_CODES).map(c => c.numeric);
      const uniqueNumericCodes = [...new Set(numericCodes)];
      expect(numericCodes).toHaveLength(uniqueNumericCodes.length);
    });

    test('should have unique string codes', () => {
      const stringCodes = Object.values(ERROR_CODES).map(c => c.code);
      const uniqueStringCodes = [...new Set(stringCodes)];
      expect(stringCodes).toHaveLength(uniqueStringCodes.length);
    });

    test('should follow numeric range patterns', () => {
      // Validation errors (1000-1099)
      expect(ERROR_CODES.VALIDATION_ERROR.numeric).toBeGreaterThanOrEqual(1000);
      expect(ERROR_CODES.VALIDATION_ERROR.numeric).toBeLessThan(1100);
      
      // Auth errors (2000-2099)
      expect(ERROR_CODES.UNAUTHORIZED.numeric).toBeGreaterThanOrEqual(2000);
      expect(ERROR_CODES.UNAUTHORIZED.numeric).toBeLessThan(2100);
      
      // Not found errors (3000-3099)
      expect(ERROR_CODES.NOT_FOUND.numeric).toBeGreaterThanOrEqual(3000);
      expect(ERROR_CODES.NOT_FOUND.numeric).toBeLessThan(3100);
      
      // Conflict errors (4000-4099)
      expect(ERROR_CODES.DUPLICATE_TRANSACTION.numeric).toBeGreaterThanOrEqual(4000);
      expect(ERROR_CODES.DUPLICATE_TRANSACTION.numeric).toBeLessThan(4100);
      
      // Business logic errors (5000-5099)
      expect(ERROR_CODES.INSUFFICIENT_BALANCE.numeric).toBeGreaterThanOrEqual(5000);
      expect(ERROR_CODES.INSUFFICIENT_BALANCE.numeric).toBeLessThan(5100);
      
      // Rate limiting errors (6000-6099)
      expect(ERROR_CODES.RATE_LIMIT_EXCEEDED.numeric).toBeGreaterThanOrEqual(6000);
      expect(ERROR_CODES.RATE_LIMIT_EXCEEDED.numeric).toBeLessThan(6100);
      
      // Server errors (9000-9099)
      expect(ERROR_CODES.INTERNAL_ERROR.numeric).toBeGreaterThanOrEqual(9000);
      expect(ERROR_CODES.INTERNAL_ERROR.numeric).toBeLessThan(9100);
    });
  });

  describe('AppError class', () => {
    test('should handle structured error codes', () => {
      const error = new AppError(ERROR_CODES.VALIDATION_ERROR, 'Test message', 400);
      
      expect(error.errorCode).toBe(ERROR_CODES.VALIDATION_ERROR.code);
      expect(error.numericCode).toBe(ERROR_CODES.VALIDATION_ERROR.numeric);
      expect(error.message).toBe('Test message');
      expect(error.statusCode).toBe(400);
    });

    test('should handle legacy string error codes', () => {
      const error = new AppError('VALIDATION_ERROR', 'Test message', 400);
      
      expect(error.errorCode).toBe(ERROR_CODES.VALIDATION_ERROR.code);
      expect(error.numericCode).toBe(ERROR_CODES.VALIDATION_ERROR.numeric);
    });

    test('should handle unknown error codes gracefully', () => {
      const error = new AppError('UNKNOWN_ERROR', 'Test message', 500);
      
      expect(error.errorCode).toBe('UNKNOWN_ERROR');
      expect(error.numericCode).toBe(9000); // Default to internal error
    });

    test('should include numericCode in JSON output', () => {
      const error = new AppError(ERROR_CODES.DATABASE_ERROR, 'DB error', 500);
      const json = error.toJSON();
      
      expect(json.error).toHaveProperty('code');
      expect(json.error).toHaveProperty('numericCode');
      expect(json.error.numericCode).toBe(ERROR_CODES.DATABASE_ERROR.numeric);
    });
  });

  describe('Specific Error Classes', () => {
    test('ValidationError should use validation error codes', () => {
      const error = new ValidationError('Invalid input');
      
      expect(error.errorCode).toBe(ERROR_CODES.VALIDATION_ERROR.code);
      expect(error.numericCode).toBe(ERROR_CODES.VALIDATION_ERROR.numeric);
      expect(error.statusCode).toBe(400);
    });

    test('UnauthorizedError should use auth error codes', () => {
      const error = new UnauthorizedError('Not authenticated');
      
      expect(error.errorCode).toBe(ERROR_CODES.UNAUTHORIZED.code);
      expect(error.numericCode).toBe(ERROR_CODES.UNAUTHORIZED.numeric);
      expect(error.statusCode).toBe(401);
    });

    test('ForbiddenError should use access denied codes', () => {
      const error = new ForbiddenError('Access denied');
      
      expect(error.errorCode).toBe(ERROR_CODES.ACCESS_DENIED.code);
      expect(error.numericCode).toBe(ERROR_CODES.ACCESS_DENIED.numeric);
      expect(error.statusCode).toBe(403);
    });

    test('NotFoundError should use not found codes', () => {
      const error = new NotFoundError('Resource not found');
      
      expect(error.errorCode).toBe(ERROR_CODES.NOT_FOUND.code);
      expect(error.numericCode).toBe(ERROR_CODES.NOT_FOUND.numeric);
      expect(error.statusCode).toBe(404);
    });

    test('DatabaseError should use database error codes', () => {
      const originalError = new Error('Connection failed');
      const error = new DatabaseError('Database operation failed', originalError);
      
      expect(error.errorCode).toBe(ERROR_CODES.DATABASE_ERROR.code);
      expect(error.numericCode).toBe(ERROR_CODES.DATABASE_ERROR.numeric);
      expect(error.statusCode).toBe(500);
      expect(error.details).toHaveProperty('originalError');
    });

    test('DuplicateError should use duplicate error codes', () => {
      const error = new DuplicateError('Duplicate entry');
      
      expect(error.errorCode).toBe(ERROR_CODES.DUPLICATE_DONATION.code);
      expect(error.numericCode).toBe(ERROR_CODES.DUPLICATE_DONATION.numeric);
      expect(error.statusCode).toBe(409);
    });
  });

  describe('Backward Compatibility', () => {
    test('should support old string-based error codes', () => {
      // Test all existing string codes
      const legacyCodes = [
        'VALIDATION_ERROR',
        'UNAUTHORIZED', 
        'ACCESS_DENIED',
        'NOT_FOUND',
        'DUPLICATE_TRANSACTION',
        'INTERNAL_ERROR',
        'DATABASE_ERROR'
      ];

      legacyCodes.forEach(code => {
        const error = new AppError(code, 'Test message', 400);
        expect(error.errorCode).toBe(code);
        expect(error.numericCode).toBeDefined();
        expect(typeof error.numericCode).toBe('number');
      });
    });

    test('should maintain existing error class interfaces', () => {
      // Test that existing constructors still work
      expect(() => new ValidationError('Test')).not.toThrow();
      expect(() => new UnauthorizedError('Test')).not.toThrow();
      expect(() => new ForbiddenError('Test')).not.toThrow();
      expect(() => new NotFoundError('Test')).not.toThrow();
      expect(() => new InternalError('Test')).not.toThrow();
      expect(() => new DatabaseError('Test')).not.toThrow();
      expect(() => new DuplicateError('Test')).not.toThrow();
    });
  });

  describe('Error Response Format', () => {
    test('should include all required fields in JSON output', () => {
      const error = new AppError(
        ERROR_CODES.VALIDATION_ERROR, 
        'Test error', 
        400, 
        { field: 'amount' }
      );
      const json = error.toJSON();
      
      expect(json).toHaveProperty('success', false);
      expect(json).toHaveProperty('error');
      expect(json.error).toHaveProperty('code', ERROR_CODES.VALIDATION_ERROR.code);
      expect(json.error).toHaveProperty('numericCode', ERROR_CODES.VALIDATION_ERROR.numeric);
      expect(json.error).toHaveProperty('message', 'Test error');
      expect(json.error).toHaveProperty('details');
      expect(json.error).toHaveProperty('timestamp');
      expect(json.error.details).toHaveProperty('field', 'amount');
    });

    test('should not include details when not provided', () => {
      const error = new AppError(ERROR_CODES.INTERNAL_ERROR, 'Server error', 500);
      const json = error.toJSON();
      
      expect(json.error).not.toHaveProperty('details');
    });
  });

  describe('Error Code Categories', () => {
    test('should correctly categorize validation errors', () => {
      const validationErrors = [
        ERROR_CODES.VALIDATION_ERROR,
        ERROR_CODES.INVALID_REQUEST,
        ERROR_CODES.MISSING_REQUIRED_FIELD,
        ERROR_CODES.INVALID_AMOUNT
      ];

      validationErrors.forEach(errorCode => {
        expect(errorCode.numeric).toBeGreaterThanOrEqual(1000);
        expect(errorCode.numeric).toBeLessThan(1100);
      });
    });

    test('should correctly categorize authentication errors', () => {
      const authErrors = [
        ERROR_CODES.UNAUTHORIZED,
        ERROR_CODES.ACCESS_DENIED,
        ERROR_CODES.INVALID_API_KEY
      ];

      authErrors.forEach(errorCode => {
        expect(errorCode.numeric).toBeGreaterThanOrEqual(2000);
        expect(errorCode.numeric).toBeLessThan(2100);
      });
    });

    test('should correctly categorize server errors', () => {
      const serverErrors = [
        ERROR_CODES.INTERNAL_ERROR,
        ERROR_CODES.DATABASE_ERROR,
        ERROR_CODES.SERVICE_UNAVAILABLE,
        ERROR_CODES.STELLAR_NETWORK_ERROR
      ];

      serverErrors.forEach(errorCode => {
        expect(errorCode.numeric).toBeGreaterThanOrEqual(9000);
        expect(errorCode.numeric).toBeLessThan(9100);
      });
    });
  });
});
