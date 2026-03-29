/**
 * Tests for API Key Audit Log Export
 * 
 * Verifies:
 * - Date range filtering works correctly
 * - JSON and CSV formats both valid
 * - Async export status polling
 * - All required compliance fields present
 */

const AuditLogExportService = require('../../src/services/AuditLogExportService');
const Database = require('../../src/utils/database');

// Mock dependencies
jest.mock('../src/utils/database');
jest.mock('../src/services/AuditLogService', () => ({
  log: jest.fn().mockResolvedValue({}),
  getStatistics: jest.fn().mockResolvedValue([])
}));

describe('API Key Audit Log Export', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock database operations
    Database.get = jest.fn();
    Database.run = jest.fn();
    Database.query = jest.fn();
  });

  describe('EXPORT_STATUS constants', () => {
    test('should have all required status values', () => {
      expect(AuditLogExportService.EXPORT_STATUS.PENDING).toBe('PENDING');
      expect(AuditLogExportService.EXPORT_STATUS.PROCESSING).toBe('PROCESSING');
      expect(AuditLogExportService.EXPORT_STATUS.COMPLETED).toBe('COMPLETED');
      expect(AuditLogExportService.EXPORT_STATUS.FAILED).toBe('FAILED');
    });
  });

  describe('EXPORT_FORMAT constants', () => {
    test('should have all required format values', () => {
      expect(AuditLogExportService.EXPORT_FORMAT.JSON).toBe('json');
      expect(AuditLogExportService.EXPORT_FORMAT.CSV).toBe('csv');
    });
  });

  describe('generateExportId', () => {
    test('should generate unique export IDs', () => {
      const id1 = AuditLogExportService.generateExportId();
      const id2 = AuditLogExportService.generateExportId();

      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
      expect(id1.length).toBe(32); // 16 bytes = 32 hex chars
    });
  });

  describe('countAuditLogs', () => {
    test('should count audit logs when API key', async () => {
      Database.get.mockResolvedValue({ count: 42 });

      const count = await AuditLogExportService.countAuditLogs('api-key-123', {
        startDate: '2024-01-01',
        endDate: '2024-12-31'
      });

      expect(count).toBe(42);
      expect(Database.get).toHaveBeenCalledWith(
        expect.stringContaining('WHERE userId = ?'),
        expect.arrayContaining(['api-key-123', '2024-01-01', '2024-12-31'])
      );
    });

    test('should filter by action', async () => {
      Database.get.mockResolvedValue({ count: 10 });

      await AuditLogExportService.countAuditLogs('api-key-123', {
        action: 'API_KEY_VALIDATED'
      });

      expect(Database.get).toHaveBeenCalledWith(
        expect.stringContaining('AND action = ?'),
        expect.arrayContaining(['API_KEY_VALIDATED'])
      );
    });

    test('should return 0 when no logs found', async () => {
      Database.get.mockResolvedValue(null);

      const count = await AuditLogExportService.countAuditLogs('api-key-123');

      expect(count).toBe(0);
    });
  });

  describe('queryAuditLogs', () => {
    test('should query audit logs when pagination', async () => {
      const mockLogs = [
        {
          id: 1,
          timestamp: '2024-01-15T10:30:00.000Z',
          category: 'AUTHENTICATION',
          action: 'API_KEY_VALIDATED',
          severity: 'LOW',
          result: 'SUCCESS',
          userId: 'api-key-123',
          requestId: 'req-1',
          ipAddress: '127.0.0.1',
          resource: '/api/test',
          reason: null,
          details: '{"key": "value"}'
        }
      ];

      Database.query.mockResolvedValue(mockLogs);

      const logs = await AuditLogExportService.queryAuditLogs('api-key-123', {
        limit: 10,
        offset: 0
      });

      expect(logs).toHaveLength(1);
      expect(logs[0].details).toEqual({ key: 'value' });
    });

    test('should filter by date range', async () => {
      Database.query.mockResolvedValue([]);

      await AuditLogExportService.queryAuditLogs('api-key-123', {
        startDate: '2024-01-01',
        endDate: '2024-12-31'
      });

      expect(Database.query).toHaveBeenCalledWith(
        expect.stringContaining('timestamp >= ?'),
        expect.arrayContaining(['2024-01-01', '2024-12-31'])
      );
    });

    test('should filter by action', async () => {
      Database.query.mockResolvedValue([]);

      await AuditLogExportService.queryAuditLogs('api-key-123', {
        action: 'API_KEY_VALIDATED'
      });

      expect(Database.query).toHaveBeenCalledWith(
        expect.stringContaining('AND action = ?'),
        expect.arrayContaining(['API_KEY_VALIDATED'])
      );
    });
  });

  describe('convertToJSON', () => {
    test('should convert logs to JSON format', () => {
      const logs = [
        {
          id: 1,
          timestamp: '2024-01-15T10:30:00.000Z',
          action: 'API_KEY_VALIDATED'
        }
      ];

      const json = AuditLogExportService.convertToJSON(logs);
      const parsed = JSON.parse(json);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe(1);
      expect(parsed[0].action).toBe('API_KEY_VALIDATED');
    });

    test('should handle empty array', () => {
      const json = AuditLogExportService.convertToJSON([]);
      const parsed = JSON.parse(json);

      expect(parsed).toHaveLength(0);
    });
  });

  describe('convertToCSV', () => {
    test('should convert logs to CSV format', () => {
      const logs = [
        {
          id: 1,
          timestamp: '2024-01-15T10:30:00.000Z',
          category: 'AUTHENTICATION',
          action: 'API_KEY_VALIDATED',
          severity: 'LOW',
          result: 'SUCCESS',
          userId: 'api-key-123',
          requestId: 'req-1',
          ipAddress: '127.0.0.1',
          resource: '/api/test',
          reason: null,
          details: { key: 'value' }
        }
      ];

      const csv = AuditLogExportService.convertToCSV(logs);
      const lines = csv.split('\n');

      expect(lines).toHaveLength(2); // Header + 1 data row
      expect(lines[0]).toContain('id,timestamp,category,action');
      expect(lines[1]).toContain('1,2024-01-15T10:30:00.000Z');
    });

    test('should escape CSV fields when commas', () => {
      const logs = [
        {
          id: 1,
          timestamp: '2024-01-15T10:30:00.000Z',
          category: 'AUTHENTICATION',
          action: 'API_KEY_VALIDATED',
          severity: 'LOW',
          result: 'SUCCESS',
          userId: 'api-key-123',
          requestId: 'req-1',
          ipAddress: '127.0.0.1',
          resource: '/api/test, with comma',
          reason: null,
          details: {}
        }
      ];

      const csv = AuditLogExportService.convertToCSV(logs);
      const lines = csv.split('\n');

      expect(lines[1]).toContain('"/api/test, with comma"');
    });

    test('should handle empty array', () => {
      const csv = AuditLogExportService.convertToCSV([]);

      expect(csv).toBe('');
    });
  });

  describe('createExportRecord', () => {
    test('should create export record in database', async () => {
      Database.run.mockResolvedValue({});

      const record = await AuditLogExportService.createExportRecord(
        'export-123',
        'api-key-123',
        { startDate: '2024-01-01', endDate: '2024-12-31' },
        'json',
        100
      );

      expect(record.exportId).toBe('export-123');
      expect(record.apiKeyId).toBe('api-key-123');
      expect(record.format).toBe('json');
      expect(record.recordCount).toBe(100);
      expect(record.status).toBe('PENDING');

      expect(Database.run).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit_log_exports'),
        expect.arrayContaining(['export-123', 'api-key-123', 'json', 'PENDING', 100])
      );
    });
  });

  describe('updateExportStatus', () => {
    test('should update export status', async () => {
      Database.run.mockResolvedValue({});

      await AuditLogExportService.updateExportStatus('export-123', 'COMPLETED');

      expect(Database.run).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE audit_log_exports'),
        expect.arrayContaining(['COMPLETED', 'export-123'])
      );
    });

    test('should update status when file path', async () => {
      Database.run.mockResolvedValue({});

      await AuditLogExportService.updateExportStatus('export-123', 'COMPLETED', '/path/to/file.json');

      expect(Database.run).toHaveBeenCalledWith(
        expect.stringContaining('file_path = ?'),
        expect.arrayContaining(['/path/to/file.json'])
      );
    });

    test('should update status when error message', async () => {
      Database.run.mockResolvedValue({});

      await AuditLogExportService.updateExportStatus('export-123', 'FAILED', null, 'Export failed');

      expect(Database.run).toHaveBeenCalledWith(
        expect.stringContaining('error_message = ?'),
        expect.arrayContaining(['Export failed'])
      );
    });
  });

  describe('getExportRecord', () => {
    test('should return export record', async () => {
      const mockRecord = {
        export_id: 'export-123',
        api_key_id: 'api-key-123',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        action_filter: null,
        format: 'json',
        status: 'COMPLETED',
        record_count: 100,
        file_path: null,
        error_message: null,
        created_at: '2024-01-15T10:30:00.000Z',
        updated_at: '2024-01-15T10:35:00.000Z'
      };

      Database.get.mockResolvedValue(mockRecord);

      const record = await AuditLogExportService.getExportRecord('export-123');

      expect(record.exportId).toBe('export-123');
      expect(record.apiKeyId).toBe('api-key-123');
      expect(record.status).toBe('COMPLETED');
    });

    test('should return null when not found', async () => {
      Database.get.mockResolvedValue(null);

      const record = await AuditLogExportService.getExportRecord('nonexistent');

      expect(record).toBeNull();
    });
  });

  describe('initiateExport', () => {
    test('should initiate synchronous export when small datasets', async () => {
      Database.get.mockResolvedValue({ count: 100 });
      Database.query.mockResolvedValue([
        {
          id: 1,
          timestamp: '2024-01-15T10:30:00.000Z',
          category: 'AUTHENTICATION',
          action: 'API_KEY_VALIDATED',
          severity: 'LOW',
          result: 'SUCCESS',
          userId: 'api-key-123',
          requestId: 'req-1',
          ipAddress: '127.0.0.1',
          resource: '/api/test',
          reason: null,
          details: '{}'
        }
      ]);
      Database.run.mockResolvedValue({});

      const result = await AuditLogExportService.initiateExport('api-key-123', {
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        format: 'json'
      });

      expect(result.async).toBe(false);
      expect(result.status).toBe('COMPLETED');
      expect(result.recordCount).toBe(100);
      expect(result.content).toBeDefined();
    });

    test('should initiate asynchronous export when large datasets', async () => {
      Database.get.mockResolvedValue({ count: 2000 });
      Database.run.mockResolvedValue({});

      const result = await AuditLogExportService.initiateExport('api-key-123', {
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        format: 'json'
      });

      expect(result.async).toBe(true);
      expect(result.status).toBe('PENDING');
      expect(result.recordCount).toBe(2000);
      expect(result.statusUrl).toBeDefined();
    });

    test('should throw error when invalid format', async () => {
      await expect(
        AuditLogExportService.initiateExport('api-key-123', {
          format: 'xml'
        })
      ).rejects.toThrow('Invalid format');
    });

    test('should throw error when no logs found', async () => {
      Database.get.mockResolvedValue({ count: 0 });

      await expect(
        AuditLogExportService.initiateExport('api-key-123', {
          startDate: '2024-01-01',
          endDate: '2024-12-31'
        })
      ).rejects.toThrow('No audit logs found');
    });

    test('should throw error when invalid date range', async () => {
      await expect(
        AuditLogExportService.initiateExport('api-key-123', {
          startDate: '2024-12-31',
          endDate: '2024-01-01'
        })
      ).rejects.toThrow('Start date must be before end date');
    });
  });

  describe('getExportStatus', () => {
    test('should return export status', async () => {
      const mockRecord = {
        export_id: 'export-123',
        api_key_id: 'api-key-123',
        status: 'COMPLETED',
        record_count: 100,
        format: 'json',
        created_at: '2024-01-15T10:30:00.000Z',
        updated_at: '2024-01-15T10:35:00.000Z',
        error_message: null
      };

      Database.get.mockResolvedValue(mockRecord);

      const status = await AuditLogExportService.getExportStatus('api-key-123', 'export-123');

      expect(status.exportId).toBe('export-123');
      expect(status.status).toBe('COMPLETED');
      expect(status.downloadUrl).toBeDefined();
    });

    test('should throw error when export not found', async () => {
      Database.get.mockResolvedValue(null);

      await expect(
        AuditLogExportService.getExportStatus('api-key-123', 'nonexistent')
      ).rejects.toThrow('Export not found');
    });

    test('should throw error when export belongs to different API key', async () => {
      const mockRecord = {
        export_id: 'export-123',
        api_key_id: 'different-key',
        status: 'COMPLETED'
      };

      Database.get.mockResolvedValue(mockRecord);

      await expect(
        AuditLogExportService.getExportStatus('api-key-123', 'export-123')
      ).rejects.toThrow('Export does not belong to this API key');
    });
  });

  describe('getExports', () => {
    test('should return list of exports', async () => {
      const mockExports = [
        {
          export_id: 'export-1',
          format: 'json',
          status: 'COMPLETED',
          record_count: 100,
          created_at: '2024-01-15T10:30:00.000Z',
          updated_at: '2024-01-15T10:35:00.000Z'
        },
        {
          export_id: 'export-2',
          format: 'csv',
          status: 'PENDING',
          record_count: 200,
          created_at: '2024-01-14T10:30:00.000Z',
          updated_at: '2024-01-14T10:30:00.000Z'
        }
      ];

      Database.query.mockResolvedValue(mockExports);

      const exports = await AuditLogExportService.getExports('api-key-123');

      expect(exports).toHaveLength(2);
      expect(exports[0].exportId).toBe('export-1');
      expect(exports[1].exportId).toBe('export-2');
    });

    test('should support pagination', async () => {
      Database.query.mockResolvedValue([]);

      await AuditLogExportService.getExports('api-key-123', {
        limit: 10,
        offset: 20
      });

      expect(Database.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT ? OFFSET ?'),
        expect.arrayContaining([10, 20])
      );
    });
  });

  describe('initializeTables', () => {
    test('should create export tables', async () => {
      Database.run.mockResolvedValue({});

      await AuditLogExportService.initializeTables();

      expect(Database.run).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS audit_log_exports')
      );
    });
  });

  describe('Compliance fields', () => {
    test('should include all required compliance fields in export', async () => {
      const mockLogs = [
        {
          id: 1,
          timestamp: '2024-01-15T10:30:00.000Z',
          category: 'AUTHENTICATION',
          action: 'API_KEY_VALIDATED',
          severity: 'LOW',
          result: 'SUCCESS',
          userId: 'api-key-123',
          requestId: 'req-1',
          ipAddress: '127.0.0.1',
          resource: '/api/test',
          reason: null,
          details: '{}'
        }
      ];

      Database.query.mockResolvedValue(mockLogs);

      const logs = await AuditLogExportService.queryAuditLogs('api-key-123');

      // Verify all required compliance fields are present
      expect(logs[0].timestamp).toBeDefined();
      expect(logs[0].action).toBeDefined();
      expect(logs[0].resource).toBeDefined();
      expect(logs[0].ipAddress).toBeDefined();
      expect(logs[0].result).toBeDefined();
    });
  });

  describe('CSV format validation', () => {
    test('should produce valid CSV when all fields', () => {
      const logs = [
        {
          id: 1,
          timestamp: '2024-01-15T10:30:00.000Z',
          category: 'AUTHENTICATION',
          action: 'API_KEY_VALIDATED',
          severity: 'LOW',
          result: 'SUCCESS',
          userId: 'api-key-123',
          requestId: 'req-1',
          ipAddress: '127.0.0.1',
          resource: '/api/test',
          reason: null,
          details: { key: 'value' }
        }
      ];

      const csv = AuditLogExportService.convertToCSV(logs);
      const lines = csv.split('\n');

      // Verify header
      const headers = lines[0].split(',');
      expect(headers).toContain('id');
      expect(headers).toContain('timestamp');
      expect(headers).toContain('action');
      expect(headers).toContain('ipAddress');
      expect(headers).toContain('result');

      // Verify data row
      const dataRow = lines[1].split(',');
      expect(dataRow[0]).toBe('1');
      expect(dataRow[1]).toBe('2024-01-15T10:30:00.000Z');
    });
  });

  describe('JSON format validation', () => {
    test('should produce valid JSON when all fields', () => {
      const logs = [
        {
          id: 1,
          timestamp: '2024-01-15T10:30:00.000Z',
          category: 'AUTHENTICATION',
          action: 'API_KEY_VALIDATED',
          severity: 'LOW',
          result: 'SUCCESS',
          userId: 'api-key-123',
          requestId: 'req-1',
          ipAddress: '127.0.0.1',
          resource: '/api/test',
          reason: null,
          details: { key: 'value' }
        }
      ];

      const json = AuditLogExportService.convertToJSON(logs);
      const parsed = JSON.parse(json);

      // Verify all required fields
      expect(parsed[0].id).toBeDefined();
      expect(parsed[0].timestamp).toBeDefined();
      expect(parsed[0].action).toBeDefined();
      expect(parsed[0].resource).toBeDefined();
      expect(parsed[0].ipAddress).toBeDefined();
      expect(parsed[0].result).toBeDefined();
    });
  });
});
