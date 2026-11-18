'use strict';

/**
 * Migration 029 — Add CHECK constraints on monetary / limit columns
 *
 * Issue #1360: None of the monetary/limit columns across pledges, campaigns,
 * and users had database-level CHECK constraints preventing negative values.
 * This migration adds those constraints as the defense-in-depth layer the
 * schema was missing.
 *
 * SQLite does not support ADD CONSTRAINT on existing tables, so we use the
 * standard "rename / recreate / copy / drop" pattern.
 *
 * Constraint choices (per issue #1360 suggestion):
 *   pledges.amount            > 0   (a pledge must be for a positive amount)
 *   campaigns.goal_amount     > 0   (a goal must be strictly positive)
 *   campaigns.current_amount  >= 0  (running total cannot be negative)
 *   users.daily_limit         >= 0  (NULL means "no limit"; 0 is a valid sentinel)
 *   users.monthly_limit       >= 0
 *   users.per_transaction_limit >= 0
 */

exports.name = '029_check_constraints_monetary';

exports.up = async (db) => {
  // ── pledges ────────────────────────────────────────────────────────────────
  // No numbered migration creates pledges, so a fresh database has no table to
  // rebuild here. Create it with the shape this rebuild expects; deployed
  // databases already have the table and skip this.
  await db.run(`
    CREATE TABLE IF NOT EXISTS pledges (
      id              TEXT PRIMARY KEY,
      campaign_id     INTEGER NOT NULL,
      donor_wallet_id TEXT NOT NULL,
      amount          REAL NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending',
      expires_at      DATETIME NOT NULL,
      cancel_reason   TEXT,
      cancelled_at    DATETIME,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
    )
  `);

  // Recreate with CHECK (amount > 0)
  await db.run('BEGIN');
  try {
    await db.run(`
      CREATE TABLE pledges_new (
        id              TEXT PRIMARY KEY,
        campaign_id     INTEGER NOT NULL,
        donor_wallet_id TEXT NOT NULL,
        amount          REAL NOT NULL CHECK(amount > 0),
        status          TEXT NOT NULL DEFAULT 'pending'
                          CHECK(status IN ('pending','fulfilled','expired','cancelled')),
        expires_at      DATETIME NOT NULL,
        cancel_reason   TEXT,
        cancelled_at    DATETIME,
        created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
      )
    `);

    await db.run(`INSERT INTO pledges_new SELECT * FROM pledges`);
    await db.run(`DROP TABLE pledges`);
    await db.run(`ALTER TABLE pledges_new RENAME TO pledges`);

    // Recreate indexes dropped with the old table
    await db.run(`CREATE INDEX IF NOT EXISTS idx_pledges_campaign ON pledges(campaign_id)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_pledges_status   ON pledges(status)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_pledges_expires  ON pledges(expires_at)`);

    // ── campaigns ────────────────────────────────────────────────────────────
    // Recreate with CHECK (goal_amount > 0) and CHECK (current_amount >= 0)
    await db.run(`
      CREATE TABLE campaigns_new (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        name           TEXT NOT NULL,
        description    TEXT,
        goal_amount    REAL NOT NULL CHECK(goal_amount > 0),
        current_amount REAL DEFAULT 0 CHECK(current_amount >= 0),
        start_date     DATETIME,
        end_date       DATETIME,
        status         TEXT DEFAULT 'active',
        created_by     INTEGER,
        createdAt      DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt      DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted_at     DATETIME DEFAULT NULL,
        tenant_id      TEXT NOT NULL DEFAULT 'default',
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `);

    await db.run(`INSERT INTO campaigns_new SELECT * FROM campaigns`);
    await db.run(`DROP TABLE campaigns`);
    await db.run(`ALTER TABLE campaigns_new RENAME TO campaigns`);

    // ── users ─────────────────────────────────────────────────────────────────
    // Recreate with CHECK constraints on the three limit columns.
    // These columns are nullable (NULL = no limit), so the CHECK only fires
    // when a value is actually supplied — which is the desired semantics.
    await db.run(`
      CREATE TABLE users_new (
        id                     INTEGER PRIMARY KEY AUTOINCREMENT,
        publicKey              TEXT NOT NULL UNIQUE,
        encryptedSecret        TEXT,
        createdAt              DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted_at             DATETIME DEFAULT NULL,
        daily_limit            REAL DEFAULT NULL CHECK(daily_limit IS NULL OR daily_limit >= 0),
        monthly_limit          REAL DEFAULT NULL CHECK(monthly_limit IS NULL OR monthly_limit >= 0),
        per_transaction_limit  REAL DEFAULT NULL CHECK(per_transaction_limit IS NULL OR per_transaction_limit >= 0),
        tenant_id              TEXT NOT NULL DEFAULT 'default'
      )
    `);

    await db.run(`INSERT INTO users_new SELECT * FROM users`);
    await db.run(`DROP TABLE users`);
    await db.run(`ALTER TABLE users_new RENAME TO users`);

    await db.run('COMMIT');
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }
};

