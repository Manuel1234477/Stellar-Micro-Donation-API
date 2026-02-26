/**
 * Audit Log Service Tests
 * 
 * Tests for security audit logging functionality including:
 * - Audit log creation with integrity hashing
 * - Query and filtering capabilities
 * - Sensitive data masking
 * - Immutability verification
 */

const AuditLogService = require('../src/services/AuditLogService');
const Database = require('../src/utils/database');

describe('AuditLogService', () => {
  beforeAll(async () => {
    // Create audit_logs table for testing
    await Database.run(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        category TEXT NOT NULL,
        action TEXT NOT NULL,
        severity TEXT NOT NULL,
        result TEXT NOT NULL,
        userId TEXT,
        requestId TEXT,
        ipAddress TEXT,
        resource TEXT,
        reason TEXT,
        details TEXT,
        integrityHash TEXT NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  });

  afterEach(async () => {
    // Clean up audit logs after each test
    await Database.run('DELETE FROM audit_logs');
  });

  afterAll(async () => {
    // Drop test table
    await Database.run('DROP TABLE IF EXISTS audit_logs');
  });

  describe('log()', () => {
    it('should create audit log entry with all required fields', async () => {
      const entry = await AuditLogService.log({
        category: AuditLogService.CATEGORY.AUTHENTICATION,
        action: AuditLogService.ACTION.API_KEY_VALIDATED,
        severity: AuditLogService.SEVERITY.LOW,
        result: 'SUCCESS',
        userId: 'user-123',
        requestId: 'req-456',
        ipAddress: '192.168.1.1',
        resource: '/api/v1/donations',
        details: { role: 'user' }
      });

      expect(entry).toBeDefined();
      expect(entry.id).toBeDefined();
      expect(entry.category).toBe(AuditLogService.CATEGORY.AUTHENTICATION);
      expect(entry.action).toBe(AuditLogService.ACTION.API_KEY_VALIDATED);
      expect(entry.severity).toBe(AuditLogService.SEVERITY.LOW);
      expect(entry.result).toBe('SUCCESS');
      expect(entry.userId).toBe('user-123');
      expect(entry.requestId).toBe('req-456');
      expect(entry.ipAddress).toBe('192.168.1.1');
      expect(entry.resource).toBe('/api/v1/donations');
      expect(entry.integrityHash).toBeDefined();
      expect(entry.integrityHash).toHaveLength(64); // SHA-256 hash
    });

    it('should generate unique integrity hash for each entry', async () => {
      const entry1 = await AuditLogService.log({
        category: AuditLogService.CATEGORY.AUTHENTICATION,
        action: AuditLogService.ACTION.API_KEY_VALIDATED,
        severity: AuditLogService.SEVERITY.LOW,
        result: 'SUCCESS',
        userId: 'user-123',
        requestId: 'req-1',
        ipAddress: '192.168.1.1',
        details: {}
      });

      const entry2 = await AuditLogService.log({
        category: AuditLogService.CATEGORY.AUTHENTICATION,
        action: AuditLogService.ACTION.API_KEY_VALIDATED,
        severity: AuditLogService.SEVERITY.LOW,
        result: 'SUCCESS',
        userId: 'user-123',
        requestId: 'req-2',
        ipAddress: '192.168.1.1',
        details: {}
      });

      expect(entry1.integrityHash).not.toBe(entry2.integrityHash);
    });

    it('should sanitize sensitive data in details', async () => {
      const entry = await AuditLogService.log({
        category: AuditLogService.CATEGORY.API_KEY_MANAGEMENT,
        action: AuditLogService.ACTION.API_KEY_CREATED,
        severity: AuditLogService.SEVERITY.HIGH,
        result: 'SUCCESS',
        userId: 'admin-1',
        requestId: 'req-789',
        ipAddress: '192.168.1.1',
        details: {
          apiKey: 'sk_live_1234567890abcdef',
          password: 'secret123',
          role: 'admin'
        }
      });

      const storedEntry = await Database.get(
        'SELECT * FROM audit_logs WHERE id = ?',
        [entry.id]
      );

      const parsedDetails = JSON.parse(storedEntry.details);
      expect(parsedDetails.apiKey).toContain('***');
      expect(parsedDetails.password).toContain('***');
      expect(parsedDetails.role).toBe('admin'); // Non-sensitive data preserved
    });

    it('should handle missing optional fields', async () => {
      const entry = await AuditLogService.log({
        category: AuditLogService.CATEGORY.AUTHORIZATION,
        action: AuditLogService.ACTION.PERMISSION_DENIED,
        severity: AuditLogService.SEVERITY.HIGH,
        result: 'FAILURE'
      });

      expect(entry).toBeDefined();
      expect(entry.userId).toBeNull();
      expect(entry.requestId).toBeNull();
      expect(entry.ipAddress).toBeNull();
      expect(entry.resource).toBeNull();
      expect(entry.reason).toBeNull();
    });

    it('should throw error for missing required fields', async () => {
      await expect(
        AuditLogService.log({
          category: AuditLogService.CATEGORY.AUTHENTICATION,
          // Missing action, severity, result
        })
      ).rejects.toThrow('Missing required audit log fields');
    });
  });

  describe('verifyIntegrity()', () => {
    it('should verify integrity of valid audit log entry', async () => {
      const entry = await AuditLogService.log({
        category: AuditLogService.CATEGORY.FINANCIAL_OPERATION,
        action: AuditLogService.ACTION.DONATION_CREATED,
        severity: AuditLogService.SEVERITY.HIGH,
        result: 'SUCCESS',
        userId: 'user-123',
        requestId: 'req-456',
        ipAddress: '192.168.1.1',
        details: { amount: 100 }
      });

      const storedEntry = await Database.get(
        'SELECT * FROM audit_logs WHERE id = ?',
        [entry.id]
      );

      const isValid = AuditLogService.verifyIntegrity(storedEntry);
      expect(isValid).toBe(true);
    });

    it('should detect tampered audit log entry', async () => {
      const entry = await AuditLogService.log({
        category: AuditLogService.CATEGORY.FINANCIAL_OPERATION,
        action: AuditLogService.ACTION.DONATION_CREATED,
        severity: AuditLogService.SEVERITY.HIGH,
        result: 'SUCCESS',
        userId: 'user-123',
        requestId: 'req-456',
        ipAddress: '192.168.1.1',
        details: { amount: 100 }
      });

      // Tamper with the entry
      await Database.run(
        'UPDATE audit_logs SET result = ? WHERE id = ?',
        ['FAILURE', entry.id]
      );

      const tamperedEntry = await Database.get(
        'SELECT * FROM audit_logs WHERE id = ?',
        [entry.id]
      );

      const isValid = AuditLogService.verifyIntegrity(tamperedEntry);
      expect(isValid).toBe(false);
    });
  });

  describe('query()', () => {
    beforeEach(async () => {
      // Create test audit logs
      await AuditLogService.log({
        category: AuditLogService.CATEGORY.AUTHENTICATION,
        action: AuditLogService.ACTION.API_KEY_VALIDATED,
        severity: AuditLogService.SEVERITY.LOW,
        result: 'SUCCESS',
        userId: 'user-1',
        requestId: 'req-1',
        ipAddress: '192.168.1.1'
      });

      await AuditLogService.log({
        category: AuditLogService.CATEGORY.AUTHENTICATION,
        action: AuditLogService.ACTION.API_KEY_VALIDATION_FAILED,
        severity: AuditLogService.SEVERITY.HIGH,
        result: 'FAILURE',
        userId: 'user-2',
        requestId: 'req-2',
        ipAddress: '192.168.1.2'
      });

      await AuditLogService.log({
        category: AuditLogService.CATEGORY.AUTHORIZATION,
        action: AuditLogService.ACTION.PERMISSION_DENIED,
        severity: AuditLogService.SEVERITY.HIGH,
        result: 'FAILURE',
        userId: 'user-1',
        requestId: 'req-3',
        ipAddress: '192.168.1.1'
      });
    });

    it('should query all audit logs without filters', async () => {
      const logs = await AuditLogService.query();
      expect(logs).toHaveLength(3);
    });

    it('should filter by category', async () => {
      const logs = await AuditLogService.query({
        category: AuditLogService.CATEGORY.AUTHENTICATION
      });
      expect(logs).toHaveLength(2);
      expect(logs.every(log => log.category === AuditLogService.CATEGORY.AUTHENTICATION)).toBe(true);
    });

    it('should filter by action', async () => {
      const logs = await AuditLogService.query({
        action: AuditLogService.ACTION.API_KEY_VALIDATED
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe(AuditLogService.ACTION.API_KEY_VALIDATED);
    });

    it('should filter by severity', async () => {
      const logs = await AuditLogService.query({
        severity: AuditLogService.SEVERITY.HIGH
      });
      expect(logs).toHaveLength(2);
      expect(logs.every(log => log.severity === AuditLogService.SEVERITY.HIGH)).toBe(true);
    });

    it('should filter by userId', async () => {
      const logs = await AuditLogService.query({
        userId: 'user-1'
      });
      expect(logs).toHaveLength(2);
      expect(logs.every(log => log.userId === 'user-1')).toBe(true);
    });

    it('should filter by requestId', async () => {
      const logs = await AuditLogService.query({
        requestId: 'req-2'
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].requestId).toBe('req-2');
    });

    it('should support pagination with limit and offset', async () => {
      const page1 = await AuditLogService.query({ limit: 2, offset: 0 });
      const page2 = await AuditLogService.query({ limit: 2, offset: 2 });

      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(1);
      expect(page1[0].id).not.toBe(page2[0].id);
    });

    it('should parse JSON details in query results', async () => {
      await AuditLogService.log({
        category: AuditLogService.CATEGORY.FINANCIAL_OPERATION,
        action: AuditLogService.ACTION.DONATION_CREATED,
        severity: AuditLogService.SEVERITY.HIGH,
        result: 'SUCCESS',
        details: { amount: 100, currency: 'XLM' }
      });

      const logs = await AuditLogService.query({
        action: AuditLogService.ACTION.DONATION_CREATED
      });

      expect(logs).toHaveLength(1);
      expect(logs[0].details).toEqual({ amount: 100, currency: 'XLM' });
    });
  });

  describe('getStatistics()', () => {
    beforeEach(async () => {
      // Create test audit logs
      await AuditLogService.log({
        category: AuditLogService.CATEGORY.AUTHENTICATION,
        action: AuditLogService.ACTION.API_KEY_VALIDATED,
        severity: AuditLogService.SEVERITY.LOW,
        result: 'SUCCESS'
      });

      await AuditLogService.log({
        category: AuditLogService.CATEGORY.AUTHENTICATION,
        action: AuditLogService.ACTION.API_KEY_VALIDATED,
        severity: AuditLogService.SEVERITY.LOW,
        result: 'SUCCESS'
      });

      await AuditLogService.log({
        category: AuditLogService.CATEGORY.AUTHENTICATION,
        action: AuditLogService.ACTION.API_KEY_VALIDATION_FAILED,
        severity: AuditLogService.SEVERITY.HIGH,
        result: 'FAILURE'
      });
    });

    it('should return statistics grouped by category, action, severity, and result', async () => {
      const stats = await AuditLogService.getStatistics();

      expect(stats).toHaveLength(2);
      
      const successStats = stats.find(s => s.result === 'SUCCESS');
      expect(successStats.count).toBe(2);
      expect(successStats.action).toBe(AuditLogService.ACTION.API_KEY_VALIDATED);

      const failureStats = stats.find(s => s.result === 'FAILURE');
      expect(failureStats.count).toBe(1);
      expect(failureStats.action).toBe(AuditLogService.ACTION.API_KEY_VALIDATION_FAILED);
    });

    it('should filter statistics by category', async () => {
      const stats = await AuditLogService.getStatistics({
        category: AuditLogService.CATEGORY.AUTHENTICATION
      });

      expect(stats).toHaveLength(2);
      expect(stats.every(s => s.category === AuditLogService.CATEGORY.AUTHENTICATION)).toBe(true);
    });
  });

  describe('Constants', () => {
    it('should export SEVERITY constants', () => {
      expect(AuditLogService.SEVERITY).toBeDefined();
      expect(AuditLogService.SEVERITY.HIGH).toBe('HIGH');
      expect(AuditLogService.SEVERITY.MEDIUM).toBe('MEDIUM');
      expect(AuditLogService.SEVERITY.LOW).toBe('LOW');
    });

    it('should export CATEGORY constants', () => {
      expect(AuditLogService.CATEGORY).toBeDefined();
      expect(AuditLogService.CATEGORY.AUTHENTICATION).toBe('AUTHENTICATION');
      expect(AuditLogService.CATEGORY.AUTHORIZATION).toBe('AUTHORIZATION');
      expect(AuditLogService.CATEGORY.API_KEY_MANAGEMENT).toBe('API_KEY_MANAGEMENT');
      expect(AuditLogService.CATEGORY.FINANCIAL_OPERATION).toBe('FINANCIAL_OPERATION');
    });

    it('should export ACTION constants', () => {
      expect(AuditLogService.ACTION).toBeDefined();
      expect(AuditLogService.ACTION.API_KEY_VALIDATED).toBe('API_KEY_VALIDATED');
      expect(AuditLogService.ACTION.API_KEY_VALIDATION_FAILED).toBe('API_KEY_VALIDATION_FAILED');
      expect(AuditLogService.ACTION.PERMISSION_GRANTED).toBe('PERMISSION_GRANTED');
      expect(AuditLogService.ACTION.PERMISSION_DENIED).toBe('PERMISSION_DENIED');
    });
  });
});
