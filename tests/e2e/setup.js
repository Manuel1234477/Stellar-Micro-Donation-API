/**
 * E2E Global Setup - Stellar Testnet Test Environment Initialization
 *
 * Sets environment variables BEFORE Jest spawns worker processes so all modules
 * (securityConfig, database, stellar config) load with the correct settings.
 *
 * Runs once before the entire e2e suite. Creates a clean SQLite database in a
 * temporary directory so the repository's `data/` directory is never touched.
 * No JSON persistence files (e.g. data/wallets.json) are read, backed up, or
 * modified by this setup.
 */

'use strict';

// ─── Environment Variables ────────────────────────────────────────────────────
// Must be set at module top level so Jest worker processes inherit them.
// Workers are spawned AFTER this module runs, so they see these values when
// modules like securityConfig and database.js load for the first time.

process.env.MOCK_STELLAR = 'false';
process.env.STELLAR_ENVIRONMENT = 'testnet';
process.env.NODE_ENV = 'test';
process.env.API_KEYS = 'e2e-test-key,e2e-admin-key';

// Stable encryption key so we can encrypt secrets in setup and decrypt them
// during the test run. The CI workflow overrides this with a GitHub secret.
if (!process.env.ENCRYPTION_KEY) {
  process.env.ENCRYPTION_KEY = 'e2e_test_encryption_key_stellar_1';
}

// ─── Async Setup ──────────────────────────────────────────────────────────────

module.exports = async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  // Use a fresh temp directory for the e2e database so the repo's data/
  // directory (and any JSON persistence files in it) is left untouched.
  const E2E_TMP_DIR = path.join(os.tmpdir(), `stellar-e2e-${process.pid}-${Date.now()}`);
  if (!fs.existsSync(E2E_TMP_DIR)) {
    fs.mkdirSync(E2E_TMP_DIR, { recursive: true });
  }

  const DB_PATH = path.join(E2E_TMP_DIR, 'stellar_donations.db');

  // Point the database layer at the temp DB path. Workers inherit this env var.
  process.env.DB_PATH = DB_PATH;
  process.env.DATABASE_PATH = DB_PATH;

  // Drop stale database so tables are always created fresh with the correct schema
  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
  }

  // Bootstrap the database schema
  const Database = require('../../src/utils/database');

  try {
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
      rotated_to_id INTEGER
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
  } catch (e) {
    // Tables may already exist — non-fatal
  }

  // eslint-disable-next-line no-console
  console.log(`[e2e/setup] Database initialised at ${DB_PATH}. Targeting Stellar testnet.`);
};