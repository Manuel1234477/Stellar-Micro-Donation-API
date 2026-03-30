'use strict';

exports.name = '006_donation_velocity';

exports.up = async (db) => {
  await db.run(`
    CREATE TABLE IF NOT EXISTS donation_velocity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      donorId INTEGER NOT NULL,
      recipientId INTEGER NOT NULL,
      windowStart DATETIME NOT NULL,
      totalAmount REAL NOT NULL DEFAULT 0,
      count INTEGER NOT NULL DEFAULT 0,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (donorId) REFERENCES users(id),
      FOREIGN KEY (recipientId) REFERENCES users(id)
    )
  `);

  await db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_velocity_donor_recipient_window
    ON donation_velocity(donorId, recipientId, windowStart)
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS recipient_velocity_limits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipientId INTEGER NOT NULL UNIQUE,
      maxAmount REAL,
      maxCount INTEGER,
      windowType TEXT NOT NULL DEFAULT 'daily' CHECK(windowType IN ('daily','weekly','monthly')),
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (recipientId) REFERENCES users(id)
    )
  `);
};
