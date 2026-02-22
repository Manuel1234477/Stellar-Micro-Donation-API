/**
 * Unit Tests for DonationValidator
 * Tests all validation logic for donation amounts and limits
 */

const donationValidator = require('../src/utils/donationValidator');

describe('DonationValidator', () => {
  describe('validateAmount()', () => {
    describe('Valid amounts', () => {
      test('should accept valid amount within range', () => {
        const result = donationValidator.validateAmount(1.0);
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      test('should accept minimum allowed amount', () => {
        const limits = donationValidator.getLimits();
        const result = donationValidator.validateAmount(limits.minAmount);
        expect(result.valid).toBe(true);
      });

      test('should accept maximum allowed amount', () => {
        const limits = donationValidator.getLimits();
        const result = donationValidator.validateAmount(limits.maxAmount);
        expect(result.valid).toBe(true);
      });

      test('should accept amount with 7 decimal places (Stellar max precision)', () => {
        const result = donationValidator.validateAmount(1.1234567);
        expect(result.valid).toBe(true);
      });

      test('should accept amount with fewer than 7 decimal places', () => {
        const result = donationValidator.validateAmount(1.12);
        expect(result.valid).toBe(true);
      });

      test('should accept whole number amounts', () => {
        const result = donationValidator.validateAmount(100);
        expect(result.valid).toBe(true);
      });
    });

    describe('Invalid type handling', () => {
      test('should reject string amount', () => {
        const result = donationValidator.validateAmount('10');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('valid finite number');
        expect(result.code).toBe('INVALID_AMOUNT_TYPE');
      });

      test('should reject null amount', () => {
        const result = donationValidator.validateAmount(null);
        expect(result.valid).toBe(false);
        expect(result.code).toBe('INVALID_AMOUNT_TYPE');
      });

      test('should reject undefined amount', () => {
        const result = donationValidator.validateAmount(undefined);
        expect(result.valid).toBe(false);
        expect(result.code).toBe('INVALID_AMOUNT_TYPE');
      });

      test('should reject NaN', () => {
        const result = donationValidator.validateAmount(NaN);
        expect(result.valid).toBe(false);
        expect(result.code).toBe('INVALID_AMOUNT_TYPE');
      });

      test('should reject Infinity', () => {
        const result = donationValidator.validateAmount(Infinity);
        expect(result.valid).toBe(false);
        expect(result.code).toBe('INVALID_AMOUNT_TYPE');
      });

      test('should reject negative Infinity', () => {
        const result = donationValidator.validateAmount(-Infinity);
        expect(result.valid).toBe(false);
        expect(result.code).toBe('INVALID_AMOUNT_TYPE');
      });
    });

    describe('Precision validation', () => {
      test('should reject amount with more than 7 decimal places', () => {
        const result = donationValidator.validateAmount(1.12345678); // 8 decimals
        expect(result.valid).toBe(false);
        expect(result.error).toContain('7 decimal places');
        expect(result.code).toBe('INVALID_AMOUNT_PRECISION');
      });

      test('should reject amount with 10 decimal places', () => {
        const result = donationValidator.validateAmount(0.1234567890);
        expect(result.valid).toBe(false);
        expect(result.code).toBe('INVALID_AMOUNT_PRECISION');
      });
    });

    describe('Positive amount validation', () => {
      test('should reject zero amount', () => {
        const result = donationValidator.validateAmount(0);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('greater than zero');
        expect(result.code).toBe('AMOUNT_TOO_LOW');
      });

      test('should reject negative amount', () => {
        const result = donationValidator.validateAmount(-1);
        expect(result.valid).toBe(false);
        expect(result.code).toBe('AMOUNT_TOO_LOW');
      });

      test('should reject very small negative amount', () => {
        const result = donationValidator.validateAmount(-0.000001);
        expect(result.valid).toBe(false);
        expect(result.code).toBe('AMOUNT_TOO_LOW');
      });
    });

    describe('Minimum amount validation', () => {
      test('should reject amount below minimum', () => {
        const limits = donationValidator.getLimits();
        const result = donationValidator.validateAmount(limits.minAmount - 0.001);
        expect(result.valid).toBe(false);
        expect(result.error).toContain(`at least ${limits.minAmount}`);
        expect(result.code).toBe('AMOUNT_BELOW_MINIMUM');
        expect(result.minAmount).toBe(limits.minAmount);
      });

      test('should reject very small positive amount below minimum', () => {
        const result = donationValidator.validateAmount(0.0001); // Less than typical 0.01 min
        expect(result.valid).toBe(false);
        expect(result.code).toBe('AMOUNT_BELOW_MINIMUM');
      });
    });

    describe('Maximum amount validation', () => {
      test('should reject amount above maximum', () => {
        const limits = donationValidator.getLimits();
        const result = donationValidator.validateAmount(limits.maxAmount + 1);
        expect(result.valid).toBe(false);
        expect(result.error).toContain(`cannot exceed ${limits.maxAmount}`);
        expect(result.code).toBe('AMOUNT_EXCEEDS_MAXIMUM');
        expect(result.maxAmount).toBe(limits.maxAmount);
      });

      test('should reject very large amount', () => {
        const result = donationValidator.validateAmount(999999);
        expect(result.valid).toBe(false);
        expect(result.code).toBe('AMOUNT_EXCEEDS_MAXIMUM');
      });
    });
  });

  describe('validateDailyLimit()', () => {
    test('should allow donation when no daily limit is set', () => {
      // Assuming maxDailyPerDonor is 0 (no limit)
      const result = donationValidator.validateDailyLimit(100, 500);
      expect(result.valid).toBe(true);
    });

    test('should allow donation within daily limit', () => {
      const limits = donationValidator.getLimits();
      if (limits.maxDailyPerDonor > 0) {
        const result = donationValidator.validateDailyLimit(10, 0);
        expect(result.valid).toBe(true);
      }
    });

    test('should reject donation exceeding daily limit', () => {
      const limits = donationValidator.getLimits();
      if (limits.maxDailyPerDonor > 0) {
        const result = donationValidator.validateDailyLimit(
          limits.maxDailyPerDonor + 1,
          0
        );
        expect(result.valid).toBe(false);
        expect(result.code).toBe('DAILY_LIMIT_EXCEEDED');
        expect(result.maxDailyAmount).toBe(limits.maxDailyPerDonor);
      }
    });

    test('should reject donation when daily total plus new amount exceeds limit', () => {
      const limits = donationValidator.getLimits();
      if (limits.maxDailyPerDonor > 0) {
        const dailyTotal = limits.maxDailyPerDonor - 10;
        const newDonation = 20; // This would exceed limit
        const result = donationValidator.validateDailyLimit(newDonation, dailyTotal);
        expect(result.valid).toBe(false);
        expect(result.code).toBe('DAILY_LIMIT_EXCEEDED');
        expect(result.currentDailyTotal).toBe(dailyTotal);
        expect(result.remainingDaily).toBeLessThanOrEqual(10);
      }
    });

    test('should allow donation exactly at daily limit', () => {
      const limits = donationValidator.getLimits();
      if (limits.maxDailyPerDonor > 0) {
        const result = donationValidator.validateDailyLimit(
          limits.maxDailyPerDonor,
          0
        );
        expect(result.valid).toBe(true);
      }
    });
  });

  describe('getLimits()', () => {
    test('should return current validation limits', () => {
      const limits = donationValidator.getLimits();
      expect(limits).toHaveProperty('minAmount');
      expect(limits).toHaveProperty('maxAmount');
      expect(limits).toHaveProperty('maxDailyPerDonor');
      expect(typeof limits.minAmount).toBe('number');
      expect(typeof limits.maxAmount).toBe('number');
      expect(typeof limits.maxDailyPerDonor).toBe('number');
    });

    test('should have logical limit relationships', () => {
      const limits = donationValidator.getLimits();
      expect(limits.minAmount).toBeGreaterThan(0);
      expect(limits.maxAmount).toBeGreaterThan(limits.minAmount);
    });
  });

  describe('isValidRange()', () => {
    test('should return true for amount within range', () => {
      const result = donationValidator.isValidRange(10);
      expect(result).toBe(true);
    });

    test('should return false for amount below minimum', () => {
      const limits = donationValidator.getLimits();
      const result = donationValidator.isValidRange(limits.minAmount - 0.001);
      expect(result).toBe(false);
    });

    test('should return false for amount above maximum', () => {
      const limits = donationValidator.getLimits();
      const result = donationValidator.isValidRange(limits.maxAmount + 1);
      expect(result).toBe(false);
    });

    test('should return true for minimum amount', () => {
      const limits = donationValidator.getLimits();
      const result = donationValidator.isValidRange(limits.minAmount);
      expect(result).toBe(true);
    });

    test('should return true for maximum amount', () => {
      const limits = donationValidator.getLimits();
      const result = donationValidator.isValidRange(limits.maxAmount);
      expect(result).toBe(true);
    });
  });

  describe('Edge cases', () => {
    test('should handle very small valid amounts', () => {
      const result = donationValidator.validateAmount(0.01);
      if (result.valid) {
        expect(result.valid).toBe(true);
      } else {
        expect(result.code).toBe('AMOUNT_BELOW_MINIMUM');
      }
    });

    test('should handle amounts with trailing zeros', () => {
      const result = donationValidator.validateAmount(1.10);
      expect(result.valid).toBe(true);
    });

    test('should handle scientific notation', () => {
      const result = donationValidator.validateAmount(1e2); // 100
      expect(result.valid).toBe(true);
    });
  });
});
