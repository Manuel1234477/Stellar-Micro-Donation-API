'use strict';

exports.name = '004_social_recovery';

exports.up = async (db) => {
  await db.run(`
    CREATE TABLE IF NOT EXISTS recovery_guardians (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      walletId INTEGER NOT NULL,
      guardianPublicKey TEXT NOT NULL,
      threshold INTEGER,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (walletId) REFERENCES users(id),
      UNIQUE (walletId, guardianPublicKey)
    )
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS recovery_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      walletId INTEGER NOT NULL,
      newPublicKey TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      threshold INTEGER NOT NULL,
      executeAfter DATETIME NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      executedAt DATETIME,
      FOREIGN KEY (walletId) REFERENCES users(id)
    )
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS recovery_approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recoveryRequestId INTEGER NOT NULL,
      guardianPublicKey TEXT NOT NULL,
      approvedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (recoveryRequestId) REFERENCES recovery_requests(id),
      UNIQUE (recoveryRequestId, guardianPublicKey)
    )
  `);

  await db.run(`CREATE INDEX IF NOT EXISTS idx_recovery_guardians_walletId ON recovery_guardians(walletId)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_recovery_requests_walletId ON recovery_requests(walletId)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_recovery_approvals_requestId ON recovery_approvals(recoveryRequestId)`);
};
