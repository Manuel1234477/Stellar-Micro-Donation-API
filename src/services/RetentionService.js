/**
 * Retention Service - Data Retention Policy Enforcement
 *
 * RESPONSIBILITY: Anonymize or delete expired records per configurable retention periods
 * OWNER: Backend Team
 * DEPENDENCIES: Database
 *
 * Supports independent retention windows via environment variables:
 *   RETENTION_DONATIONS_DAYS    (default: 2555, ~7 years) — anonymise donation records
 *   RETENTION_AUDIT_LOGS_DAYS   (default: 365)            — delete audit log entries
 *   RETENTION_IDEMPOTENCY_DAYS  (default: 30)             — delete idempotency keys
 *   RETENTION_TRANSACTION_DAYS  (default: 2555, ~7 years) — anonymise transaction memos/notes
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
const { MS_PER_DAY, DB_ESTIMATED_ROW_BYTES } = require('../constants');

/**
 * Reads the configured retention period (days) for a given category.
 * Falls back to the unified default defined in config.retention.
 */
function resolveRetentionDays(category) {
  switch (category) {
    case 'donations': return config.retention.donationsDays;
    case 'auditLogs': return config.retention.auditLogsDays;
    case 'idempotency': return config.retention.idempotencyDays;
    case 'transactions': return config.retention.transactionDays;
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
   * Anonymise transaction memos/notes and pseudonymise sender/receiver identifiers
   * older than RETENTION_TRANSACTION_DAYS. Amounts and hashes are preserved for
   * accounting. Returns 0 immediately if period is 0.
   * @param {number} [days]
   * @returns {Promise<{purged: number, remaining: number, durationMs: number}>}
   */
  async runTransactionRetention(days) {
    const retentionDays = days !== undefined ? days : resolveRetentionDays('transactions');
    if (retentionDays === 0) return { purged: 0, remaining: 0, durationMs: 0 };

    const start = Date.now();
    const cutoff = cutoffDate(retentionDays);

    const rows = await Database.query(
      `SELECT id, memo, notes, senderId, receiverId FROM transactions
       WHERE timestamp < ? AND (
         (memo IS NOT NULL AND memo NOT LIKE 'anon:%') OR
         (notes IS NOT NULL AND notes NOT LIKE 'anon:%') OR
         (senderId IS NOT NULL AND senderId NOT LIKE 'anon:%') OR
         (receiverId IS NOT NULL AND receiverId NOT LIKE 'anon:%')
       )`,
      [cutoff]
    );

    if (!this.dryRun) {
      for (const row of rows) {
        await Database.run(
          `UPDATE transactions SET memo = ?, notes = ?, senderId = ?, receiverId = ? WHERE id = ?`,
          [
            anonymize(row.memo),
            anonymize(row.notes),
            anonymize(row.senderId),
            anonymize(row.receiverId),
            row.id,
          ]
        );
      }
    }

    const remaining = await Database.get(
      `SELECT COUNT(*) as n FROM transactions WHERE timestamp < ? AND (
         (memo IS NOT NULL AND memo NOT LIKE 'anon:%') OR
         (notes IS NOT NULL AND notes NOT LIKE 'anon:%') OR
         (senderId IS NOT NULL AND senderId NOT LIKE 'anon:%') OR
         (receiverId IS NOT NULL AND receiverId NOT LIKE 'anon:%')
       )`,
      [cutoff]
    ).catch(() => ({ n: 0 }));

    const durationMs = Date.now() - start;
    log.info('RETENTION_SERVICE', this.dryRun ? '[DRY RUN] Would anonymise transactions' : 'Anonymised transactions', {
      dataType: 'transactions', purged: rows.length, remaining: remaining.n, retentionDays, cutoff, durationMs,
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
        `DELETE FROM recurring_donations WHERE status = 'cancelled' AND cancelledAt IS NOT NULL AND cancelledAt < ?`,
        [cutoff]
      );
      purged = result && result.changes != null ? result.changes : 0;
    } else {
      const preview = await Database.get(
        `SELECT COUNT(*) as n FROM recurring_donations WHERE status = 'cancelled' AND cancelledAt IS NOT NULL AND cancelledAt < ?`,
        [cutoff]
      ).catch(() => ({ n: 0 }));
      purged = preview.n;
    }

    const remaining = await Database.get(
      `SELECT COUNT(*) as n FROM recurring_donations WHERE status = 'cancelled'`
    ).catch(() => ({ n: 0 }));
    const durationMs = Date.now() - start;
    log.info('RETENTION_SERVICE', this.dryRun ? '[DRY RUN] Would delete cancelled schedules' : 'Deleted cancelled schedules', {
      dataType: 'cancelledSchedules', purged, remaining: remaining.n, retentionDays, cutoff, durationMs,
    });
    return { purged, remaining: remaining.n, durationMs };
  }

  /**
   * Run all retention policies. Returns a summary keyed by data type.
   * @returns {Promise<Object>}
   */
  async runAll() {
    const results = {};
    results.donations = await this.runDonationRetention();
    results.transactions = await this.runTransactionRetention();
    results.auditLogs = await this.runAuditLogRetention();
    results.idempotencyKeys = await this.runIdempotencyRetention();
    results.cancelledSchedules = await this.runCancelledSchedulesRetention();
    return results;
  }

  /**
   * Start the daily retention job. Idempotent.
   */
  start() {
    if (this._timer) return;
    const [hour, minute] = parseScheduleTime();
    const scheduleNext = () => {
      const now = new Date();
      const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute, 0, 0));
      if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
      const delay = next.getTime() - now.getTime();
      this._timer = timerRegistry.setTimeout(async () => {
        try {
          await this.runAll();
        } catch (err) {
          log.error('RETENTION_SERVICE', 'Retention run failed', { error: err.message });
        }
        scheduleNext();
      }, delay);
    };
    scheduleNext();
    log.info('RETENTION_SERVICE', 'Retention scheduler started', { hour, minute });
  }

  /**
   * Stop the scheduled retention job.
   */
  stop() {
    if (this._timer) {
      timerRegistry.clearTimeout(this._timer);
      this._timer = null;
    }
  }
}

module.exports = new RetentionService();
module.exports.RetentionService = RetentionService;
module.exports.anonymize = anonymize;
module.exports.cutoffDate = cutoffDate;
