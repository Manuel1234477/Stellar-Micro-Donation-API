'use strict';

/**
 * Migrations renamed to resolve duplicate numeric prefixes.
 *
 * Each renamed file keeps its original exports.name, so a database that
 * recorded the old name in schema_migrations must still see the migration as
 * applied. These tests seed the old names and check the runner reports the
 * renamed files as applied rather than pending.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const MIGRATIONS_DIR = path.join(__dirname, '../../src/migrations');

const RENAMED = {
  '048_refund_transactions': '032_refund_transactions',
  '049_payment_streams': '034_payment_streams',
  '050_refresh_token_session_limits': '042_refresh_token_session_limits',
  '051_wallets_add_donation_limits': '042_wallets_add_donation_limits',
  '052_corporate_matching_programs': '044_corporate_matching_programs',
  '053_velocity_log_and_donor_tier': '044_velocity_log_and_donor_tier',
  '054_recovery_guardian_notifications': '045_recovery_guardian_notifications',
};

describe('migrations renamed to resolve duplicate prefixes', () => {
  let tmpDir;
  let originalDbPath;
  let Database;
  let migrationStatus;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-renamed-'));
    originalDbPath = process.env.DB_PATH;
    process.env.DB_PATH = path.join(tmpDir, 'renamed.db');
    Database = require('../../src/utils/database');
    ({ migrationStatus } = require('../../src/utils/migrationRunner'));
    await Database.initialize();
  });

  afterAll(async () => {
    await Database.close();
    process.env.DB_PATH = originalDbPath;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('migrate:check passes once every numeric prefix is unique', () => {
    const output = execFileSync(
      process.execPath,
      [path.join(__dirname, '../../scripts/check-migration-ids.js')],
      { encoding: 'utf8' }
    );
    expect(output).toMatch(/all prefixes unique/);
  });

  it('every renamed file exists under its new name', () => {
    for (const newName of Object.keys(RENAMED)) {
      expect(fs.existsSync(path.join(MIGRATIONS_DIR, `${newName}.js`))).toBe(true);
    }
  });

  it('reports renamed files as applied when schema_migrations holds the old names', async () => {
    // migrationStatus creates schema_migrations; seed it with the pre-rename names.
    await migrationStatus();
    for (const oldName of Object.values(RENAMED)) {
      await Database.run(
        'INSERT OR IGNORE INTO schema_migrations (name, checksum) VALUES (?, ?)',
        [oldName, '']
      );
    }

    const statuses = await migrationStatus();
    const byName = new Map(statuses.map((s) => [s.name, s.status]));

    for (const newName of Object.keys(RENAMED)) {
      expect(byName.get(newName)).toMatch(/^applied/);
    }
  });
});
