/**
 * Retention Service - Data Retention Policy Enforcement
 *
 * RESPONSIBILITY: Anonymize or delete expired records per configurable retention periods
 * OWNER: Backend Team
 * DEPENDENCIES: Database
 *
 * Supports three independent retention windows via environment variables:
 *   RETENTION_DONATIONS_DAYS    (default: 2555, ~7 years) — anonymise donation records
 *   RETENTION_AUDIT_LOGS_DAYS   (default: 365)            — delete audit log entries
 *   RETENTION_IDEMPOTENCY_DAYS  (default: 30)             — delete idempotency keys
 *
 * Set any period to 0 to disable purging for that data type.
 * Set RETENTION_DRY_RUN=true to log what would be deleted without deleting.
 * Scheduling: defaults to 02:00 UTC daily, override with RETENTION_SCHEDULE_CRON="HH:MM".
 *
 * Anonymization replaces PII with SHA-256 hashes so aggregate analytics remain valid.
 */

const crypto = require('crypto');
const Database = require('../utils/database');
const log = require('../utils/log');
const timerRegistry = require('../utils/timerRegistry');
const config = require('../config');
const { MS_PER_DAY, DB_ESTIMATED_ROW_BYTES, DEFAULT_RETENTION_SCHEDULE } = require('../constants');

/**
 * Reads the configured retention period (days) for a given category.
 * Falls back to the unified default defined in config.retention.
 */
function resolveRetentionDays(category) {
  switch (category) {
    case 'donations': return config.retention.donationsDays;
    case 'auditLogs': return config.retention.auditLogsDays;
    case 'idempotency': return config.retention.idempotencyDays;
    default: throw new Error(`Unknown retention category: ${category}`);
  }
}

/**
 * One-way hash of a PII string for anonymization.
 * @param {string} value
 * @returns {string} hex digest prefixed with 'anon:'
 */
function anonymize(value) {
  if (!value) return value;
  return 'anon:' + crypto.createHash('sha256').update(String(value)).digest('hex');
}

/**
 * ISO cutoff date string for a given number of days in the past.
 * @param {number} days
 * @returns {string}
 */
function cutoffDate(days) {
  return new Date(Date.now() - days * MS_PER_DAY).toISOString();
}

