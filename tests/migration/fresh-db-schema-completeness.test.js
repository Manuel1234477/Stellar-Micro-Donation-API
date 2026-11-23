'use strict';

/**
 * Schema completeness (#2101): a fresh database built only from
 * src/migrations/ must contain every table and column that the legacy
 * src/scripts/migrations/ scripts used to create by hand.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const REQUIRED_TABLES = [
  'recurring_donation_logs',
  'wallet_merge_audit',
  'issued_assets',
  'asset_holdings',
  'recipient_pools',
  'recipient_pool_members',
  'round_robin_state',
  'routing_decisions',
  'routing_config',
  'campaign_milestones',
  'cors_origins',
  'escrow_pledges',
  'impact_metrics',
  'subscription_tiers',
  'donor_subscriptions',
];

const REQUIRED_COLUMNS = {
  recurring_donations: ['suspendReason'],
  users: ['mergedAt', 'mergedInto'],
  campaigns: ['notified_milestones', 'last_milestone_notification', 'closed_at', 'funding_model'],
  recipient_pool_members: ['weight', 'priority'],
  transactions: [
    'ipfs_cid',
    'nft_asset_code',
    'nft_issuer',
    'nft_tx_hash',
    'nft_minted_at',
    'nft_mint_error',
    'originalCurrency',
    'originalAmount',
  ],
  idempotency_keys: ['api_key_id'],
};

describe('fresh database schema completeness (#2101)', () => {
  let tmpDir;
  let originalDbPath;
  let Database;
  let runMigrations;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-complete-'));
    originalDbPath = process.env.DB_PATH;
    process.env.DB_PATH = path.join(tmpDir, 'fresh.db');
    Database = require('../../src/utils/database');
    ({ runMigrations } = require('../../src/utils/migrationRunner'));
    await Database.initialize();
    await runMigrations();
  });

  afterAll(async () => {
    await Database.close();
    process.env.DB_PATH = originalDbPath;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates every table the legacy scripts used to create', async () => {
    const rows = await Database.query(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
      []
    );
    const tables = new Set(rows.map((r) => r.name));
    const missing = REQUIRED_TABLES.filter((t) => !tables.has(t));
    expect(missing).toEqual([]);
  });

  it('adds every column the legacy scripts used to add', async () => {
    const missing = [];
    for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
      const info = await Database.query(`PRAGMA table_info(${table})`, []);
      const names = new Set(info.map((r) => r.name));
      for (const column of columns) {
        if (!names.has(column)) missing.push(`${table}.${column}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
