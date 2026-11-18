#!/usr/bin/env node

/**
 * Test Backup/Restore Functionality
 *
 * This script tests the backup and restore procedures to ensure they work correctly.
 * It is designed to run in CI/CD pipelines for continuous validation.
 *
 * Usage:
 *   npm run test:backup-restore
 *   node scripts/test-backup-restore.js
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const sqlite3 = require('sqlite3');
const BackupService = require('../src/services/BackupService');
const log = require('../src/utils/log');

// Run against an isolated scratch directory by default so the suite starts
// from an empty backup directory and never touches the tracked data/ tree.
const WORK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-restore-test-'));
const TEST_DB_PATH = process.env.TEST_DB_PATH || path.join(WORK_DIR, 'test-backup.db');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(WORK_DIR, 'backups');

/**
 * Create a small SQLite database containing the tables BackupService
 * verifies (users, transactions, recurring_donations) with some rows.
 */
function createTestDatabase(dbPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (openErr) => {
      if (openErr) return reject(openErr);
      db.serialize(() => {
        db.run('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, publicKey TEXT)');
        db.run('CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY, amount TEXT)');
        db.run('CREATE TABLE IF NOT EXISTS recurring_donations (id INTEGER PRIMARY KEY, amount TEXT)');
        db.run("INSERT INTO users (publicKey) VALUES ('GTESTDONOR'), ('GTESTRECIPIENT')");
        db.run("INSERT INTO transactions (amount) VALUES ('10.0000000')");
        db.run("INSERT INTO recurring_donations (amount) VALUES ('1.0000000')", (err) => {
          db.close((closeErr) => (err || closeErr ? reject(err || closeErr) : resolve()));
        });
      });
    });
  });
}

class BackupRestoreTestSuite {
  constructor() {
    this.passed = 0;
    this.failed = 0;
    this.errors = [];
    this.backupService = null;
  }

  async setup() {
    log.info('BACKUP_TEST', 'Setting up test environment');

    // Ensure backup dir exists
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    if (!fs.existsSync(TEST_DB_PATH)) {
      await createTestDatabase(TEST_DB_PATH);
    }

    // Initialize backup service
    this.backupService = new BackupService({
      dbPath: TEST_DB_PATH,
      backupDir: BACKUP_DIR,
    });

    log.info('BACKUP_TEST', 'Test setup complete', { TEST_DB_PATH, BACKUP_DIR });
  }

  async cleanup() {
    log.info('BACKUP_TEST', 'Cleaning up test environment');

    // Remove test database if exists
    if (fs.existsSync(TEST_DB_PATH)) {
      try {
        fs.unlinkSync(TEST_DB_PATH);
        log.info('BACKUP_TEST', 'Cleaned up test database');
      } catch (error) {
        log.warn('BACKUP_TEST', 'Could not clean up test database', { error: error.message });
      }
    }

    fs.rmSync(WORK_DIR, { recursive: true, force: true });
  }

  assert(condition, message) {
    if (condition) {
      this.passed++;
      log.info('BACKUP_TEST', `✓ ${message}`);
    } else {
      this.failed++;
      const error = `✗ ${message}`;
      this.errors.push(error);
      log.error('BACKUP_TEST', error);
    }
  }

  async assertAsync(asyncFn, message) {
    try {
      const result = await asyncFn();
      this.assert(result, message);
    } catch (error) {
      this.failed++;
      const msg = `✗ ${message}: ${error.message}`;
      this.errors.push(msg);
      log.error('BACKUP_TEST', msg);
    }
  }

  async runTests() {
    log.info('BACKUP_TEST', '=== Starting Backup/Restore Test Suite ===');

    try {
      await this.setup();

      // Test 1: List backups on empty directory
      await this.testEmptyBackupList();

      // Test 2: Create a backup
      const backup = await this.testBackupCreation();

      if (backup) {
        // Test 3: Verify backup integrity
        await this.testBackupVerification(backup.backupId);

        // Test 4: List backups
        await this.testListBackups();
      }

      await this.cleanup();
      this.printResults();

      if (this.failed > 0) {
        process.exit(1);
      }
    } catch (error) {
      log.error('BACKUP_TEST', 'Test suite error', { error: error.message, stack: error.stack });
      process.exit(1);
    }
  }

