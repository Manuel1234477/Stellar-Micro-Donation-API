/**
 * Retention Service - Data Retention Policy Enforcement
 *
 * RESPONSIBILITY: Anonymize or delete expired records per configurable retention periods
 * OWNER: Backend Team
 * DEPENDENCIES: Database
 *
 * Supports three independent retention windows via environment variables:
 *   RETENTION_TRANSACTIONS_DAYS  (default: 365)
 *   RETENTION_AUDIT_LOGS_DAYS    (default: 90)
 *   RETENTION_USER_DATA_DAYS     (default: 730)
 *
 * Anonymization replaces PII with SHA-256 hashes so aggregate analytics remain valid.
 */

const crypto = require('crypto');
const Database = require('../utils/database');
const log = require('../utils/log');

/** @returns {number} */
function parseDays(envVar, defaultDays) {
  const v = parseInt(process.env[envVar], 10);
  return Number.isFinite(v) && v > 0 ? v : defaultDays;
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
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

class RetentionService {
  /**
   * Anonymize transactions older than RETENTION_TRANSACTIONS_DAYS.
   * Replaces memo with a hash; sender/receiver IDs are preserved for FK integrity.
   * @param {number} [days] - Override retention period
   * @returns {Promise<number>} Number of records anonymized
   */
  async runTransactionRetention(days) {
    const retentionDays = days !== undefined ? days : parseDays('RETENTION_TRANSACTIONS_DAYS', 365);
    const cutoff = cutoffDate(retentionDays);

    const rows = await Database.query(
      `SELECT id, memo FROM transactions WHERE timestamp < ? AND (memo IS NOT NULL AND memo NOT LIKE 'anon:%')`,
      [cutoff]
    );

    for (const row of rows) {
      await Database.run(
        `UPDATE transactions SET memo = ? WHERE id = ?`,
        [anonymize(row.memo), row.id]
      );
    }

    if (rows.length > 0) {
      log.info('RETENTION_SERVICE', 'Anonymized transactions', { count: rows.length, retentionDays, cutoff });
    }
    return rows.length;
  }

  /**
   * Delete audit log entries older than RETENTION_AUDIT_LOGS_DAYS.
   * @param {number} [days] - Override retention period
   * @returns {Promise<number>} Number of records deleted
   */
  async runAuditLogRetention(days) {
    const retentionDays = days !== undefined ? days : parseDays('RETENTION_AUDIT_LOGS_DAYS', 90);
    const cutoff = cutoffDate(retentionDays);

    const result = await Database.run(
      `DELETE FROM audit_logs WHERE timestamp < ?`,
      [cutoff]
    );

    const count = result && result.changes != null ? result.changes : 0;
    if (count > 0) {
      log.info('RETENTION_SERVICE', 'Deleted audit logs', { count, retentionDays, cutoff });
    }
    return count;
  }

  /**
   * Anonymize user PII (publicKey) for accounts older than RETENTION_USER_DATA_DAYS.
   * @param {number} [days] - Override retention period
   * @returns {Promise<number>} Number of records anonymized
   */
  async runUserDataRetention(days) {
    const retentionDays = days !== undefined ? days : parseDays('RETENTION_USER_DATA_DAYS', 730);
    const cutoff = cutoffDate(retentionDays);

    const rows = await Database.query(
      `SELECT id, publicKey FROM users WHERE createdAt < ? AND publicKey NOT LIKE 'anon:%'`,
      [cutoff]
    );

    for (const row of rows) {
      await Database.run(
        `UPDATE users SET publicKey = ? WHERE id = ?`,
        [anonymize(row.publicKey), row.id]
      );
    }

    if (rows.length > 0) {
      log.info('RETENTION_SERVICE', 'Anonymized user records', { count: rows.length, retentionDays, cutoff });
    }
    return rows.length;
  }

  /**
   * Run all three retention jobs and return a combined summary.
   * @returns {Promise<{transactions: number, auditLogs: number, userData: number}>}
   */
  async runAll() {
    const [transactions, auditLogs, userData] = await Promise.all([
      this.runTransactionRetention(),
      this.runAuditLogRetention(),
      this.runUserDataRetention(),
    ]);
    log.info('RETENTION_SERVICE', 'Full retention run complete', { transactions, auditLogs, userData });
    return { transactions, auditLogs, userData };
  }

  /**
   * Return current retention configuration and record counts per data type.
   * @returns {Promise<Object>} Status object
   */
  async getStatus() {
    const config = {
      transactionRetentionDays: parseDays('RETENTION_TRANSACTIONS_DAYS', 365),
      auditLogRetentionDays: parseDays('RETENTION_AUDIT_LOGS_DAYS', 90),
      userDataRetentionDays: parseDays('RETENTION_USER_DATA_DAYS', 730),
    };

    const [txTotal, txAnon, auditTotal, userTotal, userAnon] = await Promise.all([
      Database.get('SELECT COUNT(*) as n FROM transactions').catch(() => ({ n: 0 })),
      Database.get(`SELECT COUNT(*) as n FROM transactions WHERE memo LIKE 'anon:%'`).catch(() => ({ n: 0 })),
      Database.get('SELECT COUNT(*) as n FROM audit_logs').catch(() => ({ n: 0 })),
      Database.get('SELECT COUNT(*) as n FROM users').catch(() => ({ n: 0 })),
      Database.get(`SELECT COUNT(*) as n FROM users WHERE publicKey LIKE 'anon:%'`).catch(() => ({ n: 0 })),
    ]);

    return {
      config,
      stats: {
        transactions: { total: txTotal.n, anonymized: txAnon.n },
        auditLogs: { total: auditTotal.n },
        users: { total: userTotal.n, anonymized: userAnon.n },
      },
    };
  }
}

module.exports = new RetentionService();
module.exports.RetentionService = RetentionService;
module.exports.anonymize = anonymize;
module.exports.cutoffDate = cutoffDate;
