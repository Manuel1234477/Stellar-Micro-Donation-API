'use strict';

exports.name = '017_disputes_table';

exports.up = async (db) => {
  await db.run(`
    CREATE TABLE IF NOT EXISTS disputes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      donationId INTEGER NOT NULL,
      recipientPublicKey TEXT NOT NULL,
      reason TEXT NOT NULL,
      evidence TEXT,
      status TEXT DEFAULT 'open',
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolvedAt DATETIME,
      resolutionNotes TEXT,
      FOREIGN KEY (donationId) REFERENCES transactions(id),
      UNIQUE(donationId)
    )
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status)
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_disputes_recipientPublicKey ON disputes(recipientPublicKey)
  `);
};

exports.down = async (db) => {
  await db.run('DROP TABLE IF EXISTS disputes');
};
