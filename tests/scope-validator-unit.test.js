/**
 * Scope Validator Unit Tests
 * Tests fine-grained API key scope functionality in isolation
 * No external dependencies required - pure unit tests
 */

const scopeValidator = require('../src/utils/scopeValidator');

describe('Scope Validator Unit Tests', () => {
  describe('validateScopes', () => {
    it('should accept valid scope array', () => {
      const result = scopeValidator.validateScopes(['donations:read', 'stats:read']);
      expect(result.valid).toBe(true);
      expect(result.scopes).toEqual(['donations:read', 'stats:read']);
      expect(result.errors.length).toBe(0);
    });

    it('should accept empty scope array', () => {
      const result = scopeValidator.validateScopes([]);
      expect(result.valid).toBe(true);
      expect(result.scopes).toEqual([]);
    });

    it('should reject non-array input', () => {
      const result = scopeValidator.validateScopes('not-an-array');
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('array');
    });

    it('should reject invalid scope strings', () => {
      const result = scopeValidator.validateScopes(['invalid:scope']);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Invalid scope');
    });

    it('should detect duplicate scopes', () => {
      const result = scopeValidator.validateScopes(['donations:read', 'donations:read']);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Duplicate');
    });

    it('should trim whitespace from scopes', () => {
      const result = scopeValidator.validateScopes(['  donations:read  ', 'stats:read']);
      expect(result.valid).toBe(true);
      expect(result.scopes).toEqual(['donations:read', 'stats:read']);
    });

    it('should reject empty string scopes', () => {
      const result = scopeValidator.validateScopes(['', 'donations:read']);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('empty');
    });

    it('should reject non-string scope items', () => {
      const result = scopeValidator.validateScopes([123, 'donations:read']);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('string');
    });

    it('should handle mixed valid and invalid scopes', () => {
      const result = scopeValidator.validateScopes([
        'donations:read',
        'invalid:scope',
        'stats:read'
      ]);
      expect(result.valid).toBe(false);
      expect(result.scopes.length).toBe(2);
    });
  });

  describe('isValidScope', () => {
    it('should accept known scopes', () => {
      expect(scopeValidator.isValidScope('donations:read')).toBe(true);
      expect(scopeValidator.isValidScope('stats:read')).toBe(true);
      expect(scopeValidator.isValidScope('admin:*')).toBe(true);
    });

    it('should reject unknown scopes', () => {
      expect(scopeValidator.isValidScope('unknown:scope')).toBe(false);
      expect(scopeValidator.isValidScope('invalid')).toBe(false);
    });

    it('should reject non-string input', () => {
      expect(scopeValidator.isValidScope(123)).toBe(false);
      expect(scopeValidator.isValidScope(null)).toBe(false);
    });
  });

  describe('hasScope', () => {
    it('should find exact scope match', () => {
      const scopes = ['donations:read', 'stats:read'];
      expect(scopeValidator.hasScope(scopes, 'donations:read')).toBe(true);
      expect(scopeValidator.hasScope(scopes, 'stats:read')).toBe(true);
    });

    it('should not match non-existent scopes', () => {
      const scopes = ['donations:read', 'stats:read'];
      expect(scopeValidator.hasScope(scopes, 'donations:create')).toBe(false);
    });

    it('should handle wildcard resource scope', () => {
      const scopes = ['donations:*'];
      expect(scopeValidator.hasScope(scopes, 'donations:read')).toBe(true);
      expect(scopeValidator.hasScope(scopes, 'donations:create')).toBe(true);
    });

    it('should grant all permissions with admin wildcard', () => {
      const scopes = ['admin:*'];
      expect(scopeValidator.hasScope(scopes, 'donations:read')).toBe(true);
      expect(scopeValidator.hasScope(scopes, 'stats:export')).toBe(true);
    });

    it('should handle empty scope array', () => {
      expect(scopeValidator.hasScope([], 'donations:read')).toBe(false);
    });

    it('should reject invalid input', () => {
      expect(scopeValidator.hasScope('not-array', 'donations:read')).toBe(false);
      expect(scopeValidator.hasScope(null, 'donations:read')).toBe(false);
    });
  });

  describe('hasAllScopes', () => {
    it('should verify all required scopes are present', () => {
      const scopes = ['donations:read', 'donations:create', 'stats:read'];
      const required = ['donations:read', 'donations:create'];
      expect(scopeValidator.hasAllScopes(scopes, required)).toBe(true);
    });

    it('should fail if any required scope is missing', () => {
      const scopes = ['donations:read', 'stats:read'];
      const required = ['donations:read', 'donations:create'];
      expect(scopeValidator.hasAllScopes(scopes, required)).toBe(false);
    });

    it('should use wildcard for matching', () => {
      const scopes = ['donations:*', 'stats:read'];
      const required = ['donations:read', 'donations:create', 'stats:read'];
      expect(scopeValidator.hasAllScopes(scopes, required)).toBe(true);
    });

    it('should return true for empty required scopes', () => {
      expect(scopeValidator.hasAllScopes(['donations:read'], [])).toBe(true);
    });

    it('should handle admin wildcard', () => {
      const scopes = ['admin:*'];
      const required = ['donations:read', 'stats:export'];
      expect(scopeValidator.hasAllScopes(scopes, required)).toBe(true);
    });
  });

  describe('hasAnyScope', () => {
    it('should succeed if any required scope matches', () => {
      const scopes = ['donations:read', 'stats:read'];
      const required = ['donations:create', 'donations:read'];
      expect(scopeValidator.hasAnyScope(scopes, required)).toBe(true);
    });

    it('should fail if no required scopes match', () => {
      const scopes = ['donations:read'];
      const required = ['stats:export', 'wallets:create'];
      expect(scopeValidator.hasAnyScope(scopes, required)).toBe(false);
    });

    it('should use wildcard for matching', () => {
      const scopes = ['donations:*'];
      const required = ['stats:read', 'donations:create'];
      expect(scopeValidator.hasAnyScope(scopes, required)).toBe(true);
    });

    it('should return true for empty required scopes', () => {
      expect(scopeValidator.hasAnyScope(['donations:read'], [])).toBe(true);
    });

    it('should handle admin wildcard', () => {
      const scopes = ['admin:*'];
      const required = ['stats:read', 'wallets:create'];
      expect(scopeValidator.hasAnyScope(scopes, required)).toBe(true);
    });
  });

  describe('getAllScopes', () => {
    it('should return array of all valid scopes', () => {
      const allScopes = scopeValidator.getAllScopes();
      expect(Array.isArray(allScopes)).toBe(true);
      expect(allScopes.length > 0).toBe(true);
    });

    it('should include common donation scopes', () => {
      const allScopes = scopeValidator.getAllScopes();
      expect(allScopes).toContain('donations:read');
      expect(allScopes).toContain('donations:create');
    });

    it('should include stats scopes', () => {
      const allScopes = scopeValidator.getAllScopes();
      expect(allScopes).toContain('stats:read');
    });

    it('should include admin scope', () => {
      const allScopes = scopeValidator.getAllScopes();
      expect(allScopes).toContain('admin:*');
    });

    it('should include wallet scopes', () => {
      const allScopes = scopeValidator.getAllScopes();
      expect(allScopes.some(s => s.startsWith('wallets:'))).toBe(true);
    });

    it('should include transaction scopes', () => {
      const allScopes = scopeValidator.getAllScopes();
      expect(allScopes.some(s => s.startsWith('transactions:'))).toBe(true);
    });
  });

  describe('getScopesByResource', () => {
    it('should return scopes for specific resource', () => {
      const donationScopes = scopeValidator.getScopesByResource('donations');
      expect(donationScopes.length > 0).toBe(true);
      expect(donationScopes.every(s => s.startsWith('donations:'))).toBe(true);
    });

    it('should return scopes for wallets resource', () => {
      const walletScopes = scopeValidator.getScopesByResource('wallets');
      expect(walletScopes.length > 0).toBe(true);
      expect(walletScopes.every(s => s.startsWith('wallets:'))).toBe(true);
    });

    it('should return scopes for stats resource', () => {
      const statsScopes = scopeValidator.getScopesByResource('stats');
      expect(statsScopes.length > 0).toBe(true);
      expect(statsScopes.every(s => s.startsWith('stats:'))).toBe(true);
    });

    it('should return empty array for unknown resource', () => {
      const scopes = scopeValidator.getScopesByResource('unknown');
      expect(scopes).toEqual([]);
    });

    it('should handle null or undefined input', () => {
      expect(scopeValidator.getScopesByResource(null)).toEqual([]);
      expect(scopeValidator.getScopesByResource(undefined)).toEqual([]);
    });
  });

  describe('Scope Permission Logic', () => {
    it('should implement least-privilege principle', () => {
      // Limited scope should not have wildcard permissions
      const limitedScopes = ['donations:read'];
      expect(scopeValidator.hasScope(limitedScopes, 'donations:create')).toBe(false);
      expect(scopeValidator.hasScope(limitedScopes, 'donations:delete')).toBe(false);
    });

    it('should enforce resource-level restrictions', () => {
      const statsScopes = ['stats:read', 'stats:export'];
      expect(scopeValidator.hasScope(statsScopes, 'donations:read')).toBe(false);
      expect(scopeValidator.hasScope(statsScopes, 'wallets:read')).toBe(false);
    });

    it('should support cascading wildcard matching', () => {
      // Wildcard at resource level matches all actions
      const wildcard = ['donations:*'];
      expect(scopeValidator.hasScope(wildcard, 'donations:create')).toBe(true);
      expect(scopeValidator.hasScope(wildcard, 'donations:verify')).toBe(true);
      expect(scopeValidator.hasScope(wildcard, 'wallets:read')).toBe(false);
    });

    it('should prioritize admin wildcard', () => {
      const adminScopes = ['admin:*'];
      // Admin should have access to everything
      expect(scopeValidator.hasScope(adminScopes, 'donations:create')).toBe(true);
      expect(scopeValidator.hasScope(adminScopes, 'stats:export')).toBe(true);
      expect(scopeValidator.hasScope(adminScopes, 'apikeys:revoke')).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long scope lists', () => {
      const longScopes = Array(50).fill('donations:read');
      const result = scopeValidator.validateScopes(longScopes);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Duplicate'))).toBe(true);
    });

    it('should handle mixed case in scope names', () => {
      // Scope matching is case-sensitive
      expect(scopeValidator.hasScope(['donations:read'], 'Donations:Read')).toBe(false);
      expect(scopeValidator.hasScope(['donations:read'], 'donations:read')).toBe(true);
    });

    it('should handle scopes with underscores', () => {
      const result = scopeValidator.validateScopes(['api_keys:create']);
      // api_keys is not a valid resource, should fail
      expect(result.valid).toBe(false);
    });

    it('should require colon in scope format', () => {
      const result = scopeValidator.validateScopes(['donationsread']);
      expect(result.valid).toBe(false);
    });

    it('should handle null and undefined in scope arrays', () => {
      const result = scopeValidator.validateScopes([null, undefined, 'donations:read']);
      expect(result.valid).toBe(false);
    });
  });

  describe('Real-World Scenarios', () => {
    it('should support read-only integration key', () => {
      const readOnlyScopes = ['donations:read', 'stats:read', 'wallets:read'];
      
      // Should allow reads
      expect(scopeValidator.hasScope(readOnlyScopes, 'donations:read')).toBe(true);
      expect(scopeValidator.hasScope(readOnlyScopes, 'stats:read')).toBe(true);
      
      // Should deny writes
      expect(scopeValidator.hasScope(readOnlyScopes, 'donations:create')).toBe(false);
      expect(scopeValidator.hasScope(readOnlyScopes, 'wallets:update')).toBe(false);
    });

    it('should support payment processor key', () => {
      const processorScopes = [
        'donations:create',
        'donations:verify',
        'transactions:read',
        'wallets:read'
      ];
      
      expect(scopeValidator.hasAllScopes(processorScopes, [
        'donations:create',
        'transactions:read'
      ])).toBe(true);
      
      expect(scopeValidator.hasScope(processorScopes, 'donations:delete')).toBe(false);
    });

    it('should support analytics service key', () => {
      const analyticsScopes = ['stats:read', 'stats:export', 'transactions:read'];
      
      expect(scopeValidator.hasAllScopes(analyticsScopes, [
        'stats:read',
        'stats:export'
      ])).toBe(true);
      
      expect(scopeValidator.hasScope(analyticsScopes, 'donations:create')).toBe(false);
    });

    it('should support admin key with full access', () => {
      const adminScopes = ['admin:*'];
      
      // Should have access to everything
      const operations = [
        'donations:create',
        'donations:delete',
        'wallets:update',
        'apikeys:revoke',
        'stats:export'
      ];
      
      operations.forEach(op => {
        expect(scopeValidator.hasScope(adminScopes, op)).toBe(true);
      });
    });
  });

  describe('Performance', () => {
    it('should validate scopes efficiently', () => {
      const scopes = ['donations:read', 'donations:create', 'stats:read', 'wallets:read'];
      
      const start = Date.now();
      for (let i = 0; i < 1000; i++) {
        scopeValidator.validateScopes(scopes);
      }
      const elapsed = Date.now() - start;
      
      // Should complete 1000 validations in less than 100ms
      expect(elapsed).toBeLessThan(100);
    });

    it('should check scopes efficiently', () => {
      const scopes = ['donations:read', 'donations:create', 'stats:read'];
      
      const start = Date.now();
      for (let i = 0; i < 10000; i++) {
        scopeValidator.hasScope(scopes, 'donations:read');
      }
      const elapsed = Date.now() - start;
      
      // Should complete 10000 checks in less than 50ms
      expect(elapsed).toBeLessThan(50);
    });
  });
});