/** Parse RETENTION_SCHEDULE_CRON into [hour, minute]; default read from config.retention.scheduleCron. */
function parseScheduleTime() {
  const raw = config.retention.scheduleCron || '';
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (match) {
    const h = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return [h, m];
  }
  // Also accept cron syntax "MM HH * * *"
  const cronMatch = raw.match(/^(\d+)\s+(\d+)\s/);
  if (cronMatch) {
    const m = parseInt(cronMatch[1], 10);
    const h = parseInt(cronMatch[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return [h, m];
  }
  // Last resort: parse the canonical default from src/constants/domain.js.
  const { DEFAULT_RETENTION_SCHEDULE } = require('../constants');
  const fallback = typeof DEFAULT_RETENTION_SCHEDULE === 'string' ? DEFAULT_RETENTION_SCHEDULE : '02:00';
  const fallbackMatch = fallback.match(/^(\d{1,2}):(\d{2})$/);
  if (fallbackMatch) {
    return [parseInt(fallbackMatch[1], 10), parseInt(fallbackMatch[2], 10)];
  }
  return [2, 0];
}

class RetentionService {
  constructor() {
    this._timer = null;
  }

  get dryRun() {
    return process.env.RETENTION_DRY_RUN === 'true';
  }

  /**
   * Anonymise donation (transaction) records older than RETENTION_DONATIONS_DAYS.
   * Replaces memo with a pseudonymous hash. Returns 0 immediately if period is 0.
   * @param {number} [days]
   * @returns {Promise<{purged: number, remaining: number, durationMs: number}>}
   */
  async runDonationRetention(days) {
    const retentionDays = days !== undefined ? days : resolveRetentionDays('donations');
    if (retentionDays === 0) return { purged: 0, remaining: 0, durationMs: 0 };

    const start = Date.now();
    const cutoff = cutoffDate(retentionDays);

    const rows = await Database.query(
      `SELECT id, memo FROM transactions WHERE timestamp < ? AND (memo IS NOT NULL AND memo NOT LIKE 'anon:%')`,
      [cutoff]
    );

    if (!this.dryRun) {
      for (const row of rows) {
        await Database.run(
          `UPDATE transactions SET memo = ? WHERE id = ?`,
          [anonymize(row.memo), row.id]
        );
      }
    }

    const remaining = await Database.get(
      `SELECT COUNT(*) as n FROM transactions WHERE memo NOT LIKE 'anon:%' OR memo IS NULL`
    ).catch(() => ({ n: 0 }));

    const durationMs = Date.now() - start;
    log.info('RETENTION_SERVICE', this.dryRun ? '[DRY RUN] Would anonymise donations' : 'Anonymised donations', {
      dataType: 'donations', purged: rows.length, remaining: remaining.n, retentionDays, cutoff, durationMs,
    });
    return { purged: rows.length, remaining: remaining.n, durationMs };
  }

  /**
   * Delete audit log entries older than RETENTION_AUDIT_LOGS_DAYS.
   * @param {number} [days]
   * @returns {Promise<{purged: number, remaining: number, durationMs: number}>}
   */
  async runAuditLogRetention(days) {
    const retentionDays = days !== undefined ? days : resolveRetentionDays('auditLogs');
    if (retentionDays === 0) return { purged: 0, remaining: 0, durationMs: 0 };

    const start = Date.now();
    const cutoff = cutoffDate(retentionDays);

    let purged = 0;
    if (!this.dryRun) {
      const result = await Database.run(`DELETE FROM audit_logs WHERE timestamp < ?`, [cutoff]);
      purged = result && result.changes != null ? result.changes : 0;
    } else {
      const preview = await Database.get(`SELECT COUNT(*) as n FROM audit_logs WHERE timestamp < ?`, [cutoff]).catch(() => ({ n: 0 }));
      purged = preview.n;
    }

    const remaining = await Database.get('SELECT COUNT(*) as n FROM audit_logs').catch(() => ({ n: 0 }));
    const durationMs = Date.now() - start;
    log.info('RETENTION_SERVICE', this.dryRun ? '[DRY RUN] Would delete audit logs' : 'Deleted audit logs', {
      dataType: 'auditLogs', purged, remaining: remaining.n, retentionDays, cutoff, durationMs,
    });
    return { purged, remaining: remaining.n, durationMs };
  }

  /**
   * Delete expired idempotency keys older than RETENTION_IDEMPOTENCY_DAYS.
   * @param {number} [days]
   * @returns {Promise<{purged: number, remaining: number, durationMs: number}>}
   */
  async runIdempotencyRetention(days) {
    const retentionDays = days !== undefined ? days : resolveRetentionDays('idempotency');
    if (retentionDays === 0) return { purged: 0, remaining: 0, durationMs: 0 };

    const start = Date.now();
    const cutoff = cutoffDate(retentionDays);

    let purged = 0;
    if (!this.dryRun) {
      const result = await Database.run(`DELETE FROM idempotency_keys WHERE createdAt < ?`, [cutoff]);
      purged = result && result.changes != null ? result.changes : 0;
    } else {
      const preview = await Database.get(`SELECT COUNT(*) as n FROM idempotency_keys WHERE createdAt < ?`, [cutoff]).catch(() => ({ n: 0 }));
      purged = preview.n;
    }

    const remaining = await Database.get('SELECT COUNT(*) as n FROM idempotency_keys').catch(() => ({ n: 0 }));
    const durationMs = Date.now() - start;
    log.info('RETENTION_SERVICE', this.dryRun ? '[DRY RUN] Would delete idempotency keys' : 'Deleted idempotency keys', {
      dataType: 'idempotencyKeys', purged, remaining: remaining.n, retentionDays, cutoff, durationMs,
    });
    return { purged, remaining: remaining.n, durationMs };
  }

  /**
   * Hard-delete cancelled recurring donation schedules older than RETENTION_DONATIONS_DAYS.
   * Cancelled schedules are soft-deleted (status='cancelled', cancelledAt set) to preserve
   * audit trail, but old ones can be hard-deleted after the retention period.
   * @returns {Promise<{purged: number, remaining: number, durationMs: number}>}
   */
  async runCancelledSchedulesRetention() {
    const retentionDays = resolveRetentionDays('donations');
    if (retentionDays === 0) return { purged: 0, remaining: 0, durationMs: 0 };

    const start = Date.now();
    const cutoff = cutoffDate(retentionDays);

    let purged = 0;
    if (!this.dryRun) {
      const result = await Database.run(
        `DELETE FROM recurring_donations WHERE status = 'cancelled' AND cancelledAt < ?`,
        [cutoff]
      ).catch(() => ({ changes: 0 }));
      purged = result && result.changes != null ? result.changes : 0;
    } else {
      const preview = await Database.get(
        `SELECT COUNT(*) as n FROM recurring_donations WHERE status = 'cancelled' AND cancelledAt < ?`,
        [cutoff]
      ).catch(() => ({ n: 0 }));
      purged = preview.n;
    }

    const remaining = await Database.get(
      'SELECT COUNT(*) as n FROM recurring_donations WHERE status = \'cancelled\''
    ).catch(() => ({ n: 0 }));
    const durationMs = Date.now() - start;
    log.info('RETENTION_SERVICE', this.dryRun ? '[DRY RUN] Would hard-delete cancelled schedules' : 'Hard-deleted cancelled schedules', {
      dataType: 'cancelledSchedules', purged, remaining: remaining.n, retentionDays, cutoff, durationMs,
    });
    return { purged, remaining: remaining.n, durationMs };
  }

  /**
   * Run all four retention jobs and return a combined summary.
   * @returns {Promise<{donations: Object, auditLogs: Object, idempotencyKeys: Object, cancelledSchedules: Object}>}
   */
  async runAll() {
    const runStart = Date.now();
    const [donations, auditLogs, idempotencyKeys, cancelledSchedules] = await Promise.all([
      this.runDonationRetention(),
      this.runAuditLogRetention(),
      this.runIdempotencyRetention(),
      this.runCancelledSchedulesRetention(),
    ]);
    log.info('RETENTION_SERVICE', 'Full retention run complete', {
      donations: donations.purged, auditLogs: auditLogs.purged,
      idempotencyKeys: idempotencyKeys.purged, cancelledSchedules: cancelledSchedules.purged,
      totalDurationMs: Date.now() - runStart,
      dryRun: this.dryRun,
    });
    return { donations, auditLogs, idempotencyKeys, cancelledSchedules };
  }

  /**
   * Preview what would be purged without actually deleting.
   * Returns counts and date ranges for each data type.
   * @returns {Promise<Object>} Preview object with counts and size estimates
   */
  async preview() {
    const donationDays = resolveRetentionDays('donations');
    const auditLogDays = resolveRetentionDays('auditLogs');
    const idempotencyDays = resolveRetentionDays('idempotency');

    const donationCutoff = donationDays > 0 ? cutoffDate(donationDays) : null;
    const auditLogCutoff = auditLogDays > 0 ? cutoffDate(auditLogDays) : null;
    const idempotencyCutoff = idempotencyDays > 0 ? cutoffDate(idempotencyDays) : null;

    const [donationPreview, auditLogPreview, idempotencyPreview] = await Promise.all([
      donationDays > 0
        ? Database.get(
            `SELECT COUNT(*) as count, MIN(timestamp) as oldestRecord, MAX(timestamp) as newestRecord FROM transactions WHERE timestamp < ?`,
            [donationCutoff]
          ).catch(() => ({ count: 0, oldestRecord: null, newestRecord: null }))
        : { count: 0, oldestRecord: null, newestRecord: null },
      auditLogDays > 0
        ? Database.get(
            `SELECT COUNT(*) as count, MIN(timestamp) as oldestRecord, MAX(timestamp) as newestRecord FROM audit_logs WHERE timestamp < ?`,
            [auditLogCutoff]
          ).catch(() => ({ count: 0, oldestRecord: null, newestRecord: null }))
        : { count: 0, oldestRecord: null, newestRecord: null },
      idempotencyDays > 0
        ? Database.get(
            `SELECT COUNT(*) as count, MIN(createdAt) as oldestRecord, MAX(createdAt) as newestRecord FROM idempotency_keys WHERE createdAt < ?`,
            [idempotencyCutoff]
          ).catch(() => ({ count: 0, oldestRecord: null, newestRecord: null }))
        : { count: 0, oldestRecord: null, newestRecord: null },
    ]);

    // Estimate sizes (rough approximation) — see DB_ESTIMATED_ROW_BYTES in src/constants/domain.js
    const estimateDonationSize = donationPreview.count * DB_ESTIMATED_ROW_BYTES.DONATION;
    const estimateAuditLogSize = auditLogPreview.count * DB_ESTIMATED_ROW_BYTES.AUDIT_LOG;
    const estimateIdempotencySize = idempotencyPreview.count * DB_ESTIMATED_ROW_BYTES.IDEMPOTENCY_KEY;

    const totalEstimatedSize = estimateDonationSize + estimateAuditLogSize + estimateIdempotencySize;

    return {
      donations: {
        count: donationPreview.count,
        oldestRecord: donationPreview.oldestRecord,
        newestRecord: donationPreview.newestRecord,
        estimatedSizeBytes: estimateDonationSize,
        retentionDays: donationDays,
      },
      auditLogs: {
        count: auditLogPreview.count,
        oldestRecord: auditLogPreview.oldestRecord,
        newestRecord: auditLogPreview.newestRecord,
        estimatedSizeBytes: estimateAuditLogSize,
        retentionDays: auditLogDays,
      },
      idempotencyKeys: {
        count: idempotencyPreview.count,
        oldestRecord: idempotencyPreview.oldestRecord,
        newestRecord: idempotencyPreview.newestRecord,
        estimatedSizeBytes: estimateIdempotencySize,
        retentionDays: idempotencyDays,
      },
      totalEstimatedSizeBytes: totalEstimatedSize,
    };
  }

  /**
   * Return current retention configuration and record counts per data type.
   * @returns {Promise<Object>} Status object
   */
  async getStatus() {
    const retentionSnapshot = {
      donationRetentionDays: resolveRetentionDays('donations'),
      auditLogRetentionDays: resolveRetentionDays('auditLogs'),
      idempotencyRetentionDays: resolveRetentionDays('idempotency'),
      dryRun: this.dryRun,
      scheduleCron: config.retention.scheduleCron,
    };

    const [txTotal, txAnon, auditTotal, idempotencyTotal] = await Promise.all([
      Database.get('SELECT COUNT(*) as n FROM transactions').catch(() => ({ n: 0 })),
      Database.get(`SELECT COUNT(*) as n FROM transactions WHERE memo LIKE 'anon:%'`).catch(() => ({ n: 0 })),
      Database.get('SELECT COUNT(*) as n FROM audit_logs').catch(() => ({ n: 0 })),
      Database.get('SELECT COUNT(*) as n FROM idempotency_keys').catch(() => ({ n: 0 })),
    ]);

    return {
      config,
      stats: {
        donations: { total: txTotal.n, anonymized: txAnon.n },
        auditLogs: { total: auditTotal.n },
        idempotencyKeys: { total: idempotencyTotal.n },
      },
    };
  }

  /** Schedule a daily retention run at the configured UTC time. */
  start() {
    if (this._timer) return;
    const [h, m] = parseScheduleTime();
    const scheduleTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} UTC`;
    log.info('RETENTION_SERVICE', 'Scheduled daily retention run', {
      scheduledAt: scheduleTime,
      donationDays: resolveRetentionDays('donations'),
      auditLogDays: resolveRetentionDays('auditLogs'),
      idempotencyDays: resolveRetentionDays('idempotency'),
      dryRun: this.dryRun,
    });
    this._scheduleNext();
  }

  _scheduleNext() {
    const [h, m] = parseScheduleTime();
    const now = new Date();
    const next = new Date();
    next.setUTCHours(h, m, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    const delay = next.getTime() - now.getTime();
    log.debug('RETENTION_SERVICE', 'Scheduling next run', { delayMs: delay, hour: h, minute: m });
    this._timer = timerRegistry.createTimeout(() => {
      this.runAll().catch(err =>
        log.error('RETENTION_SERVICE', 'Scheduled run failed', { error: err.message })
      );
      this._timer = null;
      this._scheduleNext();
    }, delay, 'retention-service-daily');
    this._timer.unref();
  }

  stop() {
    if (this._timer) {
      this._timer.clear();
      this._timer = null;
    }
  }
}

module.exports = new RetentionService();
module.exports.RetentionService = RetentionService;
module.exports.anonymize = anonymize;
module.exports.cutoffDate = cutoffDate;
