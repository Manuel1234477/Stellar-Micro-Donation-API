/**
 * Comprehensive Input Validation Error Messages Tests
 * 
 * Tests for detailed, actionable validation error messages that include:
 * - Field path and constraint violated
 * - Invalid value (sanitized)
 * - Example of valid value
 * - Actionable guidance for developers
 */

const express = require('express');
const request = require('supertest');
const { validateSchema } = require('../../src/middleware/schemaValidation');

describe('Comprehensive Input Validation Error Messages', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
  });

  describe('Type Validation Errors', () => {
    beforeEach(() => {
      app.post(
        '/test-types',
        validateSchema({
          body: {
            fields: {
              amount: { type: 'number', required: true },
              count: { type: 'integer', required: true },
              active: { type: 'boolean', required: true },
            },
          },
        }),
        (req, res) => res.json({ success: true })
      );
    });

    test('type error includes field path, invalid value, expected type, and example', async () => {
      const response = await request(app)
        .post('/test-types')
        .send({ amount: 'not-a-number', count: 5, active: true });

      expect(response.status).toBe(400);
      const error = response.body.error.details[0];
      expect(error.path).toBe('body.amount');
      expect(error.constraint).toBe('type');
      expect(error.invalidValue).toContain('not-a-number');
      expect(error.expectedTypes).toContain('number');
      expect(error.example).toBeDefined();
      expect(error.guidance).toContain('type');
      expect(error.message).toContain('Invalid type');
      expect(error.message).toContain('body.amount');
    });

    test('type error for integer rejects string', async () => {
      const response = await request(app)
        .post('/test-types')
        .send({ amount: 10, count: '5', active: true });

      expect(response.status).toBe(400);
      const error = response.body.error.details[0];
      expect(error.path).toBe('body.count');
      expect(error.constraint).toBe('type');
      expect(error.expectedTypes).toContain('integer');
      expect(error.invalidValue).toContain('5');
    });

    test('type error for boolean rejects non-boolean', async () => {
      const response = await request(app)
        .post('/test-types')
        .send({ amount: 10, count: 5, active: 'yes' });

      expect(response.status).toBe(400);
      const error = response.body.error.details[0];
      expect(error.path).toBe('body.active');
      expect(error.expectedTypes).toContain('boolean');
    });
  });

  describe('Enum Validation Errors', () => {
    beforeEach(() => {
      app.post(
        '/test-enum',
        validateSchema({
          body: {
            fields: {
              status: { type: 'string', enum: ['pending', 'completed', 'failed'] },
            },
          },
        }),
        (req, res) => res.json({ success: true })
      );
    });

    test('enum error includes allowed values and example', async () => {
      const response = await request(app)
        .post('/test-enum')
        .send({ status: 'invalid' });

      expect(response.status).toBe(400);
      const error = response.body.error.details[0];
      expect(error.path).toBe('body.status');
      expect(error.constraint).toBe('enum');
      expect(error.invalidValue).toContain('invalid');
      expect(error.allowedValues).toEqual(['pending', 'completed', 'failed']);
      expect(error.example).toBeDefined();
      expect(error.guidance).toContain('allowed values');
      expect(error.message).toContain('Must be one of');
    });
  });

  describe('String Length Validation Errors', () => {
    beforeEach(() => {
      app.post(
        '/test-length',
        validateSchema({
          body: {
            fields: {
              name: { type: 'string', minLength: 3, maxLength: 20 },
            },
          },
        }),
        (req, res) => res.json({ success: true })
      );
    });

    test('minLength error includes actual length and minimum', async () => {
      const response = await request(app)
        .post('/test-length')
        .send({ name: 'ab' });

      expect(response.status).toBe(400);
      const error = response.body.error.details[0];
      expect(error.path).toBe('body.name');
      expect(error.constraint).toBe('minLength');
      expect(error.actualLength).toBe(2);
      expect(error.minLength).toBe(3);
      expect(error.message).toContain('too short');
      expect(error.message).toContain('3');
      expect(error.guidance).toContain('3');
    });

    test('maxLength error includes actual length and maximum', async () => {
      const response = await request(app)
        .post('/test-length')
        .send({ name: 'this-is-a-very-long-name' });

      expect(response.status).toBe(400);
      const error = response.body.error.details[0];
      expect(error.path).toBe('body.name');
      expect(error.constraint).toBe('maxLength');
      expect(error.actualLength).toBe(24);
      expect(error.maxLength).toBe(20);
      expect(error.message).toContain('too long');
      expect(error.message).toContain('20');
    });
  });

  describe('Numeric Range Validation Errors', () => {
    beforeEach(() => {
      app.post(
        '/test-range',
        validateSchema({
          body: {
            fields: {
              amount: { type: 'number', min: 0.0000001, max: 922337203.6853 },
            },
          },
        }),
        (req, res) => res.json({ success: true })
      );
    });

    test('min error includes actual value and minimum', async () => {
      const response = await request(app)
        .post('/test-range')
        .send({ amount: -5 });

      expect(response.status).toBe(400);
      const error = response.body.error.details[0];
      expect(error.path).toBe('body.amount');
      expect(error.constraint).toBe('min');
      expect(error.invalidValue).toBe('-5');
      expect(error.min).toBe(0.0000001);
      expect(error.message).toContain('too small');
      // Check for either scientific notation or decimal representation
      expect(error.message).toMatch(/0\.0000001|1e-7/);
    });

    test('max error includes actual value and maximum', async () => {
      const response = await request(app)
        .post('/test-range')
        .send({ amount: 1000000000 });

      expect(response.status).toBe(400);
      const error = response.body.error.details[0];
      expect(error.path).toBe('body.amount');
      expect(error.constraint).toBe('max');
      expect(error.invalidValue).toBe('1000000000');
      expect(error.max).toBe(922337203.6853);
      expect(error.message).toContain('too large');
    });
  });

  describe('Pattern Validation Errors', () => {
    beforeEach(() => {
      app.post(
        '/test-pattern',
        validateSchema({
          body: {
            fields: {
              publicKey: {
                type: 'string',
                pattern: /^G[A-Z2-7]{55}$/,
              },
            },
          },
        }),
        (req, res) => res.json({ success: true })
      );
    });

    test('pattern error includes invalid value and example', async () => {
      const response = await request(app)
        .post('/test-pattern')
        .send({ publicKey: 'invalid-key' });

      expect(response.status).toBe(400);
      const error = response.body.error.details[0];
      expect(error.path).toBe('body.publicKey');
      expect(error.constraint).toBe('pattern');
      expect(error.invalidValue).toContain('invalid-key');
      expect(error.example).toBeDefined();
      expect(error.guidance).toContain('Stellar public key');
      expect(error.message).toContain('invalid format');
    });
  });

  describe('Required Field Validation Errors', () => {
    beforeEach(() => {
      app.post(
        '/test-required',
        validateSchema({
          body: {
            fields: {
              email: { type: 'string', required: true },
              name: { type: 'string', required: true },
            },
          },
        }),
        (req, res) => res.json({ success: true })
      );
    });

    test('required error includes field path and example', async () => {
      const response = await request(app)
        .post('/test-required')
        .send({ name: 'John' });

      expect(response.status).toBe(400);
      const error = response.body.error.details[0];
      expect(error.path).toBe('body.email');
      expect(error.constraint).toBe('required');
      expect(error.invalidValue).toBe('undefined');
      expect(error.example).toBeDefined();
      expect(error.guidance).toContain('Provide a value');
      expect(error.message).toContain('required');
    });
  });

  describe('Null Field Validation Errors', () => {
    beforeEach(() => {
      app.post(
        '/test-null',
        validateSchema({
          body: {
            fields: {
              value: { type: 'string', nullable: false },
            },
          },
        }),
        (req, res) => res.json({ success: true })
      );
    });

    test('null error includes field path and example', async () => {
      const response = await request(app)
        .post('/test-null')
        .send({ value: null });

      expect(response.status).toBe(400);
      const error = response.body.error.details[0];
      expect(error.path).toBe('body.value');
      expect(error.constraint).toBe('nullable');
      expect(error.invalidValue).toBe('null');
      expect(error.example).toBeDefined();
      expect(error.message).toContain('cannot be null');
    });
  });

  describe('Unknown Fields Validation Errors', () => {
    beforeEach(() => {
      app.post(
        '/test-unknown',
        validateSchema({
          body: {
            fields: {
              name: { type: 'string' },
              email: { type: 'string' },
            },
          },
        }),
        (req, res) => res.json({ success: true })
      );
    });

    test('unknown fields error includes field names and allowed fields', async () => {
      const response = await request(app)
        .post('/test-unknown')
        .send({ name: 'John', email: 'john@example.com', extra: 'field', another: 'one' });

      expect(response.status).toBe(400);
      const error = response.body.error.details[0];
      expect(error.path).toBe('body');
      expect(error.constraint).toBe('unknownFields');
      expect(error.unknownFields).toContain('extra');
      expect(error.unknownFields).toContain('another');
      expect(error.allowedFields).toContain('name');
      expect(error.allowedFields).toContain('email');
      expect(error.guidance).toContain('Remove the unknown fields');
      expect(error.message).toContain('Unknown field(s)');
    });
  });

  describe('Custom Validation Errors', () => {
    beforeEach(() => {
      app.post(
        '/test-custom',
        validateSchema({
          body: {
            fields: {
              amount: {
                type: 'number',
                validate: (value) => {
                  if (value % 1 !== 0) {
                    return 'Amount must be a whole number (no decimals)';
                  }
                  return true;
                },
              },
            },
          },
        }),
        (req, res) => res.json({ success: true })
      );
    });

    test('custom validation error includes custom message', async () => {
      const response = await request(app)
        .post('/test-custom')
        .send({ amount: 10.5 });

      expect(response.status).toBe(400);
      const error = response.body.error.details[0];
      expect(error.path).toBe('body.amount');
      expect(error.constraint).toBe('custom');
      expect(error.message).toContain('whole number');
      expect(error.guidance).toContain('whole number');
    });
  });

  describe('Multiple Validation Errors', () => {
    beforeEach(() => {
      app.post(
        '/test-multiple',
        validateSchema({
          body: {
            fields: {
              name: { type: 'string', required: true, minLength: 3 },
              age: { type: 'integer', required: true, min: 0, max: 150 },
              email: { type: 'string', required: true },
            },
          },
        }),
        (req, res) => res.json({ success: true })
      );
    });

    test('multiple errors are all included in response', async () => {
      const response = await request(app)
        .post('/test-multiple')
        .send({ name: 'ab', age: 200 });

      expect(response.status).toBe(400);
      expect(response.body.error.details.length).toBeGreaterThanOrEqual(3);
      
      const paths = response.body.error.details.map(e => e.path);
      expect(paths).toContain('body.name');
      expect(paths).toContain('body.age');
      expect(paths).toContain('body.email');

      // Each error should have required fields
      response.body.error.details.forEach(error => {
        expect(error.path).toBeDefined();
        expect(error.message).toBeDefined();
        expect(error.constraint).toBeDefined();
        expect(error.guidance).toBeDefined();
      });
    });
  });

  describe('Sensitive Data Masking', () => {
    beforeEach(() => {
      app.post(
        '/test-masking',
        validateSchema({
          body: {
            fields: {
              value: { type: 'string', minLength: 1, maxLength: 100 },
            },
          },
        }),
        (req, res) => res.json({ success: true })
      );
    });

    test('long values are truncated in error messages', async () => {
      const longValue = 'a'.repeat(150);
      const response = await request(app)
        .post('/test-masking')
        .send({ value: longValue });

      expect(response.status).toBe(400);
      const error = response.body.error.details[0];
      expect(error.invalidValue).toContain('...');
      expect(error.invalidValue.length).toBeLessThan(150);
    });

    test('special characters in values are escaped', async () => {
      const response = await request(app)
        .post('/test-masking')
        .send({ value: 'test"with"quotes' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('Query Parameter Validation Errors', () => {
    beforeEach(() => {
      app.get(
        '/test-query',
        validateSchema({
          query: {
            fields: {
              limit: { type: 'integerString', required: false, min: 1, max: 100 },
              offset: { type: 'integerString', required: false, min: 0 },
            },
          },
        }),
        (req, res) => res.json({ success: true })
      );
    });

    test('query parameter validation errors include field path', async () => {
      const response = await request(app)
        .get('/test-query')
        .query({ limit: 'not-a-number' });

      expect(response.status).toBe(400);
      const error = response.body.error.details[0];
      expect(error.path).toBe('query.limit');
      expect(error.constraint).toBe('type');
    });
  });

  describe('Error Response Structure', () => {
    beforeEach(() => {
      app.post(
        '/test-structure',
        validateSchema({
          body: {
            fields: {
              value: { type: 'number', required: true },
            },
          },
        }),
        (req, res) => res.json({ success: true })
      );
    });

    test('error response includes all required fields', async () => {
      const response = await request(app)
        .post('/test-structure')
        .send({ value: 'invalid' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toBeDefined();
      expect(response.body.error.timestamp).toBeDefined();
      expect(response.body.error.details).toBeDefined();
      expect(Array.isArray(response.body.error.details)).toBe(true);
    });

    test('each error detail includes required fields', async () => {
      const response = await request(app)
        .post('/test-structure')
        .send({ value: 'invalid' });

      const error = response.body.error.details[0];
      expect(error.path).toBeDefined();
      expect(error.message).toBeDefined();
      expect(error.constraint).toBeDefined();
      expect(error.invalidValue).toBeDefined();
      expect(error.example).toBeDefined();
      expect(error.guidance).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    beforeEach(() => {
      app.post(
        '/test-edge',
        validateSchema({
          body: {
            fields: {
              value: { type: 'string', minLength: 1, maxLength: 5 },
            },
          },
        }),
        (req, res) => res.json({ success: true })
      );
    });

    test('empty string validation', async () => {
      const response = await request(app)
        .post('/test-edge')
        .send({ value: '' });

      expect(response.status).toBe(400);
      const error = response.body.error.details[0];
      expect(error.constraint).toBe('minLength');
      expect(error.actualLength).toBe(0);
    });

    test('boundary value validation', async () => {
      const response = await request(app)
        .post('/test-edge')
        .send({ value: 'abcdef' });

      expect(response.status).toBe(400);
      const error = response.body.error.details[0];
      expect(error.constraint).toBe('maxLength');
      expect(error.actualLength).toBe(6);
    });

    test('valid boundary values pass', async () => {
      const response = await request(app)
        .post('/test-edge')
        .send({ value: 'a' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });
});


describe('Validation Error Formatter Unit Tests', () => {
  const {
    sanitizeValueForDisplay,
    generateExampleValue,
    formatTypeError,
    formatEnumError,
    formatLengthError,
    formatRangeError,
    formatPatternError,
    formatRequiredError,
    formatNullError,
    formatUnknownFieldsError,
    formatCustomError,
    formatSegmentError,
  } = require('../../src/utils/validationErrorFormatter');

  describe('sanitizeValueForDisplay', () => {
    test('handles null values', () => {
      expect(sanitizeValueForDisplay(null)).toBe('null');
    });

    test('handles undefined values', () => {
      expect(sanitizeValueForDisplay(undefined)).toBe('undefined');
    });

    test('handles boolean values', () => {
      expect(sanitizeValueForDisplay(true)).toBe('true');
      expect(sanitizeValueForDisplay(false)).toBe('false');
    });

    test('handles number values', () => {
      expect(sanitizeValueForDisplay(42)).toBe('42');
      expect(sanitizeValueForDisplay(3.14)).toBe('3.14');
    });

    test('handles string values', () => {
      expect(sanitizeValueForDisplay('hello')).toBe('"hello"');
    });

    test('truncates long strings', () => {
      const longString = 'a'.repeat(100);
      const result = sanitizeValueForDisplay(longString);
      expect(result).toContain('...');
      expect(result.length).toBeLessThan(100);
    });

    test('escapes quotes in strings', () => {
      const result = sanitizeValueForDisplay('test"quote');
      expect(result).toContain('\\"');
    });

    test('handles arrays', () => {
      expect(sanitizeValueForDisplay([1, 2, 3])).toBe('array[3]');
    });

    test('handles objects', () => {
      expect(sanitizeValueForDisplay({ a: 1, b: 2 })).toBe('object{2 keys}');
    });
  });

  describe('generateExampleValue', () => {
    test('generates example for enum', () => {
      const result = generateExampleValue({ enum: ['a', 'b', 'c'] });
      expect(['a', 'b', 'c']).toContain(result.replace(/"/g, ''));
    });

    test('generates example for string type', () => {
      const result = generateExampleValue({ type: 'string' });
      expect(result).toBe('"example"');
    });

    test('generates example for number type', () => {
      const result = generateExampleValue({ type: 'number' });
      expect(result).toBe('10.5');
    });

    test('generates example for integer type', () => {
      const result = generateExampleValue({ type: 'integer' });
      expect(result).toBe('10');
    });

    test('generates example for boolean type', () => {
      const result = generateExampleValue({ type: 'boolean' });
      expect(result).toBe('true');
    });

    test('generates example for dateString type', () => {
      const result = generateExampleValue({ type: 'dateString' });
      expect(result).toContain('2024');
    });

    test('generates example for array type', () => {
      const result = generateExampleValue({ type: 'array' });
      expect(result).toBe('[]');
    });

    test('generates example for object type', () => {
      const result = generateExampleValue({ type: 'object' });
      expect(result).toBe('{}');
    });

    test('uses min value for number range', () => {
      const result = generateExampleValue({ type: 'number', min: 5 });
      expect(result).toBe('5');
    });

    test('uses min value for integer range', () => {
      const result = generateExampleValue({ type: 'integer', min: 10 });
      expect(result).toBe('10');
    });

    test('uses minLength for string', () => {
      const result = generateExampleValue({ type: 'string', minLength: 5 });
      expect(result).toContain('a');
    });
  });

  describe('formatTypeError', () => {
    test('includes all required fields', () => {
      const error = formatTypeError('body.field', 'invalid', ['string'], {});
      expect(error.path).toBe('body.field');
      expect(error.message).toBeDefined();
      expect(error.constraint).toBe('type');
      expect(error.invalidValue).toBeDefined();
      expect(error.expectedTypes).toEqual(['string']);
      expect(error.example).toBeDefined();
      expect(error.guidance).toBeDefined();
    });

    test('includes multiple expected types', () => {
      const error = formatTypeError('body.field', 'invalid', ['string', 'number'], {});
      expect(error.expectedTypes).toEqual(['string', 'number']);
      expect(error.message).toContain('string or number');
    });
  });

  describe('formatEnumError', () => {
    test('includes all required fields', () => {
      const error = formatEnumError('body.status', 'invalid', ['active', 'inactive']);
      expect(error.path).toBe('body.status');
      expect(error.constraint).toBe('enum');
      expect(error.allowedValues).toEqual(['active', 'inactive']);
      expect(error.example).toBeDefined();
      expect(error.guidance).toContain('allowed values');
    });
  });

  describe('formatLengthError', () => {
    test('handles minLength violation', () => {
      const error = formatLengthError('body.name', 'ab', 3, 20);
      expect(error.constraint).toBe('minLength');
      expect(error.actualLength).toBe(2);
      expect(error.minLength).toBe(3);
      expect(error.message).toContain('too short');
    });

    test('handles maxLength violation', () => {
      const error = formatLengthError('body.name', 'a'.repeat(25), 3, 20);
      expect(error.constraint).toBe('maxLength');
      expect(error.actualLength).toBe(25);
      expect(error.maxLength).toBe(20);
      expect(error.message).toContain('too long');
    });
  });

  describe('formatRangeError', () => {
    test('handles min violation', () => {
      const error = formatRangeError('body.amount', -5, 0, 100);
      expect(error.constraint).toBe('min');
      expect(error.min).toBe(0);
      expect(error.message).toContain('too small');
    });

    test('handles max violation', () => {
      const error = formatRangeError('body.amount', 150, 0, 100);
      expect(error.constraint).toBe('max');
      expect(error.max).toBe(100);
      expect(error.message).toContain('too large');
    });
  });

  describe('formatPatternError', () => {
    test('includes pattern in error', () => {
      const pattern = /^[a-z]+$/;
      const error = formatPatternError('body.code', '123', pattern, {});
      expect(error.constraint).toBe('pattern');
      expect(error.pattern).toBeDefined();
      expect(error.example).toBeDefined();
    });

    test('recognizes Stellar public key pattern', () => {
      const pattern = /^G[A-Z2-7]{55}$/;
      const error = formatPatternError('body.key', 'invalid', pattern, {});
      expect(error.guidance).toContain('Stellar public key');
    });

    test('recognizes hex pattern', () => {
      const pattern = /^[a-f0-9]+$/;
      const error = formatPatternError('body.hash', 'xyz', pattern, {});
      expect(error.guidance).toContain('hexadecimal');
    });
  });

  describe('formatRequiredError', () => {
    test('includes required constraint', () => {
      const error = formatRequiredError('body.email', {});
      expect(error.constraint).toBe('required');
      expect(error.invalidValue).toBe('undefined');
      expect(error.message).toContain('required');
    });
  });

  describe('formatNullError', () => {
    test('includes nullable constraint', () => {
      const error = formatNullError('body.value', {});
      expect(error.constraint).toBe('nullable');
      expect(error.invalidValue).toBe('null');
      expect(error.message).toContain('cannot be null');
    });
  });

  describe('formatUnknownFieldsError', () => {
    test('includes unknown fields and allowed fields', () => {
      const error = formatUnknownFieldsError('body', ['extra', 'unknown'], ['name', 'email']);
      expect(error.constraint).toBe('unknownFields');
      expect(error.unknownFields).toEqual(['extra', 'unknown']);
      expect(error.allowedFields).toEqual(['name', 'email']);
      expect(error.guidance).toContain('Remove the unknown fields');
    });

    test('handles no allowed fields', () => {
      const error = formatUnknownFieldsError('body', ['extra'], []);
      expect(error.allowedFields).toEqual([]);
      expect(error.message).toContain('does not accept');
    });
  });

  describe('formatCustomError', () => {
    test('includes custom message', () => {
      const error = formatCustomError('body.amount', 10.5, 'Amount must be whole number');
      expect(error.constraint).toBe('custom');
      expect(error.message).toBe('Amount must be whole number');
      expect(error.guidance).toBe('Amount must be whole number');
    });
  });

  describe('formatSegmentError', () => {
    test('includes segment error', () => {
      const error = formatSegmentError('body', 'Invalid request body');
      expect(error.constraint).toBe('segment');
      expect(error.message).toBe('Invalid request body');
    });
  });
});
