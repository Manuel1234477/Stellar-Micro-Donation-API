'use strict';

/**
 * Migration 024: Persist CorporateMatchingService state and SEP-10 challenge store
 * Fixes #1134 and #1135
 */

exports.name = '024_corporate_matching_and_sep10_challenges';

exports.up = async (db) => {
  await db.run(`
    CREATE TABLE IF NOT EXISTS corporate_employers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      matchRatio INTEGER NOT NULL,
      annualCap REAL NOT NULL,
      addedAt TEXT NOT NULL
    )
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS corporate_claims (
      id TEXT PRIMARY KEY,
      donorId TEXT NOT NULL,
      employerId TEXT NOT NULL,
      donationAmount REAL NOT NULL,
      matchAmount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      createdAt TEXT NOT NULL,
      reviewedAt TEXT,
      rejectReason TEXT,
      txId TEXT
    )
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_corporate_claims_employer_donor
    ON corporate_claims(employerId, donorId, status, createdAt)
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS sep10_challenges (
      challengeId TEXT PRIMARY KEY,
      account TEXT NOT NULL,
      expiresAt INTEGER NOT NULL,
      issuedAt INTEGER NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      usedAt INTEGER
    )
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_sep10_challenges_expires
    ON sep10_challenges(expiresAt)
  `);
};

exports.down = async (db) => {
  await db.run('DROP TABLE IF EXISTS sep10_challenges');
  await db.run('DROP TABLE IF EXISTS corporate_claims');
  await db.run('DROP TABLE IF EXISTS corporate_employers');
};
