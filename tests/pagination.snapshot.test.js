/**
 * Test suite for pagination snapshot functionality
 * Tests the snapshotAt parameter for consistent pagination
 */

const {
  validateSnapshotAt,
  parseCursorPaginationQuery,
  buildCursorWhereClause,
  buildCursorMeta,
} = require('../utils/pagination');
const { ValidationError } = require('../utils/errors');

describe('Pagination Snapshot Tests', () => {
  describe('validateSnapshotAt', () => {
    test('should return null for undefined snapshotAt', () => {
      expect(validateSnapshotAt(undefined)).toBeNull();
    });

    test('should return null for null snapshotAt', () => {
      expect(validateSnapshotAt(null)).toBeNull();
    });

    test('should return null for empty string', () => {
      expect(validateSnapshotAt('')).toBeNull();
    });

    test('should parse valid ISO-8601 timestamp', () => {
      const input = '2026-03-26T05:00:00.000Z';
      const result = validateSnapshotAt(input);
      expect(result).toBe('2026-03-26T05:00:00.000Z');
    });

    test('should normalize timestamp to ISO-8601', () => {
      const input = '2026-03-26T05:00:00Z';
      const result = validateSnapshotAt(input);
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    test('should throw ValidationError for invalid timestamp', () => {
      expect(() => validateSnapshotAt('invalid-date')).toThrow(ValidationError);
    });

    test('should throw ValidationError for non-string input', () => {
      expect(() => validateSnapshotAt(12345)).toThrow(ValidationError);
    });

    test('should throw ValidationError for object input', () => {
      expect(() => validateSnapshotAt({ date: '2026-03-26T05:00:00Z' })).toThrow(ValidationError);
    });
  });

  describe('parseCursorPaginationQuery with snapshotAt', () => {
    test('should parse snapshotAt parameter', () => {
      const query = {
        limit: 20,
        snapshotAt: '2026-03-26T05:00:00.000Z',
      };

      const result = parseCursorPaginationQuery(query);

      expect(result).toHaveProperty('snapshotAt', '2026-03-26T05:00:00.000Z');
      expect(result).toHaveProperty('limit', 20);
      expect(result).toHaveProperty('direction', 'next');
      expect(result).toHaveProperty('cursor', null);
    });

    test('should handle missing snapshotAt parameter', () => {
      const query = {
        limit: 20,
      };

      const result = parseCursorPaginationQuery(query);

      expect(result).toHaveProperty('snapshotAt', null);
    });

    test('should throw error for invalid snapshotAt', () => {
      const query = {
        limit: 20,
        snapshotAt: 'not-a-date',
      };

      expect(() => parseCursorPaginationQuery(query)).toThrow(ValidationError);
    });

    test('should parse all parameters together', () => {
      const query = {
        limit: 50,
        cursor: 'eyJ0aW1lc3RhbXAiOiIyMDI2LTAzLTI2VDA1OjAwOjAwLjAwMFoiLCJpZCI6IjEwMCJ9',
        direction: 'next',
        snapshotAt: '2026-03-26T05:00:00.000Z',
      };

      const result = parseCursorPaginationQuery(query);

      expect(result.limit).toBe(50);
      expect(result.direction).toBe('next');
      expect(result.snapshotAt).toBe('2026-03-26T05:00:00.000Z');
      expect(result.cursor).toBeDefined();
      expect(result.cursor.id).toBe('100');
    });
  });

  describe('buildCursorWhereClause with snapshotAt', () => {
    test('should add snapshot filter to WHERE clause', () => {
      const options = {
        cursor: null,
        direction: 'next',
        timestampColumn: 'createdAt',
        snapshotAt: '2026-03-26T05:00:00.000Z',
      };

      const result = buildCursorWhereClause(options);

      expect(result.clause).toContain('AND (createdAt < ?)');
      expect(result.params).toContain('2026-03-26T05:00:00.000Z');
    });

    test('should combine snapshot filter and cursor filter', () => {
      const options = {
        cursor: {
          timestamp: '2026-03-26T04:00:00.000Z',
          id: '100',
        },
        direction: 'next',
        timestampColumn: 'createdAt',
        idColumn: 'id',
        snapshotAt: '2026-03-26T05:00:00.000Z',
      };

      const result = buildCursorWhereClause(options);

      // Should have both snapshot and cursor filters
      expect(result.clause).toContain('AND (createdAt < ?)'); // Snapshot
      expect(result.clause).toContain('AND ((createdAt < ?)'); // Cursor
      
      // First param should be snapshot, rest should be cursor params
      expect(result.params[0]).toBe('2026-03-26T05:00:00.000Z'); // snapshotAt
      expect(result.params[1]).toBe('2026-03-26T04:00:00.000Z'); // cursor.timestamp
    });

    test('should work without snapshotAt parameter', () => {
      const options = {
        cursor: {
          timestamp: '2026-03-26T04:00:00.000Z',
          id: '100',
        },
        direction: 'next',
        timestampColumn: 'createdAt',
        snapshotAt: null,
      };

      const result = buildCursorWhereClause(options);

      expect(result.clause).not.toContain('AND (createdAt < ?)');
      expect(result.clause).toContain('AND ((createdAt < ?)');
      expect(result.params).not.toContain('2026-03-26T05:00:00.000Z');
    });

    test('should apply correct cursor direction with snapshot', () => {
      // Test 'prev' direction
      const prevOptions = {
        cursor: {
          timestamp: '2026-03-26T04:00:00.000Z',
          id: '100',
        },
        direction: 'prev',
        timestampColumn: 'createdAt',
        snapshotAt: '2026-03-26T05:00:00.000Z',
      };

      const prevResult = buildCursorWhereClause(prevOptions);
      expect(prevResult.clause).toContain('AND ((createdAt > ?)'); // Backward direction

      // Test 'next' direction
      const nextOptions = { ...prevOptions, direction: 'next' };
      const nextResult = buildCursorWhereClause(nextOptions);
      expect(nextResult.clause).toContain('AND ((createdAt < ?)'); // Forward direction
    });
  });

  describe('buildCursorMeta with snapshotAt', () => {
    test('should include snapshotAt in response metadata', () => {
      const options = {
        items: [
          { id: 1, createdAt: '2026-03-26T04:00:00.000Z' },
          { id: 2, createdAt: '2026-03-26T03:00:00.000Z' },
        ],
        limit: 20,
        direction: 'next',
        hasMore: true,
        hasCursor: false,
        timestampField: 'createdAt',
        snapshotAt: '2026-03-26T05:00:00.000Z',
      };

      const result = buildCursorMeta(options);

      expect(result).toHaveProperty('snapshotAt', '2026-03-26T05:00:00.000Z');
      expect(result).toHaveProperty('limit', 20);
      expect(result).toHaveProperty('direction', 'next');
    });

    test('should handle null snapshotAt in metadata', () => {
      const options = {
        items: [{ id: 1, createdAt: '2026-03-26T04:00:00.000Z' }],
        limit: 20,
        direction: 'next',
        hasMore: false,
        hasCursor: false,
        timestampField: 'createdAt',
        snapshotAt: null,
      };

      const result = buildCursorMeta(options);

      expect(result).toHaveProperty('snapshotAt', null);
    });
  });

  describe('Snapshot Pagination Scenario', () => {
    test('should handle concurrent insert scenario with snapshot', () => {
      // Simulate: Client starts pagination at T0 with snapshot
      const snapshotTime = '2026-03-26T05:00:00.000Z';
      
      // First page
      const firstPageQuery = {
        limit: 10,
        snapshotAt: snapshotTime,
      };

      const firstPageParsed = parseCursorPaginationQuery(firstPageQuery);
      expect(firstPageParsed.snapshotAt).toBe(snapshotTime);

      // Simulate cursor from first page
      const firstPageCursor = {
        timestamp: '2026-03-26T04:50:00.000Z',
        id: '50',
      };

      // Now a new record is inserted with timestamp T0.5 (after snapshotTime)
      // Second page with cursor
      const secondPageQuery = {
        limit: 10,
        cursor: 'eyJ0aW1lc3RhbXAiOiIyMDI2LTAzLTI2VDA0OjUwOjAwLjAwMFoiLCJpZCI6IjUwIn0',
        snapshotAt: snapshotTime,
      };

      const secondPageParsed = parseCursorPaginationQuery(secondPageQuery);
      
      // Build WHERE clause for second page
      const whereClause = buildCursorWhereClause({
        cursor: secondPageParsed.cursor,
        direction: secondPageParsed.direction,
        timestampColumn: 'createdAt',
        snapshotAt: secondPageParsed.snapshotAt,
      });

      // Verify: snapshot filter ensures newly inserted record is NOT included
      // (if record has timestamp >= snapshotTime, it's filtered out)
      expect(whereClause.clause).toContain('AND (createdAt < ?)');
      expect(whereClause.params[0]).toBe(snapshotTime);
    });

    test('should allow processing new records after snapshot', () => {
      const firstSnapshot = '2026-03-26T05:00:00.000Z';
      const secondSnapshot = '2026-03-26T05:30:00.000Z';

      const firstSession = parseCursorPaginationQuery({
        limit: 50,
        snapshotAt: firstSnapshot,
      });

      const secondSession = parseCursorPaginationQuery({
        limit: 50,
        snapshotAt: secondSnapshot,
      });

      // Both snapshots should be different but valid
      expect(firstSession.snapshotAt).toBe(firstSnapshot);
      expect(secondSession.snapshotAt).toBe(secondSnapshot);
      expect(firstSession.snapshotAt).not.toBe(secondSession.snapshotAt);

      // Second snapshot is "newer" (later in time)
      expect(new Date(secondSession.snapshotAt).getTime()).toBeGreaterThan(
        new Date(firstSession.snapshotAt).getTime()
      );
    });
  });
});
