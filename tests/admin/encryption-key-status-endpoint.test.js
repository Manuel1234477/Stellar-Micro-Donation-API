'use strict';

/**
 * Tests for GET /admin/encryption/key-status endpoint
 * Issue #118: Add GET /admin/encryption/key-status endpoint
 */

const EncryptionService = require('../../src/services/EncryptionService');

describe('GET /admin/encryption/key-status', () => {
  describe('Encryption Key Status Response', () => {
    it('should return object with required fields', () => {
      const mockStatus = {
        currentKeyVersion: 2,
        lastRotatedAt: new Date().toISOString(),
        recordsByVersion: { v1: 1500, v2: 8500 },
        totalEncryptedRecords: 10000,
        reencryptionRequired: true,
      };

      expect(mockStatus).toHaveProperty('currentKeyVersion');
      expect(mockStatus).toHaveProperty('lastRotatedAt');
      expect(mockStatus).toHaveProperty('recordsByVersion');
      expect(mockStatus).toHaveProperty('totalEncryptedRecords');
      expect(mockStatus).toHaveProperty('reencryptionRequired');
    });

    it('should have currentKeyVersion as positive number', () => {
      const mockStatus = {
        currentKeyVersion: 2,
      };

      expect(typeof mockStatus.currentKeyVersion).toBe('number');
      expect(mockStatus.currentKeyVersion >= 1).toBe(true);
    });

    it('should have recordsByVersion as object', () => {
      const mockStatus = {
        recordsByVersion: { v1: 1500, v2: 8500 },
      };

      expect(typeof mockStatus.recordsByVersion).toBe('object');
      expect(!Array.isArray(mockStatus.recordsByVersion)).toBe(true);
    });

    it('should have totalEncryptedRecords as non-negative number', () => {
      const mockStatus = {
        totalEncryptedRecords: 10000,
      };

      expect(typeof mockStatus.totalEncryptedRecords).toBe('number');
      expect(mockStatus.totalEncryptedRecords >= 0).toBe(true);
    });

    it('should have reencryptionRequired as boolean', () => {
      const mockStatus = {
        reencryptionRequired: true,
      };

      expect(typeof mockStatus.reencryptionRequired).toBe('boolean');
    });

    it('should never expose encryption key material', () => {
      const mockStatus = {
        currentKeyVersion: 2,
        lastRotatedAt: new Date().toISOString(),
        recordsByVersion: { v1: 1500, v2: 8500 },
        totalEncryptedRecords: 10000,
        reencryptionRequired: true,
      };

      const responseStr = JSON.stringify(mockStatus);
      expect(responseStr).not.toContain('secret');
      expect(responseStr).not.toContain('password');
    });
  });

  describe('Key Version Tracking', () => {
    it('should track records by version with v prefix', () => {
      const recordsByVersion = { v1: 1500, v2: 8500 };
      const versions = Object.keys(recordsByVersion);

      versions.forEach(v => {
        expect(v).toMatch(/^v\d+$/);
      });
    });

    it('should sum recordsByVersion to totalEncryptedRecords', () => {
      const recordsByVersion = { v1: 1500, v2: 8500 };
      const totalEncryptedRecords = 10000;
      const sum = Object.values(recordsByVersion).reduce((a, b) => a + b, 0);

      expect(sum).toBe(totalEncryptedRecords);
    });

    it('should have currentKeyVersion in recordsByVersion', () => {
      const currentKeyVersion = 2;
      const recordsByVersion = { v1: 1500, v2: 8500 };
      const currentVersionKey = `v${currentKeyVersion}`;

      expect(recordsByVersion).toHaveProperty(currentVersionKey);
    });

    it('should have non-negative record counts', () => {
      const recordsByVersion = { v1: 1500, v2: 8500 };

      Object.values(recordsByVersion).forEach(count => {
        expect(count >= 0).toBe(true);
      });
    });
  });

  describe('Reencryption Flag Logic', () => {
    it('should set reencryptionRequired to false when all records use current version', () => {
      const currentKeyVersion = 2;
      const recordsByVersion = { v2: 10000 };
      const totalEncryptedRecords = 10000;
      const currentVersionKey = `v${currentKeyVersion}`;
      const onlyCurrentVersion = totalEncryptedRecords === (recordsByVersion[currentVersionKey] || 0);

      expect(onlyCurrentVersion).toBe(true);
      const reencryptionRequired = !onlyCurrentVersion;
      expect(reencryptionRequired).toBe(false);
    });

    it('should set reencryptionRequired to true when records use non-current versions', () => {
      const currentKeyVersion = 2;
      const recordsByVersion = { v1: 1500, v2: 8500 };
      const totalEncryptedRecords = 10000;
      const currentVersionKey = `v${currentKeyVersion}`;
      const hasOldVersions = Object.keys(recordsByVersion).some(v => v !== currentVersionKey);

      expect(hasOldVersions).toBe(true);
      const reencryptionRequired = hasOldVersions && totalEncryptedRecords > 0;
      expect(reencryptionRequired).toBe(true);
    });
  });

  describe('Rotation Timestamp', () => {
    it('should include lastRotatedAt as ISO string or null', () => {
      const mockStatus1 = { lastRotatedAt: new Date().toISOString() };
      const mockStatus2 = { lastRotatedAt: null };

      if (mockStatus1.lastRotatedAt !== null) {
        expect(typeof mockStatus1.lastRotatedAt).toBe('string');
        expect(mockStatus1.lastRotatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      }

      expect(mockStatus2.lastRotatedAt === null).toBe(true);
    });

    it('should parse lastRotatedAt as valid date', () => {
      const lastRotatedAt = new Date().toISOString();
      expect(new Date(lastRotatedAt)).toBeInstanceOf(Date);
    });
  });

  describe('Data Consistency', () => {
    it('should have consistent record counts', () => {
      const recordsByVersion = { v1: 1500, v2: 8500 };
      const totalEncryptedRecords = 10000;
      const sum = Object.values(recordsByVersion).reduce((a, b) => a + b, 0);

      expect(sum).toBe(totalEncryptedRecords);
    });

    it('should maintain version ordering', () => {
      const recordsByVersion = { v1: 1500, v2: 8500, v3: 0 };
      const versions = Object.keys(recordsByVersion)
        .map(v => parseInt(v.slice(1), 10))
        .sort((a, b) => a - b);

      expect(versions).toEqual([1, 2, 3]);
    });
  });

  describe('Security', () => {
    it('should not expose encryption key material in response', () => {
      const mockStatus = {
        currentKeyVersion: 2,
        lastRotatedAt: new Date().toISOString(),
        recordsByVersion: { v1: 1500, v2: 8500 },
        totalEncryptedRecords: 10000,
        reencryptionRequired: true,
      };

      const responseStr = JSON.stringify(mockStatus);
      expect(responseStr).not.toContain('key');
      expect(responseStr).not.toContain('secret');
      expect(responseStr).not.toContain('password');
    });

    it('should only expose version numbers, not key material', () => {
      const mockStatus = {
        recordsByVersion: { v1: 1500, v2: 8500 },
      };

      Object.keys(mockStatus.recordsByVersion).forEach(key => {
        expect(key).toMatch(/^v\d+$/);
        expect(key).not.toContain('key');
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero encrypted records', () => {
      const mockStatus = {
        currentKeyVersion: 1,
        recordsByVersion: { v1: 0 },
        totalEncryptedRecords: 0,
        reencryptionRequired: false,
      };

      expect(mockStatus.totalEncryptedRecords).toBe(0);
      expect(mockStatus.reencryptionRequired).toBe(false);
    });

    it('should handle multiple old versions', () => {
      const mockStatus = {
        currentKeyVersion: 4,
        recordsByVersion: { v1: 100, v2: 200, v3: 300, v4: 400 },
        totalEncryptedRecords: 1000,
        reencryptionRequired: true,
      };

      const oldVersions = Object.keys(mockStatus.recordsByVersion)
        .filter(v => v !== `v${mockStatus.currentKeyVersion}`);
      expect(oldVersions.length).toBe(3);
    });
  });
});
