'use strict';

/**
 * Migration 030: Store corporate match ratio as integer basis points and
 * annual cap as integer stroops (ADR-004).
 *
 * Corporate donation-matching programs commonly use fractional rates like
 * 0.5x (50%), 1.5x (150%), etc. Rather than storing these as REAL (which
 * accumulates floating-point error), the ratio is stored as integer basis
 * points (`match_ratio_bps`, where 10000 bps = 1.0x) and the annual cap is
 * stored as integer stroops (`annualCap_stroops`, 1 unit = 10,000,000 stroops).
 */

const STROOPS_PER_UNIT = 10000000;
const BPS_PER_UNIT = 10000;

exports.name = '030_corporate_match_ratio_float';

exports.up = async (db) => {
  // SQLite doesn't support ALTER COLUMN type directly
  // We need to recreate the table with the new column types
  const columns = await db.all('PRAGMA table_info(corporate_employers)');
  const matchRatioColumn = columns.find(c => c.name === 'matchRatio');

  if (matchRatioColumn) {
    // Create temporary table with integer basis points and stroops
    await db.run(`
      CREATE TABLE corporate_employers_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        match_ratio_bps INTEGER NOT NULL,
        annualCap_stroops INTEGER NOT NULL,
        addedAt TEXT NOT NULL
      )
    `);

    // Copy data from old table, converting to integer representations
    await db.run(
      `
      INSERT INTO corporate_employers_new (id, name, match_ratio_bps, annualCap_stroops, addedAt)
      SELECT id, name,
             CAST(ROUND(matchRatio * ?) AS INTEGER),
             CAST(ROUND(annualCap * ?) AS INTEGER),
             addedAt
      FROM corporate_employers
    `,
      [BPS_PER_UNIT, STROOPS_PER_UNIT]
    );

    // Drop old table
    await db.run('DROP TABLE corporate_employers');

    // Rename new table
    await db.run('ALTER TABLE corporate_employers_new RENAME TO corporate_employers');
  }

  // Ensure indexes exist
  await db.run('CREATE INDEX IF NOT EXISTS idx_corporate_employers_id ON corporate_employers(id)');
};

exports.down = async (db) => {
  // Revert back to REAL matchRatio and annualCap
  const columns = await db.all('PRAGMA table_info(corporate_employers)');
  const matchRatioColumn = columns.find(c => c.name === 'match_ratio_bps');

  if (matchRatioColumn) {
    // Create temporary table with REAL matchRatio and annualCap
    await db.run(`
      CREATE TABLE corporate_employers_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        matchRatio REAL NOT NULL,
        annualCap REAL NOT NULL,
        addedAt TEXT NOT NULL
      )
    `);

    // Copy data from old table, converting back from integer representations
    await db.run(
      `
      INSERT INTO corporate_employers_new (id, name, matchRatio, annualCap, addedAt)
      SELECT id, name,
             CAST(match_ratio_bps AS REAL) / ?,
             CAST(annualCap_stroops AS REAL) / ?,
             addedAt
      FROM corporate_employers
    `,
      [BPS_PER_UNIT, STROOPS_PER_UNIT]
    );

    // Drop old table
    await db.run('DROP TABLE corporate_employers');

    // Rename new table
    await db.run('ALTER TABLE corporate_employers_new RENAME TO corporate_employers');
  }
};