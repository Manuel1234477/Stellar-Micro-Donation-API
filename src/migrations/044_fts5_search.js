'use strict';

/**
 * Migration 044: FTS5 full-text search virtual tables
 *
 * Adds FTS5 virtual tables for donations_store and campaigns,
 * plus triggers to keep them in sync.
 *
 * - donations_fts: indexes memo, notes, tags from donations_store
 * - campaigns_fts: indexes name, description from campaigns
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
