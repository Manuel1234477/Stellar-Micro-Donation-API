'use strict';

exports.name = '003_audit_logs';

exports.up = async (db) => {
  await db.run(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.run(`CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_audit_logs_category ON audit_logs(category)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_audit_logs_severity ON audit_logs(severity)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_audit_logs_userId ON audit_logs(userId)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_audit_logs_requestId ON audit_logs(requestId)`);
};
