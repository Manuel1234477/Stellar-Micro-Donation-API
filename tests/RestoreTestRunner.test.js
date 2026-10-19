'use strict';

/**
 * Tests: src/services/RestoreTestRunner.js
 *
 * All external dependencies (timerRegistry, BackupService, logger) are mocked so
 * these tests run without any real filesystem, SQLite, or scheduler activity.
 *
 * Scenarios covered:
 *  - executeTest() with a valid backup → reported as passed
 *  - executeTest() with a failing verification → reported as failed, alert fired
 *  - executeTest() when no backups exist → error thrown, alert fired
 *  - executeTest() when backupService.listBackups() rejects → error thrown
 *  - start() / stop() scheduler lifecycle
 *  - getLastResult() / getStatus() accessors
 */

// ─── Mock dependencies ────────────────────────────────────────────────────────

jest.mock('../src/utils/log', () => ({
  info:  jest.fn(),
  warn:  jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// Scheduling goes through timerRegistry.scheduleCron: give us full control over the task object.
const mockCronTask = {
  stop:     jest.fn(),
  destroy:  jest.fn(),
  nextDate: jest.fn(() => new Date('2025-01-01T03:00:00Z')),
};
jest.mock('../src/utils/timerRegistry', () => ({
  scheduleCron: jest.fn(() => mockCronTask),
}));

const timerRegistry = require('../src/utils/timerRegistry');
const RestoreTestRunner = require('../src/services/RestoreTestRunner');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a mock BackupService with controllable behaviour.
 *
 * @param {object} [overrides]
 * @param {Array}  [overrides.backups]       - What listBackups() resolves with (default: one valid backup)
 * @param {object} [overrides.verification]  - What verifyBackup() resolves with
 */
function makeMockBackupService(overrides = {}) {
  const defaultBackup = {
    backupId:  'backup_1234_abcd',
    filePath:  '/tmp/backup_1234_abcd.enc',
    size:      65536,
    createdAt: new Date().toISOString(),
  };

  const defaultVerification = {
    backupId: 'backup_1234_abcd',
    passed:   true,
    checkedAt: new Date().toISOString(),
    details:  { integrityOk: true, rowCounts: { users: 10, transactions: 50, recurring_donations: 5 }, rowCountMismatches: [] },
  };

  return {
    listBackups:   jest.fn().mockResolvedValue(overrides.backups  ?? [defaultBackup]),
    verifyBackup:  jest.fn().mockResolvedValue(overrides.verification ?? defaultVerification),
  };
}

/**
 * Build a RestoreTestRunner with captured callback spies.
 */
function makeRunner(backupServiceOverrides = {}, runnerOptions = {}) {
  const backupService = makeMockBackupService(backupServiceOverrides);
  const onTestComplete = jest.fn();
  const onTestFailure  = jest.fn();
  const onAlertRequired = jest.fn().mockResolvedValue(undefined);

  const runner = new RestoreTestRunner({
    backupService,
    schedule: '0 3 * * *',
    onTestComplete,
    onTestFailure,
    onAlertRequired,
    ...runnerOptions,
  });

  return { runner, backupService, onTestComplete, onTestFailure, onAlertRequired };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── executeTest — valid backup ───────────────────────────────────────────────

describe('RestoreTestRunner.executeTest — valid backup', () => {
  it('resolves with a result object that has passed=true', async () => {
    const { runner } = makeRunner();
    const result = await runner.executeTest();

    expect(result.passed).toBe(true);
    expect(result.status).toBe('passed');
  });

  it('populates testId, startTime, completedAt, and duration', async () => {
    const { runner } = makeRunner();
    const result = await runner.executeTest();

    expect(result.testId).toMatch(/restore_test_/);
    expect(result.startTime).toBeTruthy();
    expect(result.completedAt).toBeTruthy();
    expect(typeof result.duration).toBe('number');
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it('records the backupId from the latest backup', async () => {
    const { runner } = makeRunner();
    const result = await runner.executeTest();

    expect(result.backupId).toBe('backup_1234_abcd');
  });

  it('includes verification details in result.details', async () => {
    const { runner } = makeRunner();
    const result = await runner.executeTest();

    expect(result.details).toHaveProperty('verificationResult');
    expect(result.details.verificationResult.passed).toBe(true);
  });

  it('calls onTestComplete with the result', async () => {
    const { runner, onTestComplete } = makeRunner();
    const result = await runner.executeTest();

    expect(onTestComplete).toHaveBeenCalledTimes(1);
    expect(onTestComplete).toHaveBeenCalledWith(expect.objectContaining({ passed: true }));
    expect(onTestComplete.mock.calls[0][0]).toBe(result);
  });

  it('does NOT call onTestFailure on success', async () => {
    const { runner, onTestFailure } = makeRunner();
    await runner.executeTest();

    expect(onTestFailure).not.toHaveBeenCalled();
  });

  it('does NOT call onAlertRequired on success', async () => {
    const { runner, onAlertRequired } = makeRunner();
    await runner.executeTest();

    expect(onAlertRequired).not.toHaveBeenCalled();
  });

  it('stores the result in lastTestResult', async () => {
    const { runner } = makeRunner();
    expect(runner.getLastResult()).toBeNull();

    const result = await runner.executeTest();

    expect(runner.getLastResult()).toBe(result);
  });

  it('calls backupService.listBackups() to find the most recent backup', async () => {
    const { runner, backupService } = makeRunner();
    await runner.executeTest();

    expect(backupService.listBackups).toHaveBeenCalledTimes(1);
  });

  it('calls backupService.verifyBackup() with the latest backupId', async () => {
    const { runner, backupService } = makeRunner();
    await runner.executeTest();

    expect(backupService.verifyBackup).toHaveBeenCalledWith('backup_1234_abcd');
  });
});

// ─── executeTest — corrupted / failing backup ─────────────────────────────────

describe('RestoreTestRunner.executeTest — corrupted / failing backup', () => {
  const failedVerification = {
    backupId: 'backup_1234_abcd',
    passed:   false,
    checkedAt: new Date().toISOString(),
    details:  {
      integrityOk: false,
      rowCounts: { users: 0, transactions: 0, recurring_donations: 0 },
      rowCountMismatches: [{ table: 'users', backup: 0, source: 10 }],
    },
  };

  it('returns a result with passed=false when verification fails', async () => {
    const { runner } = makeRunner({ verification: failedVerification });
    const result = await runner.executeTest();

    expect(result.passed).toBe(false);
    expect(result.status).toBe('failed');
  });

  it('does NOT call onTestComplete when verification fails', async () => {
    const { runner, onTestComplete } = makeRunner({ verification: failedVerification });
    await runner.executeTest();

    expect(onTestComplete).not.toHaveBeenCalled();
  });

  it('calls onTestFailure with a result object when verification fails', async () => {
    const { runner, onTestFailure } = makeRunner({ verification: failedVerification });
    await runner.executeTest();

    expect(onTestFailure).toHaveBeenCalledTimes(1);
    expect(onTestFailure).toHaveBeenCalledWith(
      expect.objectContaining({ passed: false, error: 'Backup verification failed' })
    );
  });

  it('calls onAlertRequired with severity=critical when verification fails', async () => {
    const { runner, onAlertRequired } = makeRunner({ verification: failedVerification });
    await runner.executeTest();

    expect(onAlertRequired).toHaveBeenCalledTimes(1);
    const alertArg = onAlertRequired.mock.calls[0][0];
    expect(alertArg.severity).toBe('critical');
    expect(alertArg.title).toMatch(/restore test failed/i);
    expect(alertArg.testId).toBeTruthy();
  });

  it('stores the failed result in lastTestResult', async () => {
    const { runner } = makeRunner({ verification: failedVerification });
    const result = await runner.executeTest();

    expect(runner.getLastResult()).toBe(result);
    expect(runner.getLastResult().passed).toBe(false);
  });
});

// ─── executeTest — incomplete backup (row count mismatch) ────────────────────

describe('RestoreTestRunner.executeTest — incomplete backup', () => {
  const incompleteVerification = {
    backupId: 'backup_incomplete',
    passed:   false,
    checkedAt: new Date().toISOString(),
    details:  {
      integrityOk: true,
      rowCounts: { users: 10, transactions: 20, recurring_donations: 0 },
      sourceRowCounts: { users: 10, transactions: 50, recurring_donations: 5 },
      rowCountMismatches: [
        { table: 'transactions',      backup: 20, source: 50 },
        { table: 'recurring_donations', backup: 0, source: 5  },
      ],
    },
  };

  it('reports passed=false for an incomplete backup', async () => {
    const { runner } = makeRunner({ verification: incompleteVerification });
    const result = await runner.executeTest();

    expect(result.passed).toBe(false);
  });

  it('fires an alert for an incomplete backup', async () => {
    const { runner, onAlertRequired } = makeRunner({ verification: incompleteVerification });
    await runner.executeTest();

    expect(onAlertRequired).toHaveBeenCalledTimes(1);
  });
});

// ─── executeTest — no backups available ───────────────────────────────────────

describe('RestoreTestRunner.executeTest — no backups available', () => {
  it('throws (rejects) when listBackups returns an empty array', async () => {
    const { runner } = makeRunner({ backups: [] });

    await expect(runner.executeTest()).rejects.toThrow(/no backups/i);
  });

  it('calls onTestFailure when no backups are available', async () => {
    const { runner, onTestFailure } = makeRunner({ backups: [] });

    await expect(runner.executeTest()).rejects.toThrow();
    expect(onTestFailure).toHaveBeenCalledTimes(1);
  });

  it('calls onAlertRequired with severity=high when no backups are available', async () => {
    const { runner, onAlertRequired } = makeRunner({ backups: [] });

    await expect(runner.executeTest()).rejects.toThrow();
    expect(onAlertRequired).toHaveBeenCalledTimes(1);
    expect(onAlertRequired.mock.calls[0][0].severity).toBe('high');
  });

  it('sets status=error and stores lastTestResult even after throwing', async () => {
    const { runner } = makeRunner({ backups: [] });

    await expect(runner.executeTest()).rejects.toThrow();
    expect(runner.getLastResult()).not.toBeNull();
    expect(runner.getLastResult().status).toBe('error');
  });
});

// ─── executeTest — listBackups() rejects ──────────────────────────────────────

describe('RestoreTestRunner.executeTest — listBackups() network/DB error', () => {
  it('propagates the rejection', async () => {
    const { runner } = makeRunner();
    runner.backupService.listBackups.mockRejectedValue(new Error('S3 unreachable'));

    await expect(runner.executeTest()).rejects.toThrow('S3 unreachable');
  });

  it('fires onTestFailure when listBackups rejects', async () => {
    const { runner, onTestFailure } = makeRunner();
    runner.backupService.listBackups.mockRejectedValue(new Error('db down'));

    await expect(runner.executeTest()).rejects.toThrow();
    expect(onTestFailure).toHaveBeenCalledTimes(1);
  });

  it('fires onAlertRequired when listBackups rejects', async () => {
    const { runner, onAlertRequired } = makeRunner();
    runner.backupService.listBackups.mockRejectedValue(new Error('timeout'));

    await expect(runner.executeTest()).rejects.toThrow();
    expect(onAlertRequired).toHaveBeenCalledTimes(1);
  });
});

// ─── executeTest — verifyBackup() rejects ────────────────────────────────────

describe('RestoreTestRunner.executeTest — verifyBackup() throws', () => {
  it('propagates the error', async () => {
    const { runner } = makeRunner();
    runner.backupService.verifyBackup.mockRejectedValue(new Error('decryption failed'));

    await expect(runner.executeTest()).rejects.toThrow('decryption failed');
  });

  it('fires alerts when verifyBackup rejects', async () => {
    const { runner, onAlertRequired } = makeRunner();
    runner.backupService.verifyBackup.mockRejectedValue(new Error('io error'));

    await expect(runner.executeTest()).rejects.toThrow();
    expect(onAlertRequired).toHaveBeenCalledTimes(1);
  });
});

// ─── start / stop lifecycle ───────────────────────────────────────────────────

describe('RestoreTestRunner start/stop', () => {
  it('start() schedules a cron task with the configured expression', () => {
    const { runner } = makeRunner({}, { schedule: '0 2 * * *' });
    runner.start();

    expect(timerRegistry.scheduleCron).toHaveBeenCalledWith('0 2 * * *', expect.any(Function));
    runner.stop();
  });

  it('start() uses the default schedule when none is provided', () => {
    const backupService = makeMockBackupService();
    const runner = new RestoreTestRunner({ backupService });
    runner.start();

    const usedSchedule = timerRegistry.scheduleCron.mock.calls[0][0];
    expect(usedSchedule).toBe('0 3 * * *');
    runner.stop();
  });

  it('start() does not create a second cron task when called twice', () => {
    const { runner } = makeRunner();
    runner.start();
    runner.start(); // second call should be a no-op

    // timerRegistry.scheduleCron was called only once
    expect(timerRegistry.scheduleCron).toHaveBeenCalledTimes(1);
    runner.stop();
  });

  it('stop() calls task.stop() and task.destroy()', () => {
    const { runner } = makeRunner();
    runner.start();
    runner.stop();

    expect(mockCronTask.stop).toHaveBeenCalledTimes(1);
    expect(mockCronTask.destroy).toHaveBeenCalledTimes(1);
  });

  it('stop() clears the internal task reference', () => {
    const { runner } = makeRunner();
    runner.start();
    runner.stop();

    expect(runner.getStatus().running).toBe(false);
  });

  it('stop() does not throw when called on a stopped runner', () => {
    const { runner } = makeRunner();
    // Runner was never started
    expect(() => runner.stop()).not.toThrow();
  });
});

// ─── getStatus / getLastResult ────────────────────────────────────────────────

describe('RestoreTestRunner.getStatus and getLastResult', () => {
  it('getStatus returns running=false before start()', () => {
    const { runner } = makeRunner();
    expect(runner.getStatus().running).toBe(false);
  });

  it('getStatus returns running=true after start()', () => {
    const { runner } = makeRunner();
    runner.start();
    expect(runner.getStatus().running).toBe(true);
    runner.stop();
  });

  it('getStatus includes the configured schedule', () => {
    const { runner } = makeRunner({}, { schedule: '0 4 * * *' });
    expect(runner.getStatus().schedule).toBe('0 4 * * *');
  });

  it('getStatus includes lastTestResult', async () => {
    const { runner } = makeRunner();
    expect(runner.getStatus().lastTestResult).toBeNull();

    const result = await runner.executeTest();
    expect(runner.getStatus().lastTestResult).toBe(result);
  });

  it('getLastResult() returns null before any test is run', () => {
    const { runner } = makeRunner();
    expect(runner.getLastResult()).toBeNull();
  });

  it('getLastResult() returns the most recent test result', async () => {
    const { runner } = makeRunner();

    const first = await runner.executeTest();
    // Run again — lastTestResult should be updated
    const second = await runner.executeTest();

    expect(runner.getLastResult()).toBe(second);
    expect(runner.getLastResult()).not.toBe(first);
  });
});
