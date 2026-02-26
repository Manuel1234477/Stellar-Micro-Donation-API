/**
 * Database Migration: Add Audit Logs Table
 * 
 * Creates immutable audit log table for security-sensitive operations.
 * Includes integrity hash for tamper detection.
 */

const Database = require('../../utils/database');

async function migrate() {
  console.log('Creating audit_logs table...');

  try {
    await Database.run(`
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

    // Create indexes for common queries
    await Database.run(`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp 
      ON audit_logs(timestamp)
    `);

    await Database.run(`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_category 
      ON audit_logs(category)
    `);

    await Database.run(`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_action 
      ON audit_logs(action)
    `);

    await Database.run(`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_severity 
      ON audit_logs(severity)
    `);

    await Database.run(`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_userId 
      ON audit_logs(userId)
    `);

    await Database.run(`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_requestId 
      ON audit_logs(requestId)
    `);

    console.log('✓ audit_logs table created successfully');
    console.log('✓ Indexes created for optimized queries');
  } catch (error) {
    console.error('✗ Migration failed:', error.message);
    throw error;
  }
}

// Run migration if called directly
if (require.main === module) {
  migrate()
    .then(() => {
      console.log('Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = { migrate };
