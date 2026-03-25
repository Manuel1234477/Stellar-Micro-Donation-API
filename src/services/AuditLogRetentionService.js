/**
 * Audit Log Retention Service
 *
 * Enforces configurable retention policy on audit_logs.
 * Entries older than the retention window are archived to audit_logs_archive
 * and removed from the live table. Runs on a configurable interval.
 *
 * Default retention: 90 days (AUDIT_LOG_RETENTION_DAYS env var).
 */

const db = require('../utils/database');
const log = require('../utils/log');

const RETENTION_DAYS = parseInt(process.env.AUDIT_LOG_RETENTION_DAYS || '90', 10);
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

class AuditLogRetentionService {
  constructor(intervalMs = DEFAULT_INTERVAL_MS) {
    this.intervalMs = intervalMs;
    this._timer = null;
  }

  async _ensureArchiveTable() {
    await db.run(`
      CREATE TABLE IF NOT EXISTS audit_logs_archive (
        id INTEGER PRIMARY KEY,
        timestamp TEXT NOT NULL,
        category TEXT NOT NULL,
        action TEXT NOT NULL,
        severity TEXT NOT NULL,
        result TEXT NOT NULL,
        userId TEXT,
        requestId TEXT,
        ipAddress TEXT,
        resource TEXT,
        reason TEXT,
        details TEXT,
        integrityHash TEXT NOT NULL,
        archivedAt TEXT NOT NULL
      )
    `);
  }

  /**
   * Archive and delete audit log entries older than retentionDays.
   * @param {number} [retentionDays] - Override retention period.
   * @returns {Promise<number>} Number of entries archived.
   */
  async runRetention(retentionDays = RETENTION_DAYS) {
    await this._ensureArchiveTable();

    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

    const rows = await db.all(
      `SELECT * FROM audit_logs WHERE timestamp < ?`,
      [cutoff]
    );

    if (rows.length === 0) return 0;

    const archivedAt = new Date().toISOString();
    for (const row of rows) {
      await db.run(
        `INSERT OR IGNORE INTO audit_logs_archive
          (id, timestamp, category, action, severity, result, userId, requestId, ipAddress, resource, reason, details, integrityHash, archivedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [row.id, row.timestamp, row.category, row.action, row.severity, row.result,
         row.userId, row.requestId, row.ipAddress, row.resource, row.reason,
         row.details, row.integrityHash, archivedAt]
      );
    }

    await db.run(`DELETE FROM audit_logs WHERE timestamp < ?`, [cutoff]);

    log.info('AUDIT_RETENTION', `Archived ${rows.length} audit log entries`, {
      retentionDays,
      cutoff,
      archivedCount: rows.length
    });

    return rows.length;
  }

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => {
      this.runRetention().catch(err =>
        log.error('AUDIT_RETENTION', 'Retention job failed', { error: err.message })
      );
    }, this.intervalMs);
    log.info('AUDIT_RETENTION', 'Retention service started', {
      retentionDays: RETENTION_DAYS,
      intervalHours: this.intervalMs / 3600000
    });
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }
}

module.exports = new AuditLogRetentionService();
