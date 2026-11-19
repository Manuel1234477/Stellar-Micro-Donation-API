/**
 * Backup key id and rotation (#1951)
 *
 * - New backups carry a key id in their header.
 * - A backup made before a key rotation can still be restored after it,
 *   using BACKUP_PREVIOUS_KEYS.
 * - Legacy (headerless, SHA-256 keyed) backups stay restorable.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const BackupService = require('../src/services/BackupService');

const OLD_KEY = 'old-root-key-for-backup-rotation-tests-0001';
const NEW_KEY = 'new-root-key-for-backup-rotation-tests-0002';
const CONTENT = 'sqlite-bytes-for-rotation-test';

describe('BackupService key rotation (#1951)', () => {
  const ENV_KEYS = ['ENCRYPTION_KEY', 'BACKUP_ENCRYPTION_KEY', 'BACKUP_KEY_ID', 'BACKUP_PREVIOUS_KEYS'];
  const saved = {};
  let workDir;
  let dbPath;
  let backupDir;

  beforeEach(() => {
    ENV_KEYS.forEach((k) => { saved[k] = process.env[k]; delete process.env[k]; });
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-rotation-'));
    dbPath = path.join(workDir, 'live.db');
    backupDir = path.join(workDir, 'backups');
    fs.writeFileSync(dbPath, CONTENT);
    process.env.ENCRYPTION_KEY = OLD_KEY;
  });

  afterEach(() => {
    ENV_KEYS.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  const service = () => new BackupService({ dbPath, backupDir });

  test('new backups record the key id in their header', async () => {
    process.env.BACKUP_KEY_ID = 'key-2026-01';
    const result = await service().backup();

    expect(result.keyId).toBe('key-2026-01');
    const raw = fs.readFileSync(result.filePath);
    expect(raw.subarray(0, 4).toString('ascii')).toBe('SBK2');
    expect(raw.subarray(5, 5 + 'key-2026-01'.length).toString('utf8')).toBe('key-2026-01');
  });

  test('derives a key id from the key material when BACKUP_KEY_ID is unset', async () => {
    const first = await service().backup();
    const second = await service().backup();
    expect(first.keyId).toMatch(/^[0-9a-f]{16}$/);
    expect(second.keyId).toBe(first.keyId);
  });

  test('a backup made before rotation restores after the root key changes', async () => {
    process.env.BACKUP_KEY_ID = 'k1';
    const oldBackup = await service().backup();

    // Rotate: new root key, old key kept for decryption.
    process.env.ENCRYPTION_KEY = NEW_KEY;
    process.env.BACKUP_KEY_ID = 'k2';
    process.env.BACKUP_PREVIOUS_KEYS = `k1:${OLD_KEY}`;

    fs.writeFileSync(dbPath, 'mutated-after-rotation');
    const restored = await service().restore(oldBackup.backupId);

    expect(restored.keyId).toBe('k1');
    expect(fs.readFileSync(dbPath, 'utf8')).toBe(CONTENT);
  });

  test('a backup made after rotation is written under the new key id', async () => {
    process.env.BACKUP_KEY_ID = 'k1';
    await service().backup();

    process.env.ENCRYPTION_KEY = NEW_KEY;
    process.env.BACKUP_KEY_ID = 'k2';
    process.env.BACKUP_PREVIOUS_KEYS = `k1:${OLD_KEY}`;
    const newBackup = await service().backup();

    expect(newBackup.keyId).toBe('k2');
  });

  test('restoring fails with a clear message when the backup key is not configured', async () => {
    process.env.BACKUP_KEY_ID = 'k1';
    const oldBackup = await service().backup();

    process.env.ENCRYPTION_KEY = NEW_KEY;
    process.env.BACKUP_KEY_ID = 'k2';
    await expect(service().restore(oldBackup.backupId))
      .rejects.toThrow(/No backup key configured for key id "k1"/);
  });

  test('legacy headerless backups (SHA-256 key) still restore, including after rotation', async () => {
    // Write a v1 file exactly as the pre-#1951 code did.
    const iv = crypto.randomBytes(12);
    const key = crypto.createHash('sha256').update(OLD_KEY).digest();
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    const ct = Buffer.concat([cipher.update(CONTENT), cipher.final()]);
    const legacy = Buffer.concat([iv, cipher.getAuthTag(), ct]);
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, 'backup_legacy.enc'), legacy);

    // Still works with the same root key.
    fs.writeFileSync(dbPath, 'x');
    await service().restore('backup_legacy');
    expect(fs.readFileSync(dbPath, 'utf8')).toBe(CONTENT);

    // And after the root key was rotated, when the old key is listed.
    process.env.ENCRYPTION_KEY = NEW_KEY;
    process.env.BACKUP_PREVIOUS_KEYS = `legacy:${OLD_KEY}`;
    fs.writeFileSync(dbPath, 'y');
    await service().restore('backup_legacy');
    expect(fs.readFileSync(dbPath, 'utf8')).toBe(CONTENT);
  });

  test('a wrong key never produces plaintext', async () => {
    process.env.BACKUP_KEY_ID = 'k1';
    const oldBackup = await service().backup();

    process.env.ENCRYPTION_KEY = NEW_KEY;
    process.env.BACKUP_KEY_ID = 'k1';
    process.env.BACKUP_PREVIOUS_KEYS = '';
    // Same id, wrong material: authentication must fail.
    await expect(service().restore(oldBackup.backupId)).rejects.toThrow();
  });
});
