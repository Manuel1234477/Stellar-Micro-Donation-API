'use strict';

/**
 * Migration 044: FTS5 full-text search virtual tables
 *
 * Adds FTS5 virtual tables for donations_store and campaigns,
 * plus triggers to keep them in sync.
 *
 * - donations_fts: indexes memo, notes, tags from donations_store
 * - campaigns_fts: indexes name, description from campaigns
 *
 * Performance note (issue #1796):
 * The triggers below only fire on INSERT/UPDATE/DELETE of donations_store and
 * campaigns, so they add no cost to the read path (list-donations). The FTS
 * tables are external-content virtual tables (content='') and must only be
 * queried by the /donations/search endpoint; the default list query must not
 * join donations_fts. The default list query is served by the composite
 * indexes added in migration 045.
 */

exports.name = '044_fts5_search';

exports.up = async (db) => {
  // ── donations FTS5 virtual table ─────────────────────────────────────────
  await db.run(`
    CREATE VIRTUAL TABLE IF NOT EXISTS donations_fts
    USING fts5(
      donation_id UNINDEXED,
      memo,
      notes,
      tags,
      content='',
      tokenize='porter unicode61'
    )
  `);

  // Populate from existing donations_store rows
  await db.run(`
    INSERT OR IGNORE INTO donations_fts (donation_id, memo, notes, tags)
    SELECT
      id,
      COALESCE(json_extract(data, '$.memo'), ''),
      COALESCE(json_extract(data, '$.notes'), ''),
      COALESCE(json_extract(data, '$.tags'), '')
    FROM donations_store
    WHERE data IS NOT NULL
  `);

  // Trigger: INSERT into donations_store → index in FTS
  await db.run(`
    CREATE TRIGGER IF NOT EXISTS donations_fts_insert
    AFTER INSERT ON donations_store
    BEGIN
      INSERT INTO donations_fts (donation_id, memo, notes, tags)
      VALUES (
        NEW.id,
        COALESCE(json_extract(NEW.data, '$.memo'), ''),
        COALESCE(json_extract(NEW.data, '$.notes'), ''),
        COALESCE(json_extract(NEW.data, '$.tags'), '')
      );
    END
  `);

  // Trigger: UPDATE donations_store → update FTS index
  await db.run(`
    CREATE TRIGGER IF NOT EXISTS donations_fts_update
    AFTER UPDATE ON donations_store
    BEGIN
      DELETE FROM donations_fts WHERE donation_id = OLD.id;
      INSERT INTO donations_fts (donation_id, memo, notes, tags)
      VALUES (
        NEW.id,
        COALESCE(json_extract(NEW.data, '$.memo'), ''),
        COALESCE(json_extract(NEW.data, '$.notes'), ''),
        COALESCE(json_extract(NEW.data, '$.tags'), '')
      );
    END
  `);

  // Trigger: DELETE from donations_store → remove from FTS
  await db.run(`
    CREATE TRIGGER IF NOT EXISTS donations_fts_delete
    AFTER DELETE ON donations_store
    BEGIN
      DELETE FROM donations_fts WHERE donation_id = OLD.id;
    END
  `);

  // ── campaigns FTS5 virtual table ─────────────────────────────────────────
  await db.run(`
    CREATE VIRTUAL TABLE IF NOT EXISTS campaigns_fts
    USING fts5(
      campaign_id UNINDEXED,
      name,
      description,
      content='',
      tokenize='porter unicode61'
    )
  `);

  // Populate from existing campaigns rows
  await db.run(`
    INSERT OR IGNORE INTO campaigns_fts (campaign_id, name, description)
    SELECT
      id,
      COALESCE(name, ''),
      COALESCE(description, '')
    FROM campaigns
    WHERE deleted_at IS NULL
  `);

  // Trigger: INSERT into campaigns → index in FTS
  await db.run(`
    CREATE TRIGGER IF NOT EXISTS campaigns_fts_insert
    AFTER INSERT ON campaigns
    BEGIN
      INSERT INTO campaigns_fts (campaign_id, name, description)
      VALUES (NEW.id, COALESCE(NEW.name, ''), COALESCE(NEW.description, ''));
    END
  `);

  // Trigger: UPDATE campaigns → update FTS index
  await db.run(`
    CREATE TRIGGER IF NOT EXISTS campaigns_fts_update
    AFTER UPDATE ON campaigns
    BEGIN
      DELETE FROM campaigns_fts WHERE campaign_id = OLD.id;
      INSERT INTO campaigns_fts (campaign_id, name, description)
      VALUES (NEW.id, COALESCE(NEW.name, ''), COALESCE(NEW.description, ''));
    END
  `);

  // Trigger: DELETE campaigns → remove from FTS
  await db.run(`
    CREATE TRIGGER IF NOT EXISTS campaigns_fts_delete
    AFTER DELETE ON campaigns
    BEGIN
      DELETE FROM campaigns_fts WHERE campaign_id = OLD.id;
    END
  `);
};

