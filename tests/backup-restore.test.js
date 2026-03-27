'use strict';

/**
 * Tests for BackupService and admin backup/restore endpoints.
 * Covers: backup creation, encryption at rest, restore, listing, and admin API.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// ── helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'backup-test-'));
}

function setEncryptionKey(key = 'test-encryption-key-for-backup') {
  process.env.ENCRYPTION_KEY = key;
}

// ── BackupService unit tests ──────────────────────────────────────────────────

describe('BackupService', () => {
  let BackupService;
  let tmpDir;
  let fakeDb;

  beforeEach(() => {
    setEncryptionKey();
    tmpDir = makeTmpDir();
    fakeDb = path.join(tmpDir, 'test.db');
    fs.writeFileSync(fakeDb, 'fake-sqlite-content-for-testing');

    // Re-require to pick up fresh env
    jest.resetModules();
    BackupService = require('../src/services/BackupService');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('backup()', () => {
    it('creates an encrypted backup file in the backup directory', async () => {
      const svc = new BackupService({ dbPath: fakeDb, backupDir: tmpDir });
      const result = await svc.backup();

      expect(result.backupId).toMatch(/^backup_\d+_[0-9a-f]{8}$/);
      expect(result.filePath).toMatch(/\.enc$/);
      expect(result.size).toBeGreaterThan(0);
      expect(result.createdAt).toBeTruthy();
      expect(fs.existsSync(result.filePath)).toBe(true);
    });

    it('backup file is encrypted (not plaintext)', async () => {
      const svc = new BackupService({ dbPath: fakeDb, backupDir: tmpDir });
      const result = await svc.backup();

      const raw = fs.readFileSync(result.filePath);
      // Should not contain the original plaintext
      expect(raw.toString()).not.toContain('fake-sqlite-content-for-testing');
    });

    it('backup file can be decrypted back to original content', async () => {
      const svc = new BackupService({ dbPath: fakeDb, backupDir: tmpDir });
      const result = await svc.backup();

      const encrypted = fs.readFileSync(result.filePath);
      const key = crypto.createHash('sha256').update(process.env.ENCRYPTION_KEY).digest();
      const iv = encrypted.slice(0, 12);
      const tag = encrypted.slice(12, 28);
      const ct = encrypted.slice(28);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([decipher.update(ct), decipher.final()]);

      expect(decrypted.toString()).toBe('fake-sqlite-content-for-testing');
    });

    it('throws when database file does not exist', async () => {
      const svc = new BackupService({ dbPath: '/nonexistent/db.sqlite', backupDir: tmpDir });
      await expect(svc.backup()).rejects.toThrow('Database file not found');
    });

    it('throws when ENCRYPTION_KEY is missing', async () => {
      delete process.env.ENCRYPTION_KEY;
      jest.resetModules();
      const BS = require('../src/services/BackupService');
      const svc = new BS({ dbPath: fakeDb, backupDir: tmpDir });
      await expect(svc.backup()).rejects.toThrow('ENCRYPTION_KEY');
    });

    it('creates backup directory if it does not exist', async () => {
      const nestedDir = path.join(tmpDir, 'nested', 'backups');
      const svc = new BackupService({ dbPath: fakeDb, backupDir: nestedDir });
      const result = await svc.backup();
      expect(fs.existsSync(nestedDir)).toBe(true);
      expect(fs.existsSync(result.filePath)).toBe(true);
    });
  });

  describe('restore()', () => {
    it('restores the database from a backup', async () => {
      const svc = new BackupService({ dbPath: fakeDb, backupDir: tmpDir });
      const { backupId } = await svc.backup();

      // Overwrite the db to simulate data loss
      fs.writeFileSync(fakeDb, 'corrupted-data');

      const result = await svc.restore(backupId);
      expect(result.backupId).toBe(backupId);
      expect(result.restoredAt).toBeTruthy();

      const restored = fs.readFileSync(fakeDb, 'utf8');
      expect(restored).toBe('fake-sqlite-content-for-testing');
    });

    it('preserves the pre-restore database as .pre-restore', async () => {
      const svc = new BackupService({ dbPath: fakeDb, backupDir: tmpDir });
      const { backupId } = await svc.backup();

      fs.writeFileSync(fakeDb, 'data-before-restore');
      await svc.restore(backupId);

      const preRestore = fs.readFileSync(`${fakeDb}.pre-restore`, 'utf8');
      expect(preRestore).toBe('data-before-restore');
    });

    it('throws when backup ID does not exist', async () => {
      const svc = new BackupService({ dbPath: fakeDb, backupDir: tmpDir });
      await expect(svc.restore('backup_nonexistent_0000')).rejects.toThrow('Backup not found');
    });

    it('throws when backup is tampered (auth tag mismatch)', async () => {
      const svc = new BackupService({ dbPath: fakeDb, backupDir: tmpDir });
      const { backupId, filePath } = await svc.backup();

      // Corrupt the ciphertext
      const buf = fs.readFileSync(filePath);
      buf[buf.length - 1] ^= 0xff;
      fs.writeFileSync(filePath, buf);

      await expect(svc.restore(backupId)).rejects.toThrow();
    });
  });

  describe('listBackups()', () => {
    it('returns empty array when no backups exist', async () => {
      const svc = new BackupService({ dbPath: fakeDb, backupDir: path.join(tmpDir, 'empty') });
      const list = await svc.listBackups();
      expect(list).toEqual([]);
    });

    it('lists all backup files sorted newest first', async () => {
      const svc = new BackupService({ dbPath: fakeDb, backupDir: tmpDir });
      await svc.backup();
      await new Promise(r => setTimeout(r, 10));
      await svc.backup();

      const list = await svc.listBackups();
      expect(list.length).toBe(2);
      expect(list[0].backupId).toBeTruthy();
      expect(list[0].size).toBeGreaterThan(0);
      // Newest first
      expect(new Date(list[0].createdAt) >= new Date(list[1].createdAt)).toBe(true);
    });

    it('only lists .enc files', async () => {
      const svc = new BackupService({ dbPath: fakeDb, backupDir: tmpDir });
      fs.writeFileSync(path.join(tmpDir, 'not-a-backup.txt'), 'ignore me');
      await svc.backup();

      const list = await svc.listBackups();
      expect(list.every(b => b.backupId.startsWith('backup_'))).toBe(true);
    });
  });
});

// ── Admin route integration tests ────────────────────────────────────────────

describe('Admin backup routes', () => {
  let request;
  let app;
  let BackupService;
  let tmpDir;
  let fakeDb;

  beforeEach(() => {
    setEncryptionKey();
    tmpDir = makeTmpDir();
    fakeDb = path.join(tmpDir, 'test.db');
    fs.writeFileSync(fakeDb, 'fake-sqlite-content');

    jest.resetModules();

    // Mock BackupService before requiring the route
    BackupService = require('../src/services/BackupService');
    jest.spyOn(BackupService.prototype, 'backup').mockResolvedValue({
      backupId: 'backup_123_abcd1234',
      filePath: '/data/backups/backup_123_abcd1234.enc',
      size: 512,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    jest.spyOn(BackupService.prototype, 'listBackups').mockResolvedValue([
      { backupId: 'backup_123_abcd1234', filePath: '/data/backups/backup_123_abcd1234.enc', size: 512, createdAt: '2026-01-01T00:00:00.000Z' },
    ]);
    jest.spyOn(BackupService.prototype, 'restore').mockResolvedValue({
      backupId: 'backup_123_abcd1234',
      restoredAt: '2026-01-01T01:00:00.000Z',
    });

    const express = require('express');
    const backupRoutes = require('../src/routes/admin/backup');
    app = express();
    app.use(express.json());

    // Bypass RBAC for route tests
    jest.mock('../src/middleware/rbac', () => ({
      checkPermission: () => (req, res, next) => next(),
      requireAdmin: () => (req, res, next) => next(),
    }));

    app.use('/', backupRoutes);

    request = require('supertest');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('POST / triggers a backup and returns 201 with backup metadata', async () => {
    const res = await request(app).post('/');
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.backupId).toBe('backup_123_abcd1234');
  });

  it('GET / lists all backups', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0].backupId).toBe('backup_123_abcd1234');
  });

  it('POST /restore/:backupId restores from a backup', async () => {
    const res = await request(app).post('/restore/backup_123_abcd1234');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.backupId).toBe('backup_123_abcd1234');
    expect(res.body.data.restoredAt).toBeTruthy();
  });

  it('POST /restore/:backupId returns 500 when backup not found', async () => {
    BackupService.prototype.restore.mockRejectedValue(new Error('Backup not found: bad_id'));
    const res = await request(app).post('/restore/bad_id');
    expect(res.status).toBe(500);
  });
});

// ── Scheduler integration ─────────────────────────────────────────────────────

describe('RecurringDonationScheduler backup scheduling', () => {
  beforeEach(() => {
    setEncryptionKey();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('triggers a backup when backupInterval has elapsed', async () => {
    const BackupService = require('../src/services/BackupService');
    const backupSpy = jest.spyOn(BackupService.prototype, 'backup').mockResolvedValue({ backupId: 'sched_backup' });

    const { Class: Scheduler } = require('../src/services/RecurringDonationScheduler');
    jest.spyOn(Scheduler.prototype, 'processSchedules').mockImplementation(async function () {
      const now2 = Date.now();
      if (now2 - this.lastBackupAt >= this.backupInterval) {
        this.lastBackupAt = now2;
        const BS = require('../src/services/BackupService');
        const svc = new BS();
        await svc.backup();
      }
    });

    const scheduler = new Scheduler(null);
    scheduler.backupInterval = 100;
    scheduler.lastBackupAt = Date.now() - 200;

    await scheduler.processSchedules();
    expect(backupSpy).toHaveBeenCalledTimes(1);
  });

  it('does not trigger a backup when interval has not elapsed', async () => {
    const BackupService = require('../src/services/BackupService');
    const backupSpy = jest.spyOn(BackupService.prototype, 'backup').mockResolvedValue({ backupId: 'sched_backup' });

    const { Class: Scheduler } = require('../src/services/RecurringDonationScheduler');
    jest.spyOn(Scheduler.prototype, 'processSchedules').mockImplementation(async function () {
      const now2 = Date.now();
      if (now2 - this.lastBackupAt >= this.backupInterval) {
        this.lastBackupAt = now2;
        const BS = require('../src/services/BackupService');
        const svc = new BS();
        await svc.backup();
      }
    });

    const scheduler = new Scheduler(null);
    scheduler.backupInterval = 100;
    scheduler.lastBackupAt = Date.now(); // just ran

    await scheduler.processSchedules();
    expect(backupSpy).not.toHaveBeenCalled();
  });
});
