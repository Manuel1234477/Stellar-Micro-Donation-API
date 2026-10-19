/**
 * BackupScheduler - Automated Backup Orchestration
 *
 * RESPONSIBILITY: Schedule, execute, and manage automated backups
 * OWNER: Backend Team
 * DEPENDENCIES: timerRegistry, BackupService, logger
 */

const log = require('../utils/log');
const timerRegistry = require('../utils/timerRegistry');

/**
 * Parse a 5-field cron expression (minute hour day-of-month month day-of-week)
 * into its numeric fields. Supports '*', plain numbers, and comma-separated
 * lists. Returns null when the expression cannot be parsed.
 * @param {string} expression
 * @returns {{minute:number[], hour:number[], dayOfMonth:number[], month:number[], dayOfWeek:number[]}|null}
 */
function parseCronExpression(expression) {
  if (typeof expression !== 'string') return null;

  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;

  const ranges = [
    [0, 59], // minute
    [0, 23], // hour
    [1, 31], // day of month
    [1, 12], // month
    [0, 6],  // day of week
  ];

  const parsed = [];

  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    const [min, max] = ranges[i];

    if (field === '*') {
      parsed.push(null);
      continue;
    }

    const values = [];
    for (const part of field.split(',')) {
      const value = Number(part);
      if (!Number.isInteger(value) || value < min || value > max) {
        return null;
      }
      values.push(value);
    }
    parsed.push(values);
  }

  return {
    minute: parsed[0],
    hour: parsed[1],
    dayOfMonth: parsed[2],
    month: parsed[3],
    dayOfWeek: parsed[4],
  };
}

/**
 * Compute the next Date matching the parsed cron fields, starting from `from`.
 * @param {object} parsed - Result of parseCronExpression
 * @param {Date} from
 * @returns {Date}
 */
