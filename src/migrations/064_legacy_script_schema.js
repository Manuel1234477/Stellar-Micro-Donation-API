'use strict';

/**
 * Migration: fold schema from the retired src/scripts/migrations/ directory
 * into the numbered migration set (#2101).
 *
 * The scripts in src/scripts/migrations/ were run by hand on some databases
 * but never by the migration runner, so a fresh database built from
 * src/migrations/ was missing these tables and columns. Every statement here
 * is idempotent: tables use IF NOT EXISTS and columns are added only when
 * PRAGMA table_info shows they are absent, so databases that already ran the
 * legacy scripts are left unchanged.
 *
 * Data-only steps from the legacy scripts (e.g. 013 suspending invalid
 * frequencies, migrateToEnvelopeEncryption) are intentionally not repeated here.
 */

exports.name = '064_legacy_script_schema';

async function addColumnIfMissing(db, table, column, definition) {
  const info = await db.query(`PRAGMA table_info(${table})`, []);
  if (info.some((row) => row.name === column)) return;
  await db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

exports.up = async (db) => {
  // ── Tables ────────────────────────────────────────────────────────────────

  // from 002_enhance_recurring_donations.js
  await db.run(`
    CREATE TABLE IF NOT EXISTS recurring_donation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scheduleId INTEGER NOT NULL,
      status TEXT NOT NULL,
      transactionHash TEXT,
      errorMessage TEXT,
      attemptNumber INTEGER DEFAULT 1,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      correlationId TEXT,
      traceId TEXT,
      FOREIGN KEY (scheduleId) REFERENCES recurring_donations(id)
    )
  `);

  // from 003_add_wallet_merge_audit.js
  await db.run(`
    CREATE TABLE IF NOT EXISTS wallet_merge_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sourceWalletId INTEGER NOT NULL,
      sourcePublicKey TEXT NOT NULL,
      destinationPublicKey TEXT NOT NULL,
      mergedAmount TEXT NOT NULL,
      transactionHash TEXT NOT NULL,
      ledger INTEGER,
      performedBy TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (sourceWalletId) REFERENCES users(id)
    )
  `);

  // from 004_add_asset_issuance.js
  await db.run(`
    CREATE TABLE IF NOT EXISTS issued_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assetCode TEXT NOT NULL,
      issuerPublicKey TEXT NOT NULL,
      name TEXT,
      description TEXT,
      iconUrl TEXT,
      totalIssued TEXT NOT NULL DEFAULT '0',
      totalBurned TEXT NOT NULL DEFAULT '0',
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(assetCode, issuerPublicKey)
    )
  `);
  await db.run(`
    CREATE TABLE IF NOT EXISTS asset_holdings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assetCode TEXT NOT NULL,
      issuerPublicKey TEXT NOT NULL,
      holderPublicKey TEXT NOT NULL,
      balance TEXT NOT NULL DEFAULT '0',
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(assetCode, issuerPublicKey, holderPublicKey)
    )
  `);

  // from 005_add_smart_donation_routing.js
  await db.run(`
    CREATE TABLE IF NOT EXISTS recipient_pools (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      name      TEXT    NOT NULL UNIQUE,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.run(`
    CREATE TABLE IF NOT EXISTS recipient_pool_members (
      pool_name         TEXT NOT NULL REFERENCES recipient_pools(name) ON DELETE CASCADE,
      recipient_id      TEXT NOT NULL,
      latitude          REAL,
      longitude         REAL,
      campaign_deadline DATETIME,
      display_name      TEXT,
      PRIMARY KEY (pool_name, recipient_id)
    )
  `);
  await db.run(`
    CREATE TABLE IF NOT EXISTS round_robin_state (
      pool_name  TEXT PRIMARY KEY,
      next_index INTEGER NOT NULL DEFAULT 0,
      updatedAt  DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.run(`
    CREATE TABLE IF NOT EXISTS routing_decisions (
      id          TEXT PRIMARY KEY,
      donation_id TEXT NOT NULL,
      pool_name   TEXT NOT NULL,
      strategy    TEXT NOT NULL,
      selected_id TEXT NOT NULL,
      candidates  TEXT NOT NULL,
      excluded    TEXT NOT NULL,
      decided_at  DATETIME NOT NULL,
      createdAt   DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.run('CREATE INDEX IF NOT EXISTS idx_rd_donation ON routing_decisions(donation_id)');
  await db.run('CREATE INDEX IF NOT EXISTS idx_rd_pool ON routing_decisions(pool_name)');
  await db.run('CREATE INDEX IF NOT EXISTS idx_rd_strategy ON routing_decisions(strategy)');

  // from 006_add_routing_config.js
  await db.run(`
    CREATE TABLE IF NOT EXISTS routing_config (
      pool_name TEXT PRIMARY KEY,
      strategy  TEXT NOT NULL,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // from addCampaignMilestones.js
  await db.run(`
    CREATE TABLE IF NOT EXISTS campaign_milestones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      target_amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      verified_at DATETIME,
      verified_by TEXT,
      fund_release_tx TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
    )
  `);

  // from addCorsOriginsTable.js
  await db.run(`
    CREATE TABLE IF NOT EXISTS cors_origins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      origin TEXT NOT NULL UNIQUE,
      allowCredentials INTEGER NOT NULL DEFAULT 1,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      createdBy TEXT
    )
  `);

  // from addCrowdfunding.js
  await db.run(`
    CREATE TABLE IF NOT EXISTS escrow_pledges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      donor_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'held',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
      FOREIGN KEY (donor_id) REFERENCES users(id)
    )
  `);
  await db.run('CREATE INDEX IF NOT EXISTS idx_escrow_pledges_campaign ON escrow_pledges(campaign_id)');

  // from addImpactMetricsTable.js
  await db.run(`
    CREATE TABLE IF NOT EXISTS impact_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      unit TEXT NOT NULL,
      amount_per_unit REAL NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
    )
  `);
  await db.run('CREATE INDEX IF NOT EXISTS idx_impact_metrics_campaign_id ON impact_metrics(campaign_id)');

  // from addSubscriptionTiers.js
  await db.run(`
    CREATE TABLE IF NOT EXISTS subscription_tiers (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL UNIQUE,
      amount      REAL    NOT NULL,
      interval    TEXT    NOT NULL DEFAULT 'monthly',
      benefits    TEXT,
      createdAt   DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt   DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.run(`
    CREATE TABLE IF NOT EXISTS donor_subscriptions (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      donorId             INTEGER NOT NULL,
      tierId              INTEGER NOT NULL,
      recurringDonationId INTEGER,
      status              TEXT    NOT NULL DEFAULT 'active',
      createdAt           DATETIME DEFAULT CURRENT_TIMESTAMP,
      cancelledAt         DATETIME DEFAULT NULL,
      FOREIGN KEY (donorId)             REFERENCES users(id),
      FOREIGN KEY (tierId)              REFERENCES subscription_tiers(id),
      FOREIGN KEY (recurringDonationId) REFERENCES recurring_donations(id)
    )
  `);

  // ── Columns on existing tables ───────────────────────────────────────────

  // from 002 / 013
  await addColumnIfMissing(db, 'recurring_donations', 'suspendReason', 'TEXT DEFAULT NULL');

  // from 003_add_wallet_merge_audit.js
  await addColumnIfMissing(db, 'users', 'mergedAt', 'DATETIME');
  await addColumnIfMissing(db, 'users', 'mergedInto', 'TEXT');

  // from 003_add_campaign_milestone_tracking.js
  await addColumnIfMissing(db, 'campaigns', 'notified_milestones', "TEXT DEFAULT '[]'");
  await addColumnIfMissing(db, 'campaigns', 'last_milestone_notification', 'DATETIME DEFAULT NULL');
  await addColumnIfMissing(db, 'campaigns', 'closed_at', 'DATETIME DEFAULT NULL');

  // from addCrowdfunding.js
  await addColumnIfMissing(db, 'campaigns', 'funding_model', "TEXT NOT NULL DEFAULT 'keep-what-you-raise'");

  // from 005 / 006_add_routing_config.js
  await addColumnIfMissing(db, 'recipient_pool_members', 'weight', 'REAL DEFAULT 1');
  await addColumnIfMissing(db, 'recipient_pool_members', 'priority', 'REAL DEFAULT 0');

  // from 006_add_nft_certificates.js
  await addColumnIfMissing(db, 'transactions', 'nft_asset_code', 'TEXT');
  await addColumnIfMissing(db, 'transactions', 'nft_issuer', 'TEXT');
  await addColumnIfMissing(db, 'transactions', 'nft_tx_hash', 'TEXT');
  await addColumnIfMissing(db, 'transactions', 'nft_minted_at', 'DATETIME');
  await addColumnIfMissing(db, 'transactions', 'nft_mint_error', 'TEXT');

  // from addIpfsCid.js
  await addColumnIfMissing(db, 'transactions', 'ipfs_cid', 'TEXT DEFAULT NULL');

  // from addCurrencyColumns.js
  await addColumnIfMissing(db, 'transactions', 'originalCurrency', "TEXT DEFAULT 'XLM'");
  await addColumnIfMissing(db, 'transactions', 'originalAmount', 'REAL');

  // from 014_add_api_key_id_to_idempotency.js
  await addColumnIfMissing(db, 'idempotency_keys', 'api_key_id', 'INTEGER DEFAULT NULL');
  await db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_idempotency_keys_composite
    ON idempotency_keys(api_key_id, idempotencyKey)
  `);

  // from 003_add_timebounds_to_transactions.js
  await db.run(
    'CREATE INDEX IF NOT EXISTS idx_transactions_timebounds ON transactions(validAfter, validBefore)'
  );
};

exports.down = async () => {
  // Forward-only: the tables and columns above may hold data written by the
  // application, and SQLite cannot drop columns on older versions. Rolling back
  // this migration intentionally does nothing.
};
