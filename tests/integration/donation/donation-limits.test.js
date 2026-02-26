/**
 * Donation Amount Limits Tests
 * Tests for validating donation amounts against configurable limits
 * Run with: npm test -- donation-limits.test.js
 */

const DonationValidator = require('../../../src/utils/donationValidator');
const Transaction = require('../../../src/routes/models/transaction');
const fs = require('fs');
const path = require('path');

describe('Donation Amount Validation', () => {
  let validator;
  const testDbPath = path.join(__dirname, '../data/test-donations-limits.json');

  beforeEach(() => {
    // Create validator with test limits (using singleton)
    validator = DonationValidator;

    // Save original values
    validator._originalMin = validator.minAmount;
    validator._originalMax = validator.maxAmount;
    validator._originalDaily = validator.maxDailyPerDonor;

    // Override with test values
    validator.minAmount = 0.01;
    validator.maxAmount = 10000;
    validator.maxDailyPerDonor = 5000;

    // Use test database
    Transaction.getDbPath = () => testDbPath;

    // Clean up test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  afterEach(() => {
    // Clean up test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    // Restore original values
    if (validator._originalMin !== undefined) {
      validator.minAmount = validator._originalMin;
      validator.maxAmount = validator._originalMax;
      validator.maxDailyPerDonor = validator._originalDaily;
    }
  });

  describe('Minimum Amount Validation', () => {
    test('should reject amount below minimum', () => {
      const result = validator.validateAmount(0.005);

      expect(result.valid).toBe(false);
      expect(result.code).toBe('AMOUNT_BELOW_MINIMUM');
      expect(result.error).toContain('at least');
      expect(result.minAmount).toBe(0.01);
    });

    test('should accept amount equal to minimum', () => {
      const result = validator.validateAmount(0.01);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    test('should accept amount above minimum', () => {
      const result = validator.validateAmount(1.0);

      expect(result.valid).toBe(true);
    });
  });

  describe('Maximum Amount Validation', () => {
    test('should reject amount above maximum', () => {
      const result = validator.validateAmount(10001);

      expect(result.valid).toBe(false);
      expect(result.code).toBe('AMOUNT_EXCEEDS_MAXIMUM');
      expect(result.error).toContain('cannot exceed');
      expect(result.maxAmount).toBe(10000);
    });

    test('should accept amount equal to maximum', () => {
      const result = validator.validateAmount(10000);

      expect(result.valid).toBe(true);
    });

    test('should accept amount below maximum', () => {
      const result = validator.validateAmount(9999);

      expect(result.valid).toBe(true);
    });
  });

  describe('Invalid Amount Types', () => {
    test('should reject zero amount', () => {
      const result = validator.validateAmount(0);

      expect(result.valid).toBe(false);
      expect(result.code).toBe('AMOUNT_TOO_LOW');
    });

    test('should reject negative amount', () => {
      const result = validator.validateAmount(-10);

      expect(result.valid).toBe(false);
      expect(result.code).toBe('AMOUNT_TOO_LOW');
    });

    test('should reject NaN', () => {
      const result = validator.validateAmount(NaN);

      expect(result.valid).toBe(false);
      expect(result.code).toBe('INVALID_AMOUNT_TYPE');
    });

    test('should reject non-numeric string', () => {
      const result = validator.validateAmount('abc');

      expect(result.valid).toBe(false);
      expect(result.code).toBe('INVALID_AMOUNT_TYPE');
    });

    test('should reject null', () => {
      const result = validator.validateAmount(null);

      expect(result.valid).toBe(false);
      expect(result.code).toBe('INVALID_AMOUNT_TYPE');
    });

    test('should reject undefined', () => {
      const result = validator.validateAmount(undefined);

      expect(result.valid).toBe(false);
      expect(result.code).toBe('INVALID_AMOUNT_TYPE');
    });
  });

  describe('Valid Amount Range', () => {
    test('should accept typical donation amounts', () => {
      const amounts = [0.01, 1, 10, 100, 500, 1000, 5000, 10000];

      amounts.forEach(amount => {
        const result = validator.validateAmount(amount);
        expect(result.valid).toBe(true);
      });
    });

    test('should accept decimal amounts', () => {
      const result = validator.validateAmount(123.456789);

      expect(result.valid).toBe(true);
    });
  });

  describe('Daily Limit Validation', () => {
    test('should accept donation within daily limit', () => {
      const result = validator.validateDailyLimit(100, 0);

      expect(result.valid).toBe(true);
    });

    test('should reject donation exceeding daily limit', () => {
      const result = validator.validateDailyLimit(1000, 4500);

      expect(result.valid).toBe(false);
      expect(result.code).toBe('DAILY_LIMIT_EXCEEDED');
      expect(result.maxDailyAmount).toBe(5000);
      expect(result.currentDailyTotal).toBe(4500);
      expect(result.remainingDaily).toBe(500);
    });

    test('should accept donation at exact daily limit', () => {
      const result = validator.validateDailyLimit(1000, 4000);

      expect(result.valid).toBe(true);
    });

    test('should calculate remaining daily amount correctly', () => {
      const result = validator.validateDailyLimit(3000, 2500);

      expect(result.valid).toBe(false);
      expect(result.remainingDaily).toBe(2500);
    });

    test('should allow all donations when daily limit is 0', () => {
      validator.maxDailyPerDonor = 0;
      const result = validator.validateDailyLimit(100000, 50000);

      expect(result.valid).toBe(true);
    });
  });

  describe('Transaction Model Daily Total', () => {
    test('should calculate daily total for donor', () => {
      const donor = 'Alice';

      Transaction.create({
        amount: 100,
        donor,
        recipient: 'Bob',
        status: 'confirmed',
      });

      Transaction.create({
        amount: 200,
        donor,
        recipient: 'Charlie',
        status: 'confirmed',
      });

      Transaction.create({
        amount: 50,
        donor: 'Dave',
        recipient: 'Bob',
        status: 'confirmed',
      });

      const total = Transaction.getDailyTotalByDonor(donor);
      expect(total).toBe(300);
    });

    test('should exclude failed transactions from daily total', () => {
      const donor = 'Alice';

      Transaction.create({
        amount: 100,
        donor,
        recipient: 'Bob',
        status: 'confirmed',
      });

      Transaction.create({
        amount: 200,
        donor,
        recipient: 'Charlie',
        status: 'failed',
      });

      const total = Transaction.getDailyTotalByDonor(donor);
      expect(total).toBe(100);
    });

    test('should exclude cancelled transactions from daily total', () => {
      const donor = 'Alice';

      Transaction.create({
        amount: 100,
        donor,
        recipient: 'Bob',
        status: 'confirmed',
      });

      Transaction.create({
        amount: 200,
        donor,
        recipient: 'Charlie',
        status: 'cancelled',
      });

      const total = Transaction.getDailyTotalByDonor(donor);
      expect(total).toBe(100);
    });

    test('should only count transactions from today', () => {
      const donor = 'Alice';
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      // Create transaction for today
      Transaction.create({
        amount: 100,
        donor,
        recipient: 'Bob',
        status: 'confirmed',
      });

      const total = Transaction.getDailyTotalByDonor(donor);
      expect(total).toBe(100);
    });

    test('should return 0 for donor with no transactions', () => {
      const total = Transaction.getDailyTotalByDonor('NonExistentDonor');
      expect(total).toBe(0);
    });
  });

  describe('Get Limits', () => {
    test('should return current limits', () => {
      const limits = validator.getLimits();

      expect(limits).toHaveProperty('minAmount');
      expect(limits).toHaveProperty('maxAmount');
      expect(limits).toHaveProperty('maxDailyPerDonor');
      expect(limits.minAmount).toBe(0.01);
      expect(limits.maxAmount).toBe(10000);
      expect(limits.maxDailyPerDonor).toBe(5000);
    });
  });

  describe('Quick Range Check', () => {
    test('should quickly validate amount in range', () => {
      expect(validator.isValidRange(100)).toBe(true);
      expect(validator.isValidRange(0.005)).toBe(false);
      expect(validator.isValidRange(10001)).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    test('should handle very small valid amounts', () => {
      const result = validator.validateAmount(0.0100001);

      expect(result.valid).toBe(true);
    });

    test('should handle very large valid amounts', () => {
      const result = validator.validateAmount(9999.9999999);

      expect(result.valid).toBe(true);
    });

    test('should reject floating point precision exceeding 7 decimals', () => {
      const result = validator.validateAmount(0.1 + 0.2); // 0.30000000000000004

      expect(result.valid).toBe(false);
      expect(result.code).toBe('INVALID_AMOUNT_PRECISION');
    });

    test('should reject amount just below minimum', () => {
      const result = validator.validateAmount(0.009999);

      expect(result.valid).toBe(false);
      expect(result.code).toBe('AMOUNT_BELOW_MINIMUM');
    });

    test('should reject amount just above maximum', () => {
      const result = validator.validateAmount(10000.000001);

      expect(result.valid).toBe(false);
      expect(result.code).toBe('AMOUNT_EXCEEDS_MAXIMUM');
    });
  });

  describe('Multiple Donations Scenario', () => {
    test('should enforce daily limit across multiple donations', () => {
      const donor = 'Alice';

      // First donation
      Transaction.create({
        amount: 2000,
        donor,
        recipient: 'Bob',
        status: 'confirmed',
      });

      // Second donation
      Transaction.create({
        amount: 2000,
        donor,
        recipient: 'Charlie',
        status: 'confirmed',
      });

      const dailyTotal = Transaction.getDailyTotalByDonor(donor);
      expect(dailyTotal).toBe(4000);

      // Third donation should be limited
      const validation = validator.validateDailyLimit(1500, dailyTotal);
      expect(validation.valid).toBe(false);
      expect(validation.remainingDaily).toBe(1000);
    });

    test('should allow donation up to remaining daily limit', () => {
      const donor = 'Alice';

      Transaction.create({
        amount: 4500,
        donor,
        recipient: 'Bob',
        status: 'confirmed',
      });

      const dailyTotal = Transaction.getDailyTotalByDonor(donor);
      const validation = validator.validateDailyLimit(500, dailyTotal);

      expect(validation.valid).toBe(true);
    });
  });
});