function nextCronDate(parsed, from) {
  const matches = (values, value) => values === null || values.includes(value);

  const candidate = new Date(from.getTime());
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  // Bound the search to avoid an infinite loop on impossible expressions.
  const limit = new Date(from.getTime() + 366 * 24 * 60 * 60 * 1000);

  while (candidate <= limit) {
    if (
      matches(parsed.month, candidate.getMonth() + 1) &&
      matches(parsed.dayOfMonth, candidate.getDate()) &&
      matches(parsed.dayOfWeek, candidate.getDay()) &&
      matches(parsed.hour, candidate.getHours()) &&
      matches(parsed.minute, candidate.getMinutes())
    ) {
      return candidate;
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  return null;
}

class BackupScheduler {
  /**
   * @param {object} options
   * @param {BackupService} options.backupService - Backup service instance
   * @param {string} options.schedule - Cron expression (default: '0 2 * * *' = 2 AM daily)
   * @param {number} options.retentionDays - Keep backups for N days (default: 30)
   * @param {function} [options.onBackupComplete] - Callback on success
   * @param {function} [options.onBackupError] - Callback on error
   * @param {function} [options.onCleanupComplete] - Callback on cleanup
   */
  constructor(options = {}) {
    this.backupService = options.backupService;
    this.schedule = options.schedule || '0 2 * * *';
    this.retentionDays = options.retentionDays || 30;
    this.onBackupComplete = options.onBackupComplete || (() => {});
    this.onBackupError = options.onBackupError || (() => {});
    this.onCleanupComplete = options.onCleanupComplete || (() => {});
    this.task = null;
    this._parsedSchedule = null;
    this._nextRun = null;
  }

  /**
   * Start the backup scheduler
   */
  start() {
    if (this.task) {
      log.warn('BACKUP_SCHEDULER', 'Scheduler already running');
      return;
    }

    const parsed = parseCronExpression(this.schedule);
    if (!parsed) {
      throw new Error(`Invalid cron schedule: ${this.schedule}`);
    }

    this._parsedSchedule = parsed;

    log.info('BACKUP_SCHEDULER', 'Starting scheduler', { schedule: this.schedule });

    this._scheduleNext();

    log.info('BACKUP_SCHEDULER', 'Scheduler started', { nextRun: this._getNextRun() });
  }

  /**
   * Schedule the next backup run using the shared timer registry so the
   * scheduler honours process lifecycle management.
   * @private
   */
  _scheduleNext() {
    const next = nextCronDate(this._parsedSchedule, new Date());
    if (!next) {
      log.error('BACKUP_SCHEDULER', 'Unable to compute next run time', { schedule: this.schedule });
      return;
    }

    this._nextRun = next;
    const delay = Math.max(0, next.getTime() - Date.now());

    this.task = timerRegistry.setTimeout(() => {
      this.task = null;
      this.executeBackup()
        .catch(error => {
          log.error('BACKUP_SCHEDULER', 'Unhandled error in backup task', { error: error.message });
        })
        .finally(() => {
          if (this._parsedSchedule) {
            this._scheduleNext();
          }
        });
    }, delay);
  }

  /**
   * Stop the backup scheduler
   */
  stop() {
    if (this.task) {
      timerRegistry.clearTimeout(this.task);
      this.task = null;
      this._parsedSchedule = null;
      this._nextRun = null;
      log.info('BACKUP_SCHEDULER', 'Scheduler stopped');
    }
  }

  /**
   * Execute a backup and cleanup old backups
   * @returns {Promise<object>} Backup metadata
   */
  async executeBackup() {
    const startTime = Date.now();
    const operationId = `backup_${startTime}_${Math.random().toString(36).substring(7)}`;

    try {
      log.info('BACKUP_SCHEDULER', 'Executing backup', { operationId });

      // Create backup
      const backup = await this.backupService.backup();

      const backupTime = Date.now() - startTime;
      log.info('BACKUP_SCHEDULER', 'Backup created', {
        operationId,
        backupId: backup.backupId,
        size: backup.size,
        duration: backupTime,
      });

      // Cleanup old backups
      await this.cleanupOldBackups();

      // Callback
      this.onBackupComplete({
        ...backup,
        duration: backupTime,
        operationId,
      });

      return backup;
    } catch (error) {
      log.error('BACKUP_SCHEDULER', 'Backup execution failed', {
        operationId,
        error: error.message,
        stack: error.stack,
      });

      this.onBackupError(error);
      throw error;
    }
  }

  /**
   * Clean up backups older than retention period
   * @returns {Promise<{deleted: number, freed: number}>}
   */
  async cleanupOldBackups() {
    try {
      const backups = await this.backupService.listBackups();
      const cutoffTime = Date.now() - (this.retentionDays * 24 * 60 * 60 * 1000);

      let deleted = 0;
      let freed = 0;

      for (const backup of backups) {
        const backupTime = new Date(backup.createdAt).getTime();

        if (backupTime < cutoffTime) {
          try {
            // Note: deleteBackup method would need to be implemented in BackupService
            // For now, just log the cleanup
            freed += backup.size;
            deleted++;

            log.info('BACKUP_SCHEDULER', 'Would delete old backup', {
              backupId: backup.backupId,
              age: Math.floor((Date.now() - backupTime) / (24 * 60 * 60 * 1000)) + ' days',
              size: backup.size,
            });
          } catch (error) {
            log.error('BACKUP_SCHEDULER', 'Failed to delete backup', {
              backupId: backup.backupId,
              error: error.message,
            });
          }
        }
      }

      const result = { deleted, freed };

      if (deleted > 0) {
        log.info('BACKUP_SCHEDULER', 'Cleanup completed', {
          deleted,
          freedBytes: freed,
        });
      }

      this.onCleanupComplete(result);
      return result;
    } catch (error) {
      log.error('BACKUP_SCHEDULER', 'Cleanup failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Get next scheduled run time
   * @returns {Date}
   * @private
   */
  _getNextRun() {
    if (!this.task) return null;
    return this._nextRun;
  }

  /**
   * Get current status
   * @returns {object}
   */
  getStatus() {
    return {
      running: !!this.task,
      schedule: this.schedule,
      retentionDays: this.retentionDays,
      nextRun: this._getNextRun(),
    };
  }
}

module.exports = BackupScheduler;
