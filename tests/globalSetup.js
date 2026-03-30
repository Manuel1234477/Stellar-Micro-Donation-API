// Global setup - runs once before all test suites
process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-key-1,test-key-2,test-key,admin-test-key';
process.env.NODE_ENV = 'test';

module.exports = async () => {
  // Delete stale DB file so tables are always created fresh with correct schema
  const fs = require('fs');
  const path = require('path');
  const dbPath = path.join(__dirname, '../data/stellar_donations.db');
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }

  try {
    const Database = require('../src/utils/database');
    // Create required tables
    await Database.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      publicKey TEXT NOT NULL UNIQUE,
      encryptedSecret TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      daily_limit REAL DEFAULT NULL,
      monthly_limit REAL DEFAULT NULL,
      per_transaction_limit REAL DEFAULT NULL
    )`);
    await Database.run(`CREATE TABLE IF NOT EXISTS idempotency_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      idempotencyKey TEXT NOT NULL UNIQUE,
      requestHash TEXT,
      response TEXT,
      userId TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      expiresAt DATETIME
    )`);
    await Database.run(`CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      senderId INTEGER NOT NULL,
      receiverId INTEGER NOT NULL,
      amount REAL NOT NULL,
      memo TEXT,
      notes TEXT,
      tags TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME DEFAULT NULL,
      idempotencyKey TEXT UNIQUE,
      stellar_tx_id TEXT UNIQUE,
      is_orphan INTEGER NOT NULL DEFAULT 0,
      campaign_id INTEGER,
      validAfter INTEGER DEFAULT 0,
      validBefore INTEGER DEFAULT 0
    )`);
    await Database.run(`CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'active',
      created_by TEXT,
      metadata TEXT,
      expires_at INTEGER,
      last_used_at INTEGER,
      deprecated_at INTEGER,
      revoked_at INTEGER,
      created_at INTEGER NOT NULL,
      grace_period_days INTEGER NOT NULL DEFAULT 30,
      rotated_to_id INTEGER,
      signing_required INTEGER NOT NULL DEFAULT 0,
      key_secret TEXT,
      scopes TEXT,
      allowed_ips TEXT,
      notification_email TEXT,
      last_expiry_notification_sent_at INTEGER,
      monthly_quota INTEGER,
      quota_used INTEGER NOT NULL DEFAULT 0,
      quota_reset_at INTEGER,
      tenant_id TEXT NOT NULL DEFAULT 'default'
    )`);
    await Database.run(`CREATE TABLE IF NOT EXISTS student_fees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId TEXT NOT NULL,
      description TEXT NOT NULL,
      totalAmount REAL NOT NULL,
      paidAmount REAL NOT NULL DEFAULT 0,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    await Database.run(`CREATE TABLE IF NOT EXISTS fee_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feeId INTEGER NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      paidAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (feeId) REFERENCES student_fees(id)
    )`);
    await Database.run(`CREATE TABLE IF NOT EXISTS recovery_guardians (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      walletId INTEGER NOT NULL,
      guardianPublicKey TEXT NOT NULL,
      threshold INTEGER,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (walletId, guardianPublicKey)
    )`);
    await Database.run(`CREATE TABLE IF NOT EXISTS recovery_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      walletId INTEGER NOT NULL,
      newPublicKey TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      threshold INTEGER NOT NULL,
      executeAfter DATETIME NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      executedAt DATETIME
    )`);
    await Database.run(`CREATE TABLE IF NOT EXISTS recovery_approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recoveryRequestId INTEGER NOT NULL,
      guardianPublicKey TEXT NOT NULL,
      approvedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (recoveryRequestId, guardianPublicKey)
    )`);
    await Database.run(`CREATE TABLE IF NOT EXISTS audit_logs (
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
      integrityHash TEXT NOT NULL
    )`);
    await Database.run(`CREATE TABLE IF NOT EXISTS multisig_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_xdr TEXT NOT NULL,
      network_passphrase TEXT NOT NULL,
      required_signers INTEGER NOT NULL,
      signer_keys TEXT NOT NULL,
      collected_signatures TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending',
      stellar_tx_hash TEXT,
      stellar_ledger INTEGER,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    await Database.run(`CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      goal_amount REAL NOT NULL,
      current_amount REAL DEFAULT 0,
      start_date DATETIME,
      end_date DATETIME,
      status TEXT DEFAULT 'active',
      created_by INTEGER,
      funding_model TEXT NOT NULL DEFAULT 'keep-what-you-raise',
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME DEFAULT NULL,
      tenant_id TEXT NOT NULL DEFAULT 'default'
    )`);
    await Database.run(`CREATE TABLE IF NOT EXISTS escrow_pledges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      donor_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'held',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    await Database.run(`CREATE TABLE IF NOT EXISTS recurring_donations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      donorId INTEGER NOT NULL,
      recipientId INTEGER NOT NULL,
      amount REAL NOT NULL,
      frequency TEXT NOT NULL,
      nextExecutionDate DATETIME NOT NULL,
      lastExecutionDate DATETIME,
      startDate DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'active',
      executionCount INTEGER DEFAULT 0,
      failureCount INTEGER DEFAULT 0,
      maxExecutions INTEGER,
      customIntervalDays INTEGER,
      webhookUrl TEXT,
      pausedAt DATETIME,
      resumedAt DATETIME,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (donorId) REFERENCES users(id),
      FOREIGN KEY (recipientId) REFERENCES users(id)
    )`);
    await Database.run(`CREATE TABLE IF NOT EXISTS wallet_merge_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sourceWalletId INTEGER NOT NULL,
      sourcePublicKey TEXT NOT NULL,
      destinationPublicKey TEXT NOT NULL,
      mergedAmount TEXT,
      transactionHash TEXT,
      ledger INTEGER,
      performedBy TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    // Add mergedAt/mergedInto columns to users if not present
    try {
      await Database.run(`ALTER TABLE users ADD COLUMN mergedAt DATETIME`);
    } catch (_) {}
    try {
      await Database.run(`ALTER TABLE users ADD COLUMN mergedInto TEXT`);
    } catch (_) {}
    // Add pausedAt/resumedAt to recurring_donations if not present (for existing DBs)
    try {
      await Database.run(`ALTER TABLE recurring_donations ADD COLUMN pausedAt DATETIME`);
    } catch (_) {}
    try {
      await Database.run(`ALTER TABLE recurring_donations ADD COLUMN resumedAt DATETIME`);
    } catch (_) {}

    // Smart donation routing tables (migration 005 + 006)
    await Database.run(`CREATE TABLE IF NOT EXISTS recipient_pools (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      name      TEXT    NOT NULL UNIQUE,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    await Database.run(`CREATE TABLE IF NOT EXISTS recipient_pool_members (
      pool_name         TEXT NOT NULL REFERENCES recipient_pools(name) ON DELETE CASCADE,
      recipient_id      TEXT NOT NULL,
      latitude          REAL,
      longitude         REAL,
      campaign_deadline DATETIME,
      display_name      TEXT,
      weight            REAL DEFAULT 1,
      priority          REAL DEFAULT 0,
      PRIMARY KEY (pool_name, recipient_id)
    )`);
    await Database.run(`CREATE TABLE IF NOT EXISTS round_robin_state (
      pool_name  TEXT PRIMARY KEY,
      next_index INTEGER NOT NULL DEFAULT 0,
      updatedAt  DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    await Database.run(`CREATE TABLE IF NOT EXISTS routing_decisions (
      id          TEXT PRIMARY KEY,
      donation_id TEXT NOT NULL,
      pool_name   TEXT NOT NULL,
      strategy    TEXT NOT NULL,
      selected_id TEXT NOT NULL,
      candidates  TEXT NOT NULL,
      excluded    TEXT NOT NULL,
      decided_at  DATETIME NOT NULL,
      createdAt   DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    await Database.run(`CREATE TABLE IF NOT EXISTS routing_config (
      pool_name TEXT PRIMARY KEY,
      strategy  TEXT NOT NULL,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  } catch (e) {
    // Ignore errors - tables may already exist
  }
};
