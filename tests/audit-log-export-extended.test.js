'use strict';
/**
 * Tests for Issue #604: Audit log export with date range filtering and signed download URLs
 */
process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'admin-key';

const AuditLogExportService = require('../src/services/AuditLogExportService');
const Database = require('../src/utils/database');

// Mock database
jest.mock('../src/utils/database');
jest.mock('../src/services/AuditLogService', () => ({
  log: jest.fn().mockResolvedValue({}),
  getStatistics: jest.fn().mockResolvedValue([])
}));

const SAMPLE_LOGS = [
  { id: 1, timestamp: '2025-01-01T00:00:00Z', category: 'AUTH', action: 'LOGIN', severity: 'LOW', result: 'SUCCESS', userId: 'u1', requestId: 'r1', ipAddress: '1.2.3.4', resource: '/auth', reason: '', details: {} },
  { id: 2, timestamp: '2025-01-02T00:00:00Z', category: 'DATA', action: 'EXPORT', severity: 'MEDIUM', result: 'SUCCESS', userId: 'u1', requestId: 'r2', ipAddress: '1.2.3.4', resource: '/export', reason: '', details: {} },
];

describe('AuditLogExportService - Issue #604', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Database.get = jest.fn();
    Database.run = jest.fn().mockResolvedValue({});
    Database.query = jest.fn().mockResolvedValue(SAMPLE_LOGS.map(l => ({ ...l, details: JSON.stringify(l.details) })));
  });

  // ── Constants ─────────────────────────────────────────────────────────────

  describe('constants', () => {
    it('EXPORT_STATUS has all required values', () => {
      expect(AuditLogExportService.EXPORT_STATUS.PENDING).toBe('PENDING');
      expect(AuditLogExportService.EXPORT_STATUS.PROCESSING).toBe('PROCESSING');
      expect(AuditLogExportService.EXPORT_STATUS.COMPLETED).toBe('COMPLETED');
      expect(AuditLogExportService.EXPORT_STATUS.FAILED).toBe('FAILED');
    });

    it('EXPORT_FORMAT has json and csv', () => {
      expect(AuditLogExportService.EXPORT_FORMAT.JSON).toBe('json');
      expect(AuditLogExportService.EXPORT_FORMAT.CSV).toBe('csv');
    });
  });

  // ── generateExportId ──────────────────────────────────────────────────────

  describe('generateExportId', () => {
    it('generates unique 32-char hex IDs', () => {
      const id1 = AuditLogExportService.generateExportId();
      const id2 = AuditLogExportService.generateExportId();
      expect(id1).toHaveLength(32);
      expect(id1).not.toBe(id2);
    });
  });

  // ── countAuditLogs ────────────────────────────────────────────────────────

  describe('countAuditLogs', () => {
    it('returns count from database', async () => {
      Database.get.mockResolvedValue({ count: 42 });
      const count = await AuditLogExportService.countAuditLogs('key-1', {
        startDate: '2025-01-01', endDate: '2025-12-31'
      });
      expect(count).toBe(42);
    });

    it('filters by eventType/action', async () => {
      Database.get.mockResolvedValue({ count: 5 });
      await AuditLogExportService.countAuditLogs('key-1', { action: 'LOGIN' });
      expect(Database.get).toHaveBeenCalledWith(
        expect.stringContaining('action = ?'),
        expect.arrayContaining(['LOGIN'])
      );
    });

    it('returns 0 when no rows', async () => {
      Database.get.mockResolvedValue(null);
      const count = await AuditLogExportService.countAuditLogs('key-1', {});
      expect(count).toBe(0);
    });
  });

  // ── convertToCSV ──────────────────────────────────────────────────────────

  describe('convertToCSV', () => {
    it('returns empty string for empty array', () => {
      expect(AuditLogExportService.convertToCSV([])).toBe('');
    });

    it('includes header row', () => {
      const csv = AuditLogExportService.convertToCSV(SAMPLE_LOGS);
      expect(csv).toContain('id,timestamp,category');
    });

    it('includes data rows', () => {
      const csv = AuditLogExportService.convertToCSV(SAMPLE_LOGS);
      expect(csv).toContain('LOGIN');
      expect(csv).toContain('EXPORT');
    });

    it('escapes commas in fields', () => {
      const logs = [{ ...SAMPLE_LOGS[0], reason: 'a,b,c', details: {} }];
      const csv = AuditLogExportService.convertToCSV(logs);
      expect(csv).toContain('"a,b,c"');
    });
  });

  // ── convertToJSON ─────────────────────────────────────────────────────────

  describe('convertToJSON', () => {
    it('returns valid JSON string', () => {
      const json = AuditLogExportService.convertToJSON(SAMPLE_LOGS);
      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('contains all records', () => {
      const parsed = JSON.parse(AuditLogExportService.convertToJSON(SAMPLE_LOGS));
      expect(parsed).toHaveLength(2);
    });
  });

  // ── queueExportJob ────────────────────────────────────────────────────────

  describe('queueExportJob', () => {
    it('returns jobId and PENDING status immediately', async () => {
      const result = await AuditLogExportService.queueExportJob('admin', {
        startDate: '2025-01-01', endDate: '2025-12-31', format: 'json'
      });
      expect(result.jobId).toBeDefined();
      expect(result.status).toBe('PENDING');
    });

    it('inserts a record into the database', async () => {
      await AuditLogExportService.queueExportJob('admin', { format: 'csv' });
      expect(Database.run).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit_log_exports'),
        expect.any(Array)
      );
    });

    it('throws on invalid format', async () => {
      await expect(
        AuditLogExportService.queueExportJob('admin', { format: 'xml' })
      ).rejects.toThrow(/Invalid format/);
    });

    it('accepts eventType filter', async () => {
      const result = await AuditLogExportService.queueExportJob('admin', {
        eventType: 'LOGIN', format: 'json'
      });
      expect(result.jobId).toBeDefined();
    });
  });

  // ── getJobStatus ──────────────────────────────────────────────────────────

  describe('getJobStatus', () => {
    it('returns status for existing job', async () => {
      Database.get.mockResolvedValue({
        export_id: 'abc123', status: 'COMPLETED', record_count: 10,
        format: 'json', created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:01:00Z', error_message: null
      });
      const status = await AuditLogExportService.getJobStatus('abc123');
      expect(status.jobId).toBe('abc123');
      expect(status.status).toBe('COMPLETED');
      expect(status.recordCount).toBe(10);
    });

    it('throws NotFoundError for unknown job', async () => {
      Database.get.mockResolvedValue(null);
      await expect(AuditLogExportService.getJobStatus('nope')).rejects.toThrow(/not found/i);
    });
  });

  // ── getSignedDownloadUrl ──────────────────────────────────────────────────

  describe('getSignedDownloadUrl', () => {
    it('returns pending=true when job is not complete', async () => {
      Database.get.mockResolvedValue({
        export_id: 'job1', status: 'PROCESSING', format: 'json',
        signed_url: null, signed_url_expires_at: null, record_count: 0
      });
      const result = await AuditLogExportService.getSignedDownloadUrl('job1');
      expect(result.pending).toBe(true);
      expect(result.status).toBe('PROCESSING');
    });

    it('returns signedUrl for completed job', async () => {
      const future = new Date(Date.now() + 3600000).toISOString();
      Database.get.mockResolvedValue({
        export_id: 'job2', status: 'COMPLETED', format: 'json',
        signed_url: '/admin/audit-logs/export/job2/download?token=abc',
        signed_url_expires_at: future, record_count: 5
      });
      const result = await AuditLogExportService.getSignedDownloadUrl('job2');
      expect(result.signedUrl).toContain('/download');
      expect(result.expiresAt).toBe(future);
    });

    it('regenerates expired signed URL', async () => {
      const past = new Date(Date.now() - 1000).toISOString();
      Database.get.mockResolvedValue({
        export_id: 'job3', status: 'COMPLETED', format: 'json',
        signed_url: '/old-url', signed_url_expires_at: past, record_count: 3
      });
      const result = await AuditLogExportService.getSignedDownloadUrl('job3');
      expect(result.signedUrl).not.toBe('/old-url');
      expect(new Date(result.expiresAt) > new Date()).toBe(true);
    });

    it('throws NotFoundError for unknown job', async () => {
      Database.get.mockResolvedValue(null);
      await expect(AuditLogExportService.getSignedDownloadUrl('nope')).rejects.toThrow(/not found/i);
    });
  });

  // ── Date range filtering ──────────────────────────────────────────────────

  describe('Date range filtering in queryAuditLogs', () => {
    it('applies startDate and endDate filters', async () => {
      await AuditLogExportService.queryAuditLogs('key-1', {
        startDate: '2025-01-01', endDate: '2025-06-30'
      });
      expect(Database.query).toHaveBeenCalledWith(
        expect.stringContaining('timestamp >= ?'),
        expect.arrayContaining(['2025-01-01', '2025-06-30'])
      );
    });

    it('applies action/eventType filter', async () => {
      await AuditLogExportService.queryAuditLogs('key-1', { action: 'LOGIN' });
      expect(Database.query).toHaveBeenCalledWith(
        expect.stringContaining('action = ?'),
        expect.arrayContaining(['LOGIN'])
      );
    });
  });

  // ── initializeTables ──────────────────────────────────────────────────────

  describe('initializeTables', () => {
    it('creates audit_log_exports table with signed_url columns', async () => {
      await AuditLogExportService.initializeTables();
      expect(Database.run).toHaveBeenCalledWith(
        expect.stringContaining('signed_url')
      );
    });
  });
});
