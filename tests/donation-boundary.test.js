/**
 * Donation Amount Boundary Tests
 * Comprehensive boundary condition testing for donation amounts
 * Tests edge cases, precision limits, and financial logic
 */

const DonationValidator = require('../src/utils/donationValidator');

describe('Donation Amount Boundary Tests', () => {
  let validator;
  let originalMin, originalMax, originalDaily;

  beforeEach(() => {
    validator = DonationValidator;
    
    // Save original values
    originalMin = validator.minAmount;
    originalMax = validator.maxAmount;
    originalDaily = validator.maxDailyPerDonor;
    
    // Set test values
    validator.minAmount = 0.01;
    validator.maxAmount = 10000;
    validator.maxDailyPerDonor = 5000;
  });

  afterEach(() => {
    // Restore original values
    validator.minAmount = originalMin;
    validator.maxAmount = originalMax;
    validator.maxDailyPerDonor = originalDaily;
  });

  describe('Exact Boundary Values', () => {
    it('should accept exact minimum amount (0.01)', () => {
      const result = validator.validateAmount(0.01);
      expect(result.valid).toBe(true);
    });

    it('should accept exact maximum amount (10000)', () => {
      const result = validator.validateAmount(10000);
      expect(result.valid).toBe(true);
    });

    it('should reject one unit below minimum (0.009)', () => {
      const result = validator.validateAmount(0.009);
      expect(result.valid).toBe(false);
      expect(result.code).toBe('AMOUNT_BELOW_MINIMUM');
    });

    it('should reject one unit above maximum (10000.01)', () => {
      const result = validator.validateAmount(10000.01);
      expect(result.valid).toBe(false);
      expect(result.code).toBe('AMOUNT_EXCEEDS_MAXIMUM');
    });

    it('should accept amount just inside minimum (0.0100001)', () => {
      const result = validator.validateAmount(0.0100001);
      expect(result.valid).toBe(true);
    });

    it('should accept amount just inside maximum (9999.9999999)', () => {
      const result = validator.validateAmount(9999.9999999);
      expect(result.valid).toBe(true);
    });
  });

  describe('Zero and Negative Boundaries', () => {
    it('should reject zero amount', () => {
      const result = validator.validateAmount(0);
      expect(result.valid).toBe(false);
      expect(result.code).toBe('AMOUNT_TOO_LOW');
    });

    it('should reject negative amount', () => {
      const result = validator.validateAmount(-0.01);
      expect(result.valid).toBe(false);
      expect(result.code).toBe('AMOUNT_TOO_LOW');
    });

    it('should reject large negative amount', () => {
      const result = validator.validateAmount(-1000);
      expect(result.valid).toBe(false);
      expect(result.code).toBe('AMOUNT_TOO_LOW');
    });

    it('should reject negative zero (-0)', () => {
      const result = validator.validateAmount(-0);
      expect(result.valid).toBe(false);
      expect(result.code).toBe('AMOUNT_TOO_LOW');
    });
  });

  describe('Decimal Precision Boundaries', () => {
    it('should accept 7 decimal places (Stellar limit)', () => {
      const result = validator.validateAmount(1.1234567);
      expect(result.valid).toBe(true);
    });

    it('should reject 8 decimal places', () => {
      const result = validator.validateAmount(1.12345678);
      expect(result.valid).toBe(false);
      expect(result.code).toBe('INVALID_AMOUNT_PRECISION');
    });

    it('should reject 10 decimal places', () => {
      const result = validator.validateAmount(1.1234567890);
      expect(result.valid).toBe(false);
      expect(result.code).toBe('INVALID_AMOUNT_PRECISION');
    });

    it('should accept minimum with 7 decimals (0.0100000)', () => {
      const result = validator.validateAmount(0.0100000);
      expect(result.valid).toBe(true);
    });

    it('should accept maximum with 7 decimals (10000.0000000)', () => {
      const result = validator.validateAmount(10000.0000000);
      expect(result.valid).toBe(true);
    });

    it('should accept whole numbers (no decimals)', () => {
      const result = validator.validateAmount(100);
      expect(result.valid).toBe(true);
    });

    it('should accept 1 decimal place', () => {
      const result = validator.validateAmount(1.5);
      expect(result.valid).toBe(true);
    });
  });

  describe('Special Number Values', () => {
    it('should reject Infinity', () => {
      const result = validator.validateAmount(Infinity);
      expect(result.valid).toBe(false);
      expect(result.code).toBe('INVALID_AMOUNT_TYPE');
    });

    it('should reject -Infinity', () => {
      const result = validator.validateAmount(-Infinity);
      expect(result.valid).toBe(false);
      expect(result.code).toBe('INVALID_AMOUNT_TYPE');
    });

    it('should reject NaN', () => {
      const result = validator.validateAmount(NaN);
      expect(result.valid).toBe(false);
      expect(result.code).toBe('INVALID_AMOUNT_TYPE');
    });

    it('should reject Number.MAX_VALUE', () => {
      const result = validator.validateAmount(Number.MAX_VALUE);
      expect(result.valid).toBe(false);
      // MAX_VALUE has too many decimal places, so precision error comes first
      expect(result.code).toBe('INVALID_AMOUNT_PRECISION');
    });

    it('should reject Number.MIN_VALUE (too small)', () => {
      const result = validator.validateAmount(Number.MIN_VALUE);
      expect(result.valid).toBe(false);
      expect(result.code).toBe('AMOUNT_BELOW_MINIMUM');
    });
  });

  describe('Type Boundaries', () => {
    it('should reject string number', () => {
      const result = validator.validateAmount('100');
      expect(result.valid).toBe(false);
      expect(result.code).toBe('INVALID_AMOUNT_TYPE');
    });

    it('should reject null', () => {
      const result = validator.validateAmount(null);
      expect(result.valid).toBe(false);
      expect(result.code).toBe('INVALID_AMOUNT_TYPE');
    });

    it('should reject undefined', () => {
      const result = validator.validateAmount(undefined);
      expect(result.valid).toBe(false);
      expect(result.code).toBe('INVALID_AMOUNT_TYPE');
    });

    it('should reject object', () => {
      const result = validator.validateAmount({});
      expect(result.valid).toBe(false);
      expect(result.code).toBe('INVALID_AMOUNT_TYPE');
    });

    it('should reject array', () => {
      const result = validator.validateAmount([100]);
      expect(result.valid).toBe(false);
      expect(result.code).toBe('INVALID_AMOUNT_TYPE');
    });

    it('should reject boolean', () => {
      const result = validator.validateAmount(true);
      expect(result.valid).toBe(false);
      expect(result.code).toBe('INVALID_AMOUNT_TYPE');
    });
  });

  describe('Daily Limit Boundaries', () => {
    it('should accept donation at exact daily limit', () => {
      const result = validator.validateDailyLimit(5000, 0);
      expect(result.valid).toBe(true);
    });

    it('should reject donation exceeding daily limit by 0.01', () => {
      const result = validator.validateDailyLimit(5000.01, 0);
      expect(result.valid).toBe(false);
      expect(result.code).toBe('DAILY_LIMIT_EXCEEDED');
    });

    it('should accept donation just under daily limit', () => {
      const result = validator.validateDailyLimit(4999.99, 0);
      expect(result.valid).toBe(true);
    });

    it('should reject when current + new exceeds limit', () => {
      const result = validator.validateDailyLimit(1000, 4500);
      expect(result.valid).toBe(false);
      expect(result.code).toBe('DAILY_LIMIT_EXCEEDED');
      expect(result.remainingDaily).toBe(500);
    });

    it('should accept when current + new equals limit', () => {
      const result = validator.validateDailyLimit(1000, 4000);
      expect(result.valid).toBe(true);
    });

    it('should calculate remaining daily amount correctly', () => {
      const result = validator.validateDailyLimit(3000, 2500);
      expect(result.valid).toBe(false);
      expect(result.remainingDaily).toBe(2500);
      expect(result.currentDailyTotal).toBe(2500);
    });

    it('should allow all donations when daily limit is 0', () => {
      validator.maxDailyPerDonor = 0;
      const result = validator.validateDailyLimit(999999, 999999);
      expect(result.valid).toBe(true);
    });

    it('should handle zero current daily total', () => {
      const result = validator.validateDailyLimit(100, 0);
      expect(result.valid).toBe(true);
    });

    it('should handle exact remaining amount', () => {
      const result = validator.validateDailyLimit(500, 4500);
      expect(result.valid).toBe(true);
    });
  });

  describe('Floating Point Edge Cases', () => {
    it('should handle 0.1 + 0.2 precision issue', () => {
      const amount = 0.1 + 0.2; // 0.30000000000000004 (17 decimals)
      const result = validator.validateAmount(amount);
      // This has more than 7 decimal places due to floating point precision
      expect(result.valid).toBe(false);
      expect(result.code).toBe('INVALID_AMOUNT_PRECISION');
    });

    it('should handle very small positive number', () => {
      const result = validator.validateAmount(0.0000001);
      expect(result.valid).toBe(false);
      expect(result.code).toBe('AMOUNT_BELOW_MINIMUM');
    });

    it('should handle number close to zero', () => {
      const result = validator.validateAmount(0.00000001);
      expect(result.valid).toBe(false);
      expect(result.code).toBe('AMOUNT_BELOW_MINIMUM');
    });

    it('should handle large decimal number', () => {
      const result = validator.validateAmount(9999.9999999);
      expect(result.valid).toBe(true);
    });

    it('should handle scientific notation (1e-8)', () => {
      const result = validator.validateAmount(1e-8);
      expect(result.valid).toBe(false);
      expect(result.code).toBe('AMOUNT_BELOW_MINIMUM');
    });

    it('should handle scientific notation (1e2)', () => {
      const result = validator.validateAmount(1e2); // 100
      expect(result.valid).toBe(true);
    });

    it('should handle scientific notation (1e4)', () => {
      const result = validator.validateAmount(1e4); // 10000
      expect(result.valid).toBe(true);
    });

    it('should handle scientific notation (1e5)', () => {
      const result = validator.validateAmount(1e5); // 100000
      expect(result.valid).toBe(false);
      expect(result.code).toBe('AMOUNT_EXCEEDS_MAXIMUM');
    });
  });

  describe('Range Check Utility', () => {
    it('should return true for amount within range', () => {
      expect(validator.isValidRange(100)).toBe(true);
    });

    it('should return true for minimum amount', () => {
      expect(validator.isValidRange(0.01)).toBe(true);
    });

    it('should return true for maximum amount', () => {
      expect(validator.isValidRange(10000)).toBe(true);
    });

    it('should return false for amount below minimum', () => {
      expect(validator.isValidRange(0.009)).toBe(false);
    });

    it('should return false for amount above maximum', () => {
      expect(validator.isValidRange(10001)).toBe(false);
    });

    it('should return false for zero', () => {
      expect(validator.isValidRange(0)).toBe(false);
    });

    it('should return false for negative', () => {
      expect(validator.isValidRange(-1)).toBe(false);
    });
  });

  describe('Get Limits', () => {
    it('should return current limits', () => {
      const limits = validator.getLimits();
      
      expect(limits.minAmount).toBe(0.01);
      expect(limits.maxAmount).toBe(10000);
      expect(limits.maxDailyPerDonor).toBe(5000);
    });

    it('should return updated limits after change', () => {
      validator.minAmount = 0.05;
      validator.maxAmount = 5000;
      
      const limits = validator.getLimits();
      
      expect(limits.minAmount).toBe(0.05);
      expect(limits.maxAmount).toBe(5000);
    });
  });

  describe('Real-World Donation Scenarios', () => {
    it('should accept typical small donation (1 XLM)', () => {
      const result = validator.validateAmount(1);
      expect(result.valid).toBe(true);
    });

    it('should accept typical medium donation (100 XLM)', () => {
      const result = validator.validateAmount(100);
      expect(result.valid).toBe(true);
    });

    it('should accept typical large donation (1000 XLM)', () => {
      const result = validator.validateAmount(1000);
      expect(result.valid).toBe(true);
    });

    it('should accept micro-donation at minimum (0.01 XLM)', () => {
      const result = validator.validateAmount(0.01);
      expect(result.valid).toBe(true);
    });

    it('should accept maximum donation (10000 XLM)', () => {
      const result = validator.validateAmount(10000);
      expect(result.valid).toBe(true);
    });

    it('should reject donation below micro-minimum', () => {
      const result = validator.validateAmount(0.001);
      expect(result.valid).toBe(false);
    });

    it('should reject donation above maximum', () => {
      const result = validator.validateAmount(10001);
      expect(result.valid).toBe(false);
    });

    it('should handle multiple small donations within daily limit', () => {
      let dailyTotal = 0;
      
      for (let i = 0; i < 100; i++) {
        const result = validator.validateDailyLimit(10, dailyTotal);
        if (result.valid) {
          dailyTotal += 10;
        }
      }
      
      expect(dailyTotal).toBe(1000);
    });

    it('should prevent exceeding daily limit with large donation', () => {
      const result = validator.validateDailyLimit(6000, 0);
      expect(result.valid).toBe(false);
    });
  });

  describe('Error Message Quality', () => {
    it('should provide clear error for amount below minimum', () => {
      const result = validator.validateAmount(0.005);
      expect(result.error).toContain('at least');
      expect(result.error).toContain('0.01');
    });

    it('should provide clear error for amount above maximum', () => {
      const result = validator.validateAmount(20000);
      expect(result.error).toContain('cannot exceed');
      expect(result.error).toContain('10000');
    });

    it('should provide clear error for invalid type', () => {
      const result = validator.validateAmount('100');
      expect(result.error).toContain('valid finite number');
    });

    it('should provide clear error for precision', () => {
      const result = validator.validateAmount(1.12345678);
      expect(result.error).toContain('7 decimal places');
      expect(result.error).toContain('Stellar');
    });

    it('should provide clear error for daily limit', () => {
      const result = validator.validateDailyLimit(6000, 0);
      expect(result.error).toContain('Daily donation limit');
      expect(result.error).toContain('5000');
    });

    it('should include remaining daily amount in error', () => {
      const result = validator.validateDailyLimit(3000, 3000);
      expect(result.remainingDaily).toBe(2000);
    });
  });
});