exports.down = async (db) => {
  await db.run('DROP TRIGGER IF EXISTS donations_fts_delete');
  await db.run('DROP TRIGGER IF EXISTS donations_fts_update');
  await db.run('DROP TRIGGER IF EXISTS donations_fts_insert');
  await db.run('DROP TABLE IF EXISTS donations_fts');

  await db.run('DROP TRIGGER IF EXISTS campaigns_fts_delete');
  await db.run('DROP TRIGGER IF EXISTS campaigns_fts_update');
  await db.run('DROP TRIGGER IF EXISTS campaigns_fts_insert');
  await db.run('DROP TABLE IF EXISTS campaigns_fts');
};

// ── Monetary columns (ADR-004) ──────────────────────────────────────────────
// Add integer stroop columns alongside the legacy REAL columns, backfill with
// CAST(ROUND(col * 10000000) AS INTEGER), and keep them in sync via triggers
// until the REAL columns are dropped in a later release.
//
// match_ratio is intentionally NOT converted to REAL; it is stored as basis
// points (match_ratio_bps INTEGER) so it stays a rational value.

const STROOPS_PER_UNIT = 10000000;

const toStroops = (col) => `CAST(ROUND(COALESCE(${col}, 0) * ${STROOPS_PER_UNIT}) AS INTEGER)`;

/**
 * Add a *_stroops INTEGER column to `table`, backfill it, and install triggers
 * that keep it in sync with the legacy REAL column in both directions.
 */
async function addStroopColumn(db, table, column) {
  const stroopCol = `${column}_stroops`;

  await db.run(`ALTER TABLE ${table} ADD COLUMN ${stroopCol} INTEGER`);
  await db.run(`UPDATE ${table} SET ${stroopCol} = ${toStroops(column)}`);

  await db.run(`
    CREATE TRIGGER IF NOT EXISTS ${table}_${column}_stroops_insert
    AFTER INSERT ON ${table}
    BEGIN
      UPDATE ${table}
      SET ${stroopCol} = ${toStroops(`NEW.${column}`)}
      WHERE rowid = NEW.rowid;
    END
  `);

  await db.run(`
    CREATE TRIGGER IF NOT EXISTS ${table}_${column}_stroops_update
    AFTER UPDATE OF ${column} ON ${table}
    BEGIN
      UPDATE ${table}
      SET ${stroopCol} = ${toStroops(`NEW.${column}`)}
      WHERE rowid = NEW.rowid;
    END
  `);
}

async function dropStroopColumn(db, table, column) {
  await db.run(`DROP TRIGGER IF EXISTS ${table}_${column}_stroops_update`);
  await db.run(`DROP TRIGGER IF EXISTS ${table}_${column}_stroops_insert`);
  await db.run(`ALTER TABLE ${table} DROP COLUMN ${column}_stroops`);
}

