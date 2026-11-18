// Global setup - runs once in the main Jest process before all test suites.
//
// Builds a template SQLite database in a temp isolation directory. Each Jest
// worker copies the template to its own private database file (tests/setup.js),
// so concurrently running suites never share database state — and the tracked
// files under data/ are never touched by test runs.
process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-key-1,test-key-2,test-key,admin-test-key';
process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test_encryption_key_fixed_32bytes_hex_value_here_00';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ISOLATION_ROOT = path.join(os.tmpdir(), 'stellar-test-isolation');
const TEMPLATE_DB = path.join(ISOLATION_ROOT, 'template.db');

module.exports = async () => {
  // Start every run from a clean slate (also clears stale worker databases)
  fs.rmSync(ISOLATION_ROOT, { recursive: true, force: true });
  fs.mkdirSync(ISOLATION_ROOT, { recursive: true });

  // Point the database layer at the template BEFORE it is first required —
  // it resolves DB_PATH at module load time.
  process.env.DB_PATH = TEMPLATE_DB;

  const Database = require('../src/utils/database');
  const { runMigrations } = require('../src/utils/migrationRunner');
  try {
    await runMigrations();
  } finally {
    if (typeof Database.close === 'function') {
      await Database.close();
    }
  }
};
