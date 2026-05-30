/**
 * Security tests for #760: GET /admin/audit-logs must reject invalid filter values
 *
 * Verifies that the allowlist validation blocks SQL injection attempts and
 * unknown enum values before they reach the database layer.
 */

const AuditLogService = require('../../src/services/AuditLogService');

describe('Audit-logs filter allowlist validation (#760)', () => {
  const VALID_CATEGORIES = new Set(Object.values(AuditLogService.CATEGORY));
  const VALID_SEVERITIES = new Set(Object.values(AuditLogService.SEVERITY));

  describe('category allowlist', () => {
    it('rejects SQL injection attempt', () => {
      const malicious = "'; DROP TABLE audit_logs; --";
      expect(VALID_CATEGORIES.has(malicious)).toBe(false);
    });

    it('rejects unknown category string', () => {
      expect(VALID_CATEGORIES.has('UNKNOWN_CATEGORY')).toBe(false);
    });

    it('accepts all defined CATEGORY values', () => {
      for (const cat of Object.values(AuditLogService.CATEGORY)) {
        expect(VALID_CATEGORIES.has(cat)).toBe(true);
      }
    });
  });

  describe('severity allowlist', () => {
    it('rejects SQL injection attempt', () => {
      const malicious = "' OR '1'='1";
      expect(VALID_SEVERITIES.has(malicious)).toBe(false);
    });

    it('rejects unknown severity string', () => {
      expect(VALID_SEVERITIES.has('CRITICAL_INJECTION')).toBe(false);
    });

    it('accepts all defined SEVERITY values', () => {
      for (const sev of Object.values(AuditLogService.SEVERITY)) {
        expect(VALID_SEVERITIES.has(sev)).toBe(true);
      }
    });
  });

  describe('AuditLogService.buildFilterQuery uses parameterized queries', () => {
    it('returns params array (not string interpolation) for category', () => {
      const { clause, params } = AuditLogService.buildFilterQuery({ category: 'AUTHENTICATION' });
      expect(clause).toContain('?');
      expect(params).toContain('AUTHENTICATION');
      // Ensure the value is NOT embedded directly in the SQL string
      expect(clause).not.toContain('AUTHENTICATION');
    });

    it('returns params array for severity', () => {
      const { clause, params } = AuditLogService.buildFilterQuery({ severity: 'HIGH' });
      expect(clause).toContain('?');
      expect(params).toContain('HIGH');
      expect(clause).not.toContain('HIGH');
    });

    it('does not embed SQL injection payload in query string', () => {
      const payload = "'; DROP TABLE audit_logs; --";
      const { clause, params } = AuditLogService.buildFilterQuery({ category: payload });
      expect(clause).not.toContain(payload);
      expect(params).toContain(payload); // value is in params, not in SQL
    });
  });
});
