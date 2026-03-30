/**
 * Corporate Matching Tests
 *
 * Tests for corporate donation matching functionality including:
 * - Matching donation creation on employee donation
 * - Per-employee annual limit enforcement
 * - Corporate total limit enforcement
 * - Matching ratio calculation
 */

const CorporateMatchingService = require('../../src/services/CorporateMatchingService');
const Database = require('../../src/utils/database');
const { ValidationError, NotFoundError } = require('../../src/utils/errors');

describe('CorporateMatchingService', () => {
  beforeAll(async () => {
    // Ensure database is initialized
    await Database.ensureInitialized();
  });

  beforeEach(async () => {
    // Clean up test data
    await Database.run('DELETE FROM corporate_matching_donations');
    await Database.run('DELETE FROM employee_matching_history');
    await Database.run('DELETE FROM matching_employees');
    await Database.run('DELETE FROM corporate_matching');
    await Database.run('DELETE FROM users');
    await Database.run('DELETE FROM transactions');

    // Insert test users
    await Database.run('INSERT INTO users (id, publicKey) VALUES (1, "GTEST_SPONSOR")');
    await Database.run('INSERT INTO users (id, publicKey) VALUES (2, "GTEST_EMPLOYEE1")');
    await Database.run('INSERT INTO users (id, publicKey) VALUES (3, "GTEST_EMPLOYEE2")');
    await Database.run('INSERT INTO users (id, publicKey) VALUES (4, "GTEST_RECIPIENT")');
  });

  describe('create', () => {
    test('should create a corporate matching program', async () => {
    try {
      const program = await CorporateMatchingService.create({
        sponsor_id: 1,
        match_ratio: 1.0,
        per_employee_limit: 100.0,
        total_limit: 1000.0
      });

      expect(program).toHaveProperty('id');
      expect(program.sponsor_id).toBe(1);
      expect(program.match_ratio).toBe(1.0);
      expect(program.per_employee_limit).toBe(100.0);
      expect(program.total_limit).toBe(1000.0);
      expect(program.remaining_total_limit).toBe(1000.0);
      expect(program.status).toBe('active');
    } catch (error) {
      console.error('Test error:', error);
      throw error;
    }

    test('should validate required fields', async () => {
      await expect(CorporateMatchingService.create({
        match_ratio: 1.0,
        per_employee_limit: 100.0,
        total_limit: 1000.0
      })).rejects.toThrow(ValidationError);
    });

    test('should validate match_ratio range', async () => {
      await expect(CorporateMatchingService.create({
        sponsor_id: 1,
        match_ratio: 0,
        per_employee_limit: 100.0,
        total_limit: 1000.0
      })).rejects.toThrow(ValidationError);

      await expect(CorporateMatchingService.create({
        sponsor_id: 1,
        match_ratio: 15.0,
        per_employee_limit: 100.0,
        total_limit: 1000.0
      })).rejects.toThrow(ValidationError);
    });
  });

  describe('enrollEmployee', () => {
    let program;

    beforeEach(async () => {
      program = await CorporateMatchingService.create({
        sponsor_id: 1,
        match_ratio: 1.0,
        per_employee_limit: 100.0,
        total_limit: 1000.0
      });
    });

    test('should enroll an employee', async () => {
      const enrollment = await CorporateMatchingService.enrollEmployee(program.id, 2);

      expect(enrollment).toHaveProperty('id');
      expect(enrollment.corporate_matching_id).toBe(program.id);
      expect(enrollment.employee_wallet_id).toBe(2);
    });

    test('should prevent duplicate enrollment', async () => {
      await CorporateMatchingService.enrollEmployee(program.id, 2);
      await expect(CorporateMatchingService.enrollEmployee(program.id, 2))
        .rejects.toThrow(ValidationError);
    });
  });

  describe('processCorporateMatching', () => {
    let program;
    const currentYear = new Date().getFullYear();

    beforeEach(async () => {
      program = await CorporateMatchingService.create({
        sponsor_id: 1,
        match_ratio: 1.0,
        per_employee_limit: 100.0,
        total_limit: 1000.0
      });
      await CorporateMatchingService.enrollEmployee(program.id, 2);
    });

    test('should create matching donation when enrolled employee', async () => {
      const donation = {
        id: 'test-donation-1',
        amount: 50.0,
        senderId: 2
      };

      const results = await CorporateMatchingService.processCorporateMatching(donation);

      expect(results).toHaveLength(1);
      expect(results[0].matched_amount).toBe(50.0);
      expect(results[0].corporate_matching_id).toBe(program.id);
      expect(results[0].employee_wallet_id).toBe(2);
      expect(results[0].year).toBe(currentYear);
    });

    test('should enforce per-employee annual limit', async () => {
      // First donation
      await CorporateMatchingService.processCorporateMatching({
        id: 'test-donation-1',
        amount: 80.0,
        senderId: 2
      });

      // Second donation should be limited
      const results = await CorporateMatchingService.processCorporateMatching({
        id: 'test-donation-2',
        amount: 50.0,
        senderId: 2
      });

      expect(results).toHaveLength(1);
      expect(results[0].matched_amount).toBe(20.0); // 100 - 80 = 20 remaining
    });

    test('should enforce corporate total limit', async () => {
      // Create program with small total limit
      const smallProgram = await CorporateMatchingService.create({
        sponsor_id: 1,
        match_ratio: 1.0,
        per_employee_limit: 1000.0,
        total_limit: 50.0
      });
      await CorporateMatchingService.enrollEmployee(smallProgram.id, 2);

      const results = await CorporateMatchingService.processCorporateMatching({
        id: 'test-donation-1',
        amount: 100.0,
        senderId: 2
      });

      expect(results).toHaveLength(1);
      expect(results[0].matched_amount).toBe(50.0); // Limited by total
    });

    test('should apply match ratio correctly', async () => {
      // Create program with 0.5 ratio
      const ratioProgram = await CorporateMatchingService.create({
        sponsor_id: 1,
        match_ratio: 0.5,
        per_employee_limit: 1000.0,
        total_limit: 1000.0
      });
      await CorporateMatchingService.enrollEmployee(ratioProgram.id, 2);

      const results = await CorporateMatchingService.processCorporateMatching({
        id: 'test-donation-1',
        amount: 100.0,
        senderId: 2
      });

      expect(results).toHaveLength(1);
      expect(results[0].matched_amount).toBe(50.0); // 100 * 0.5
    });

    test('should not match when non-enrolled employees', async () => {
      const results = await CorporateMatchingService.processCorporateMatching({
        id: 'test-donation-1',
        amount: 50.0,
        senderId: 3 // Not enrolled
      });

      expect(results).toHaveLength(0);
    });

    test('should not match when employee limit exhausted', async () => {
      // Exhaust employee limit
      await CorporateMatchingService.processCorporateMatching({
        id: 'test-donation-1',
        amount: 100.0,
        senderId: 2
      });

      // Next donation should not be matched
      const results = await CorporateMatchingService.processCorporateMatching({
        id: 'test-donation-2',
        amount: 50.0,
        senderId: 2
      });

      expect(results).toHaveLength(0);
    });

    test('should mark program as exhausted when total limit reached', async () => {
      // Create program with small limit
      const smallProgram = await CorporateMatchingService.create({
        sponsor_id: 1,
        match_ratio: 1.0,
        per_employee_limit: 1000.0,
        total_limit: 50.0
      });
      await CorporateMatchingService.enrollEmployee(smallProgram.id, 2);

      await CorporateMatchingService.processCorporateMatching({
        id: 'test-donation-1',
        amount: 50.0,
        senderId: 2
      });

      // Check program status
      const updatedProgram = await CorporateMatchingService.getById(smallProgram.id);
      expect(updatedProgram.status).toBe('exhausted');
    });
  });

  describe('getEmployeePrograms', () => {
    test('should return active programs when enrolled employee', async () => {
      const program = await CorporateMatchingService.create({
        sponsor_id: 1,
        match_ratio: 1.0,
        per_employee_limit: 100.0,
        total_limit: 1000.0
      });
      await CorporateMatchingService.enrollEmployee(program.id, 2);

      const programs = await CorporateMatchingService.getEmployeePrograms(2);

      expect(programs).toHaveLength(1);
      expect(programs[0].id).toBe(program.id);
    });
  });

  describe('getEmployeeYearMatched', () => {
    test('should return matched amount when employee in program when year', async () => {
      const program = await CorporateMatchingService.create({
        sponsor_id: 1,
        match_ratio: 1.0,
        per_employee_limit: 100.0,
        total_limit: 1000.0
      });

      const amount = await CorporateMatchingService.getEmployeeYearMatched(program.id, 2, 2024);
      expect(amount).toBe(0);
    });
  });
});