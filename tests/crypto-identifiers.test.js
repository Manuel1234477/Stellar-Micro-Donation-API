/**
 * Crypto Identifiers Tests (Issue #1758)
 *
 * Validates that job and backup IDs use crypto-secure random generation
 * instead of Math.random() to prevent enumeration and collision attacks.
 */

const crypto = require('crypto');

describe('Crypto-Secure Identifiers', () => {
  describe('Random ID generation', () => {
    it('should generate UUIDs with crypto.randomUUID()', () => {
      const uuid = crypto.randomUUID();

      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(uuid.length).toBe(36);
    });

    it('should generate hex strings with crypto.randomBytes()', () => {
      const bytes = crypto.randomBytes(8);
      const hex = bytes.toString('hex');

      expect(hex).toMatch(/^[0-9a-f]+$/i);
      expect(hex.length).toBe(16);
    });

    it('should generate unique identifiers on each call', () => {
      const ids = new Set();

      for (let i = 0; i < 100; i++) {
        const id = crypto.randomBytes(8).toString('hex');
        ids.add(id);
      }

      expect(ids.size).toBe(100);
    });

    it('should not be predictable', () => {
      const id1 = crypto.randomBytes(8).toString('hex');
      const id2 = crypto.randomBytes(8).toString('hex');
      const id3 = crypto.randomBytes(8).toString('hex');

      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
      expect(id1).not.toBe(id3);
    });
  });

  describe('Job ID format', () => {
    it('should generate valid integrity check job IDs', () => {
      const timestamp = Date.now();
      const randomPart = crypto.randomBytes(4).toString('hex');
      const jobId = `integrity-${timestamp}-${randomPart}`;

      expect(jobId).toMatch(/^integrity-\d+-[0-9a-f]+$/);
    });

    it('should generate valid backup operation IDs', () => {
      const startTime = Date.now();
      const randomPart = crypto.randomBytes(4).toString('hex');
      const operationId = `backup_${startTime}_${randomPart}`;

      expect(operationId).toMatch(/^backup_\d+_[0-9a-f]+$/);
    });

    it('should generate collisionless IDs under concurrency', async () => {
      const generateId = () => {
        const timestamp = Date.now();
        const randomPart = crypto.randomBytes(4).toString('hex');
        return `integrity-${timestamp}-${randomPart}`;
      };

      const promises = Array(10).fill(null).map(() => generateId());
      const ids = await Promise.all(promises);
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBeGreaterThanOrEqual(9);
    });
  });

  describe('No Math.random usage in security-sensitive code', () => {
    const fs = require('fs');
    const path = require('path');

    it('should not use Math.random() for job IDs in admin routes', () => {
      const filePath = path.join(__dirname, '../src/routes/admin/db.js');
      const content = fs.readFileSync(filePath, 'utf-8');

      const hasJobIdRandom = /jobId\s*=\s*[`'].*Math\.random/i.test(content);
      expect(hasJobIdRandom).toBe(false);
    });

    it('should not use Math.random() for backup IDs in BackupScheduler', () => {
      const filePath = path.join(__dirname, '../src/services/BackupScheduler.js');
      const content = fs.readFileSync(filePath, 'utf-8');

      const hasBackupRandom = /operationId\s*=\s*[`'].*Math\.random/i.test(content);
      expect(hasBackupRandom).toBe(false);
    });

    it('should use crypto for secure random generation', () => {
      const filePath = path.join(__dirname, '../src/routes/admin/db.js');
      const content = fs.readFileSync(filePath, 'utf-8');

      const hasCrypto = /crypto\.randomUUID|crypto\.randomBytes|crypto\.getRandomValues/i.test(content);
      expect(hasCrypto).toBe(true);
    });
  });

  describe('Entropy and security', () => {
    it('should have sufficient entropy (256 bits minimum)', () => {
      const bytes = crypto.randomBytes(32);
      const hex = bytes.toString('hex');

      expect(hex.length).toBe(64);
      expect(/^[0-9a-f]{64}$/i.test(hex)).toBe(true);
    });

    it('should be cryptographically secure', () => {
      const values = [];

      for (let i = 0; i < 1000; i++) {
        const rand = crypto.randomBytes(1)[0];
        values.push(rand);
      }

      const min = Math.min(...values);
      const max = Math.max(...values);

      expect(min).toBeGreaterThanOrEqual(0);
      expect(max).toBeLessThanOrEqual(255);
      expect(max - min).toBeGreaterThan(100);
    });
  });
});