exports.up = async (db) => {
  // ── donations FTS5 virtual table ─────────────────────────────────────────
  await db.run(`
    CREATE VIRTUAL TABLE IF NOT EXISTS donations_fts
    USING fts5(
      donation_id UNINDEXED,
      memo,
      notes,
      tags,
      content='',
      tokenize='porter unicode61'
    )
  `);

  // Populate from existing donations_store rows
  await db.run(`
    INSERT OR IGNORE INTO donations_fts (donation_id, memo, notes, tags)
    SELECT
      id,
      COALESCE(json_extract(data, '$.memo'), ''),
      COALESCE(json_extract(data, '$.notes'), ''),
      COALESCE(json_extract(data, '$.tags'), '')
    FROM donations_store
    WHERE data IS NOT NULL
  `);

  // Trigger: INSERT into donations_store → index in FTS
  await db.run(`
    CREATE TRIGGER IF NOT EXISTS donations_fts_insert
    AFTER INSERT ON donations_store
    BEGIN
      INSERT INTO donations_fts (donation_id, memo, notes, tags)
      VALUES (
        NEW.id,
        COALESCE(json_extract(NEW.data, '$.memo'), ''),
        COALESCE(json_extract(NEW.data, '$.notes'), ''),
        COALESCE(json_extract(NEW.data, '$.tags'), '')
      );
    END
  `);

  // Trigger: UPDATE donations_store → update FTS index
  await db.run(`
    CREATE TRIGGER IF NOT EXISTS donations_fts_update
    AFTER UPDATE ON donations_store
    BEGIN
      DELETE FROM donations_fts WHERE donation_id = OLD.id;
      INSERT INTO donations_fts (donation_id, memo, notes, tags)
      VALUES (
        NEW.id,
        COALESCE(json_extract(NEW.data, '$.memo'), ''),
        COALESCE(json_extract(NEW.data, '$.notes'), ''),
        COALESCE(json_extract(NEW.data, '$.tags'), '')
      );
    END
  `);

  // Trigger: DELETE from donations_store → remove from FTS
  await db.run(`
    CREATE TRIGGER IF NOT EXISTS donations_fts_delete
    AFTER DELETE ON donations_store
    BEGIN
      DELETE FROM donations_fts WHERE donation_id = OLD.id;
    END
  `);

  // ── campaigns FTS5 virtual table ─────────────────────────────────────────
  await db.run(`
    CREATE VIRTUAL TABLE IF NOT EXISTS campaigns_fts
    USING fts5(
      campaign_id UNINDEXED,
      name,
      description,
      content='',
      tokenize='porter unicode61'
    )
  `);

  // Populate from existing campaigns rows
  await db.run(`
    INSERT OR IGNORE INTO campaigns_fts (campaign_id, name, description)
    SELECT
      id,
      COALESCE(name, ''),
      COALESCE(description, '')
    FROM campaigns
    WHERE deleted_at IS NULL
  `);

  // Trigger: INSERT into campaigns → index in FTS
  await db.run(`
    CREATE TRIGGER IF NOT EXISTS campaigns_fts_insert
    AFTER INSERT ON campaigns
    BEGIN
      INSERT INTO campaigns_fts (campaign_id, name, description)
      VALUES (NEW.id, COALESCE(NEW.name, ''), COALESCE(NEW.description, ''));
    END
  `);

  // Trigger: UPDATE campaigns → update FTS index
  await db.run(`
    CREATE TRIGGER IF NOT EXISTS campaigns_fts_update
    AFTER UPDATE ON campaigns
    BEGIN
      DELETE FROM campaigns_fts WHERE campaign_id = OLD.id;
      INSERT INTO campaigns_fts (campaign_id, name, description)
      VALUES (NEW.id, COALESCE(NEW.name, ''), COALESCE(NEW.description, ''));
    END
  `);

  // Trigger: DELETE campaigns → remove from FTS
  await db.run(`
    CREATE TRIGGER IF NOT EXISTS campaigns_fts_delete
    AFTER DELETE ON campaigns
    BEGIN
      DELETE FROM campaigns_fts WHERE campaign_id = OLD.id;
    END
  `);

  // ── Monetary columns → stroops (ADR-004) ─────────────────────────────────
  const stroopColumns = [
    ['campaigns', 'goal_amount'],
    ['campaigns', 'current_amount'],
    ['wallets', 'daily_limit'],
    ['wallets', 'monthly_limit'],
    ['wallets', 'per_transaction_limit'],
    ['recurring_donations', 'amount'],
    ['recurring_donations', 'totalAmount'],
    ['recurring_donations', 'paidAmount'],
    ['streams', 'amount'],
    ['streams', 'totalAmount'],
    ['streams', 'paidAmount'],
    ['donation_velocity', 'totalAmount'],
    ['donation_velocity', 'maxAmount'],
    ['refunds', 'amount'],
    ['refund_transactions', 'amount'],
    ['corporate_matching', 'annualCap'],
    ['corporate_matching', 'donationAmount'],
    ['corporate_matching', 'matchAmount'],
    ['corporate_matching_programs', 'per_employee_limit'],
    ['corporate_matching_programs', 'total_limit'],
    ['corporate_matching_programs', 'remaining_total_limit'],
  ];

  for (const [table, column] of stroopColumns) {
    await addStroopColumn(db, table, column);
  }

  // match_ratio as basis points (rational, not REAL)
  await db.run('ALTER TABLE corporate_matching ADD COLUMN match_ratio_bps INTEGER');
  await db.run(
    'UPDATE corporate_matching SET match_ratio_bps = CAST(ROUND(COALESCE(match_ratio, 0) * 10000) AS INTEGER)'
  );
};

exports.down = async (db) => {
  await db.run('ALTER TABLE corporate_matching DROP COLUMN match_ratio_bps');

  const stroopColumns = [
    ['campaigns', 'goal_amount'],
    ['campaigns', 'current_amount'],
    ['wallets', 'daily_limit'],
    ['wallets', 'monthly_limit'],
    ['wallets', 'per_transaction_limit'],
    ['recurring_donations', 'amount'],
    ['recurring_donations', 'totalAmount'],
    ['recurring_donations', 'paidAmount'],
    ['streams', 'amount'],
    ['streams', 'totalAmount'],
    ['streams', 'paidAmount'],
    ['donation_velocity', 'totalAmount'],
    ['donation_velocity', 'maxAmount'],
    ['refunds', 'amount'],
    ['refund_transactions', 'amount'],
    ['corporate_matching', 'annualCap'],
    ['corporate_matching', 'donationAmount'],
    ['corporate_matching', 'matchAmount'],
    ['corporate_matching_programs', 'per_employee_limit'],
    ['corporate_matching_programs', 'total_limit'],
    ['corporate_matching_programs', 'remaining_total_limit'],
  ];

  for (const [table, column] of stroopColumns) {
    await dropStroopColumn(db, table, column);
  }

  await db.run('DROP TRIGGER IF EXISTS donations_fts_delete');
  await db.run('DROP TRIGGER IF EXISTS donations_fts_update');
  await db.run('DROP TRIGGER IF EXISTS donations_fts_insert');
  await db.run('DROP TABLE IF EXISTS donations_fts');

  await db.run('DROP TRIGGER IF EXISTS campaigns_fts_delete');
  await db.run('DROP TRIGGER IF EXISTS campaigns_fts_update');
  await db.run('DROP TRIGGER IF EXISTS campaigns_fts_insert');
  await db.run('DROP TABLE IF EXISTS campaigns_fts');
};