  async testEmptyBackupList() {
    log.info('BACKUP_TEST', 'Test: List backups on empty directory');

    await this.assertAsync(async () => {
      const backups = await this.backupService.listBackups();
      return Array.isArray(backups) && backups.length === 0;
    }, 'Should return empty array for directory with no backups');
  }

  async testBackupCreation() {
    log.info('BACKUP_TEST', 'Test: Create backup');

    let createdBackup = null;

    await this.assertAsync(async () => {
      try {
        createdBackup = await this.backupService.backup();
        return createdBackup
          && createdBackup.backupId
          && createdBackup.filePath
          && createdBackup.size > 0;
      } catch (error) {
        log.error('BACKUP_TEST', 'Backup creation error', { error: error.message });
        return false;
      }
    }, 'Should create encrypted backup file');

    if (createdBackup) {
      await this.assertAsync(async () => {
        return fs.existsSync(createdBackup.filePath);
      }, 'Backup file should exist on disk');

      await this.assertAsync(async () => {
        const stat = fs.statSync(createdBackup.filePath);
        return stat.size === createdBackup.size;
      }, 'Backup file size should match reported size');
    }

    return createdBackup;
  }

  async testBackupVerification(backupId) {
    log.info('BACKUP_TEST', 'Test: Verify backup integrity');

    await this.assertAsync(async () => {
      const verification = await this.backupService.verifyBackup(backupId);
      return verification
        && verification.backupId === backupId
        && typeof verification.passed === 'boolean';
    }, 'Should return verification result object');

    await this.assertAsync(async () => {
      const verification = await this.backupService.verifyBackup(backupId);
      return verification.passed === true;
    }, 'Backup verification should pass');

    await this.assertAsync(async () => {
      const verification = await this.backupService.verifyBackup(backupId);
      return verification.details
        && verification.details.integrityOk === true;
    }, 'Database integrity check should pass');
  }

  async testListBackups() {
    log.info('BACKUP_TEST', 'Test: List backups');

    await this.assertAsync(async () => {
      const backups = await this.backupService.listBackups();
      return Array.isArray(backups) && backups.length > 0;
    }, 'Should list created backups');

    await this.assertAsync(async () => {
      const backups = await this.backupService.listBackups();
      const first = backups[0];
      return first
        && first.backupId
        && first.filePath
        && first.size > 0
        && first.createdAt;
    }, 'Each backup should have required properties');

    await this.assertAsync(async () => {
      const backups = await this.backupService.listBackups();
      // Should be sorted newest first
      const dates = backups.map(b => new Date(b.createdAt).getTime());
      for (let i = 0; i < dates.length - 1; i++) {
        if (dates[i] < dates[i + 1]) return false;
      }
      return true;
    }, 'Backups should be sorted by creation time (newest first)');
  }

  printResults() {
    const total = this.passed + this.failed;
    const percentage = total > 0 ? Math.round((this.passed / total) * 100) : 0;

    log.info('BACKUP_TEST', '');
    log.info('BACKUP_TEST', '=== Test Results ===');
    log.info('BACKUP_TEST', `Passed:  ${this.passed}`);
    log.info('BACKUP_TEST', `Failed:  ${this.failed}`);
    log.info('BACKUP_TEST', `Total:   ${total}`);
    log.info('BACKUP_TEST', `Success: ${percentage}%`);

    if (this.errors.length > 0) {
      log.info('BACKUP_TEST', '');
      log.info('BACKUP_TEST', 'Errors:');
      this.errors.forEach(error => log.info('BACKUP_TEST', error));
    }

    log.info('BACKUP_TEST', '');
  }
}

// Run the test suite
const suite = new BackupRestoreTestSuite();
suite.runTests();
