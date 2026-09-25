/**
 * RestoreTestRunner - Periodic Backup Restore Verification
 *
 * RESPONSIBILITY: Periodically test backup restoration to verify disaster recovery capability
 * OWNER: Backend Team
 * DEPENDENCIES: timerRegistry, BackupService, logger
 *
 * This service proves backups are complete, restorable, and current by:
 * 1. Selecting the latest backup
 * 2. Restoring it to a scratch database
 * 3. Validating data integrity and completeness
 * 4. Alerting on failures
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const log = require('../utils/log');
const timerRegistry = require('../utils/timerRegistry');

class RestoreTestRunner {
  /**
   * @param {object} options
   * @param {BackupService} options.backupService - Backup service instance
   * @param {string} options.schedule - Cron expression (default: '0 3 * * *' = 3 AM daily)
   * @param {string} options.scratchDbDir - Temp directory for test databases (default: system temp)
   * @param {function} [options.onTestComplete] - Callback on test completion
   * @param {function} [options.onTestFailure] - Callback on test failure
   * @param {function} [options.onAlertRequired] - Callback to send alert
   */
  constructor(options = {}) {
    this.backupService = options.backupService;
    this.schedule = options.schedule || '0 3 * * *';
    this.scratchDbDir = options.scratchDbDir || os.tmpdir();
    this.onTestComplete = options.onTestComplete || (() => {});
    this.onTestFailure = options.onTestFailure || (() => {});
    this.onAlertRequired = options.onAlertRequired || (() => {});
    this.task = null;
    this.lastTestResult = null;
  }

  /**
   * Start the restore test scheduler
   */
  start() {
    if (this.task) {
      log.warn('RESTORE_TEST', 'Scheduler already running');
      return;
    }

    log.info('RESTORE_TEST', 'Starting restore test scheduler', { schedule: this.schedule });

    this.task = timerRegistry.scheduleCron(this.schedule, () => {
      this.executeTest().catch(error => {
        log.error('RESTORE_TEST', 'Unhandled error in restore test task', {
          error: error.message,
        });
      });
    });

    log.info('RESTORE_TEST', 'Restore test scheduler started', { nextRun: this._getNextRun() });
  }

  /**
   * Stop the restore test scheduler
   */
  stop() {
    if (this.task) {
      this.task.stop();
      this.task.destroy();
      this.task = null;
      log.info('RESTORE_TEST', 'Scheduler stopped');
    }
  }

  /**
   * Execute a full restore test
   * @returns {Promise<object>} Test result
   */
  async executeTest() {
    const startTime = Date.now();
    const testId = `restore_test_${startTime}_${Math.random().toString(36).substring(7)}`;

    const result = {
      testId,
      startTime: new Date().toISOString(),
      status: 'running',
      backupId: null,
      passed: false,
      duration: 0,
      details: {},
    };

    try {
      log.info('RESTORE_TEST', 'Starting restore verification test', { testId });

      // Get latest backup
      const backups = await this.backupService.listBackups();

      if (!backups || backups.length === 0) {
        throw new Error('No backups available for restore test');
      }

      const latestBackup = backups[0];
      result.backupId = latestBackup.backupId;

      log.info('RESTORE_TEST', 'Testing backup restoration', {
        testId,
        backupId: latestBackup.backupId,
        createdAt: latestBackup.createdAt,
      });

      // Verify the backup can be restored
      const verification = await this.backupService.verifyBackup(latestBackup.backupId);

      result.details = {
        backupId: latestBackup.backupId,
        backupSize: latestBackup.size,
        backupCreatedAt: latestBackup.createdAt,
        verificationResult: verification,
      };

      // Test passes if verification passed
      result.passed = verification.passed;

      if (!result.passed) {
        log.error('RESTORE_TEST', 'Restore test FAILED', {
          testId,
          backupId: latestBackup.backupId,
          details: verification.details,
        });

        // Alert operations team
        await this.onAlertRequired({
          severity: 'critical',
          title: 'Restore Test Failed',
          message: `Restore verification test failed for backup ${latestBackup.backupId}`,
          testId,
          details: verification.details,
        });

        this.onTestFailure({
          ...result,
          error: 'Backup verification failed',
        });
      } else {
        log.info('RESTORE_TEST', 'Restore test PASSED', {
          testId,
          backupId: latestBackup.backupId,
          rowCounts: verification.details.rowCounts,
        });

        this.onTestComplete(result);
      }

      result.status = result.passed ? 'passed' : 'failed';
      result.duration = Date.now() - startTime;
      result.completedAt = new Date().toISOString();

      this.lastTestResult = result;
      return result;
    } catch (error) {
      log.error('RESTORE_TEST', 'Restore test execution failed', {
        testId,
        error: error.message,
        stack: error.stack,
      });

      result.status = 'error';
      result.error = error.message;
      result.duration = Date.now() - startTime;
      result.completedAt = new Date().toISOString();

      // Alert on execution error
      await this.onAlertRequired({
        severity: 'high',
        title: 'Restore Test Execution Error',
        message: `Restore test failed to execute: ${error.message}`,
        testId,
      });

      this.onTestFailure(result);
      this.lastTestResult = result;

      throw error;
    }
  }

  /**
   * Get the last test result
   * @returns {object|null}
   */
  getLastResult() {
    return this.lastTestResult;
  }

  /**
   * Get current scheduler status
   * @returns {object}
   */
  getStatus() {
    return {
      running: !!this.task,
      schedule: this.schedule,
      nextRun: this._getNextRun(),
      lastTestResult: this.lastTestResult,
    };
  }

  /**
   * Get next scheduled run time
   * @returns {Date}
   * @private
   */
  _getNextRun() {
    if (!this.task) return null;
    return this.task.nextDate ? this.task.nextDate() : null;
  }
}

module.exports = RestoreTestRunner;
