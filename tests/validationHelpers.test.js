const {
  validateInteger,
  validateFloat,
} = require('../src/utils/validationHelpers');

describe('validationHelpers strict parsing', () => {
  describe('validateInteger', () => {
    test('accepts valid integer number', () => {
      const result = validateInteger(10, { min: 1, max: 100 });
      expect(result.valid).toBe(true);
      expect(result.value).toBe(10);
    });

    test('accepts valid integer string', () => {
      const result = validateInteger('10', { min: 1, max: 100 });
      expect(result.valid).toBe(true);
      expect(result.value).toBe(10);
    });

    test('rejects silently coercible integer strings', () => {
      expect(validateInteger('10abc').valid).toBe(false);
      expect(validateInteger('1 0').valid).toBe(false);
      expect(validateInteger('10.0').valid).toBe(false);
    });
  });

  describe('validateFloat', () => {
    test('accepts valid float number', () => {
      const result = validateFloat(10.5, { min: 0 });
      expect(result.valid).toBe(true);
      expect(result.value).toBe(10.5);
    });

    test('accepts valid float string', () => {
      const result = validateFloat('10.5', { min: 0 });
      expect(result.valid).toBe(true);
      expect(result.value).toBe(10.5);
    });

    test('rejects silently coercible float strings', () => {
      expect(validateFloat('10.5abc').valid).toBe(false);
      expect(validateFloat('1 0.5').valid).toBe(false);
    });
  });
});
