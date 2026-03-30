'use strict';

exports.name = '001_initial_schema';

exports.up = async (db) => {
  await db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      publicKey TEXT NOT NULL UNIQUE,
      encryptedSecret TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME DEFAULT NULL,
      daily_limit REAL DEFAULT NULL,
      monthly_limit REAL DEFAULT NULL,
      per_transaction_limit REAL DEFAULT NULL,
      tenant_id TEXT NOT NULL DEFAULT 'default'
    )
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      goal_amount REAL NOT NULL,
      current_amount REAL DEFAULT 0,
      start_date DATETIME,
      end_date DATETIME,
      status TEXT DEFAULT 'active',
      created_by INTEGER,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME DEFAULT NULL,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS transactions (
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
      validBefore INTEGER DEFAULT 0,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
      FOREIGN KEY (senderId) REFERENCES users(id),
      FOREIGN KEY (receiverId) REFERENCES users(id)
    )
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_transactions_idempotency
    ON transactions(idempotencyKey)
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS recurring_donations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      donorId INTEGER NOT NULL,
      recipientId INTEGER NOT NULL,
      amount REAL NOT NULL,
      frequency TEXT NOT NULL,
      nextExecutionDate DATETIME NOT NULL,
      status TEXT DEFAULT 'active',
      executionCount INTEGER DEFAULT 0,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      FOREIGN KEY (donorId) REFERENCES users(id),
      FOREIGN KEY (recipientId) REFERENCES users(id)
    )
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS student_fees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId TEXT NOT NULL,
      description TEXT NOT NULL,
      totalAmount REAL NOT NULL,
      paidAmount REAL NOT NULL DEFAULT 0,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME DEFAULT NULL,
      tenant_id TEXT NOT NULL DEFAULT 'default'
    )
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS fee_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feeId INTEGER NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      paidAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME DEFAULT NULL,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      FOREIGN KEY (feeId) REFERENCES student_fees(id)
    )
  `);
};