exports.down = async (db) => {
  // Reverse: remove CHECK constraints by recreating without them.
  await db.run('BEGIN');
  try {
    // ── users ─────────────────────────────────────────────────────────────────
    await db.run(`
      CREATE TABLE users_old (
        id                     INTEGER PRIMARY KEY AUTOINCREMENT,
        publicKey              TEXT NOT NULL UNIQUE,
        encryptedSecret        TEXT,
        createdAt              DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted_at             DATETIME DEFAULT NULL,
        daily_limit            REAL DEFAULT NULL,
        monthly_limit          REAL DEFAULT NULL,
        per_transaction_limit  REAL DEFAULT NULL,
        tenant_id              TEXT NOT NULL DEFAULT 'default'
      )
    `);
    await db.run(`INSERT INTO users_old SELECT * FROM users`);
    await db.run(`DROP TABLE users`);
    await db.run(`ALTER TABLE users_old RENAME TO users`);

    // ── campaigns ────────────────────────────────────────────────────────────
    await db.run(`
      CREATE TABLE campaigns_old (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        name           TEXT NOT NULL,
        description    TEXT,
        goal_amount    REAL NOT NULL,
        current_amount REAL DEFAULT 0,
        start_date     DATETIME,
        end_date       DATETIME,
        status         TEXT DEFAULT 'active',
        created_by     INTEGER,
        createdAt      DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt      DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted_at     DATETIME DEFAULT NULL,
        tenant_id      TEXT NOT NULL DEFAULT 'default',
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `);
    await db.run(`INSERT INTO campaigns_old SELECT * FROM campaigns`);
    await db.run(`DROP TABLE campaigns`);
    await db.run(`ALTER TABLE campaigns_old RENAME TO campaigns`);

    // ── pledges ────────────────────────────────────────────────────────────────
    await db.run(`
      CREATE TABLE pledges_old (
        id              TEXT PRIMARY KEY,
        campaign_id     INTEGER NOT NULL,
        donor_wallet_id TEXT NOT NULL,
        amount          REAL NOT NULL,
        status          TEXT NOT NULL DEFAULT 'pending'
                          CHECK(status IN ('pending','fulfilled','expired','cancelled')),
        expires_at      DATETIME NOT NULL,
        cancel_reason   TEXT,
        cancelled_at    DATETIME,
        created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
      )
    `);
    await db.run(`INSERT INTO pledges_old SELECT * FROM pledges`);
    await db.run(`DROP TABLE pledges`);
    await db.run(`ALTER TABLE pledges_old RENAME TO pledges`);

    await db.run(`CREATE INDEX IF NOT EXISTS idx_pledges_campaign ON pledges(campaign_id)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_pledges_status   ON pledges(status)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_pledges_expires  ON pledges(expires_at)`);

    await db.run('COMMIT');
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }
};
