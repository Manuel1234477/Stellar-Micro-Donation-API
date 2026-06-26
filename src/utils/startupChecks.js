/**
 * Startup Checks Module
 *
 * RESPONSIBILITY: Verify critical configuration and dependencies before the server
 *                 accepts traffic. Fails fast on misconfiguration.
 * OWNER: Backend Team
 *
 * Usage:
 *   node src/utils/startupChecks.js        — run checks and exit
 *   require('./startupChecks').run()        — run checks programmatically
 */

'use strict';

const Database = require('./database');
const fs = require('fs');
const path = require('path');

const STELLAR_TIMEOUT_MS = 5000;

const results = [];

function pass(name, detail) {
  results.push({ name, status: 'pass', detail });
  console.log(`  ✔ ${name}${detail ? ': ' + detail : ''}`);
}

function warn(name, detail) {
  results.push({ name, status: 'warn', detail });
  console.warn(`  ⚠ ${name}${detail ? ': ' + detail : ''}`);
}

function fail(name, detail) {
  results.push({ name, status: 'fail', detail });
  console.error(`  ✖ ${name}${detail ? ': ' + detail : ''}`);
}

/** Patterns that indicate a placeholder / example ENCRYPTION_KEY */
const PLACEHOLDER_KEY_PATTERNS = [
  /^<.*>$/,                      // literal angle-bracket placeholder from .env.example
  /^dev_key_/i,                  // example prefix from .env.example
  /^test_/i,                     // common test prefix
  /^your[_-]/i,                  // "your_key_here" style docs
  /^change[_-]me/i,              // "change-me" style docs
  /^(?:0{32,}|1{32,}|a{32,})/i, // trivially weak repeated chars (e.g. 64 zeroes)
  /^example/i,
  /^placeholder/i,
  /^todo/i,
  /^fixme/i,
];

/** Check 1 — ENCRYPTION_KEY is set, non-placeholder, and has sufficient length */
function checkEncryptionKey() {
  const key = process.env.ENCRYPTION_KEY;
  const isProduction = (process.env.NODE_ENV || '').toLowerCase() === 'production';

  if (!key || !key.trim()) {
    fail('ENCRYPTION_KEY', 'required but not set — run `npm run generate-key`');
    return false;
  }
  const trimmedKey = key.trim();
  
  if (trimmedKey.length !== 64) {
    fail('ENCRYPTION_KEY', `must be exactly 64 hex characters (32 bytes), got ${trimmedKey.length} — run `npm run generate-key``);
    return false;
  }

  if (isProduction) {
    const isPlaceholder = PLACEHOLDER_KEY_PATTERNS.some((re) => re.test(key));
    if (isPlaceholder) {
      fail(
        'ENCRYPTION_KEY',
        'placeholder or example key detected in production. ' +
        'Generate a real key with `npm run generate-key` and supply it via a secrets manager. ' +
        'See docs/SECRETS_LIFECYCLE.md for the recommended provisioning path.'
      );
      return false;
    }
  }

  pass('ENCRYPTION_KEY', isProduction ? 'set and valid (production)' : 'set and valid');
  return true;
}

/** Check 2 — API_KEYS is configured and not using example values in production */
function checkApiKeys() {
  const raw = process.env.API_KEYS;
  const isProduction = (process.env.NODE_ENV || '').toLowerCase() === 'production';

  if (!raw || !raw.trim()) {
    fail('API_KEYS', 'not set — no requests will be authenticated');
    return false;
  }
  const keys = raw.split(',').map(k => k.trim()).filter(Boolean);
  if (keys.length === 0) {
    fail('API_KEYS', 'set but contains no valid keys');
    return false;
  }

  if (isProduction) {
    const exampleKeys = keys.filter((k) =>
      PLACEHOLDER_KEY_PATTERNS.some((re) => re.test(k)) ||
      /^dev_key_1234|^dev_key_abcdef/i.test(k)
    );
    if (exampleKeys.length > 0) {
      fail(
        'API_KEYS',
        `${exampleKeys.length} example/placeholder key(s) detected in production. ` +
        'Remove example keys (e.g. dev_key_1234567890) and provision real secrets. ' +
        'See docs/SECRETS_LIFECYCLE.md.'
      );
      return false;
    }
    warn(
      'API_KEYS (legacy)',
      `${keys.length} legacy key(s) detected in production. ` +
      'Legacy keys bypass quota tracking and cannot be revoked without a restart. ' +
      'Migrate to database-backed keys before 2026-12-31. ' +
      'See docs/MIGRATION_LEGACY_API_KEYS.md'
    );
  } else {
    pass('API_KEYS', `${keys.length} legacy key(s) configured (non-production)`);
  }
  return true;
}

/** Check 3 — Database connectivity */
async function checkDatabase() {
  try {
    await Database.get('SELECT 1 as ok');
    pass('Database', 'reachable');
    return true;
  } catch (err) {
    fail('Database', err.message);
    return false;
  }
}

/** Secrets that must each be >= 32 bytes (64 hex chars or 32+ raw chars) */
const SIGNING_SECRETS = [
  'EXPORT_SIGNING_SECRET',
  'ANONYMOUS_DONATION_SECRET',
  'JWT_SECRET',
];

const KNOWN_PLACEHOLDERS = [
  'changeme', 'secret', 'password', 'change_me', 'change-me',
  'your-secret', 'your_secret', 'placeholder', 'example', 'todo', 'fixme',
];

function isWeakSecret(val) {
  if (!val || val.trim().length === 0) return true;
  const v = val.trim();
  // Minimum 32 bytes: hex string needs 64 chars, others need 32 chars
  const byteLen = /^[0-9a-f]+$/i.test(v) ? v.length / 2 : v.length;
  if (byteLen < 32) return true;
  const lower = v.toLowerCase();
  if (KNOWN_PLACEHOLDERS.some(p => lower.includes(p))) return true;
  if (PLACEHOLDER_KEY_PATTERNS.some(re => re.test(v))) return true;
  return false;
}

/** Check — signing/encryption secrets meet minimum strength and are not duplicated */
function checkSecretStrength() {
  const isProduction = (process.env.NODE_ENV || '').toLowerCase() === 'production';
  let allOk = true;
  const presentSecrets = new Map(); // value -> name, for duplicate detection

  // Include ENCRYPTION_KEY in cross-role duplicate check
  const encKey = process.env.ENCRYPTION_KEY;
  if (encKey) presentSecrets.set(encKey.trim(), 'ENCRYPTION_KEY');

  for (const name of SIGNING_SECRETS) {
    const val = process.env[name];
    if (!val) {
      // Only warn in dev; these are optional integrations
      if (isProduction) {
        warn(name, `not set — this secret is required in production`);
      }
      continue;
    }
    if (isWeakSecret(val)) {
      fail(name, `weak or placeholder secret detected — must be >= 32 bytes and not a known placeholder`);
      allOk = false;
      continue;
    }
    const trimmed = val.trim();
    const duplicate = presentSecrets.get(trimmed);
    if (duplicate) {
      fail(name, `identical to ${duplicate} — secrets must be unique across roles`);
      allOk = false;
      continue;
    }
    presentSecrets.set(trimmed, name);
    pass(name, 'strength OK');
  }

  return allOk;
}

/** Check — unsafe dev flags must not be enabled in production (#1116) */
function checkUnsafeFlags() {
  const isProduction = (process.env.NODE_ENV || '').toLowerCase() === 'production';

  const UNSAFE_FLAGS = [
    { env: 'DISABLE_RATE_LIMIT', value: 'true' },
    { env: 'CORS_ALLOW_ALL',     value: 'true' },
    { env: 'DEBUG_MODE',         value: 'true' },
    { env: 'DRY_RUN',            value: 'true' },
  ];

  let allOk = true;
  for (const { env, value } of UNSAFE_FLAGS) {
    const active = (process.env[env] || '').toLowerCase() === value;
    if (!active) continue;
    if (isProduction) {
      fail(env, `${env}=${value} is not allowed in production — disable it before deploying`);
      allOk = false;
    } else {
      warn(env, `${env}=${value} is active — safe for local dev only, never enable in production`);
    }
  }

  if (allOk && isProduction) pass('Unsafe flags', 'none active in production');
  return allOk;
}

/** Check 4 — CORS configuration safety */
function checkCorsConfig() {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const allowAll = process.env.CORS_ALLOW_ALL === 'true';
  const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS || '';

  // Hard error: wildcard CORS in production is forbidden
  if (allowAll && nodeEnv === 'production') {
    fail(
      'CORS',
      'CORS_ALLOW_ALL=true is set in production — this allows all origins and must not be used in production. ' +
      'Set CORS_ALLOWED_ORIGINS to an explicit allowlist and remove CORS_ALLOW_ALL.'
    );
    return false;
  }

  // Warning: no allowlist configured outside pure local development
  if (!allowedOrigins.trim() && nodeEnv !== 'development') {
    warn(
      'CORS',
      'CORS_ALLOWED_ORIGINS is not set and NODE_ENV is not "development". ' +
      'All cross-origin requests will be rejected. ' +
      'Set CORS_ALLOWED_ORIGINS to a comma-separated list of allowed origins.'
    );
  } else if (!allowedOrigins.trim() && nodeEnv === 'development' && !allowAll) {
    pass('CORS', 'development mode — localhost origins allowed by default');
  } else if (allowAll && nodeEnv === 'development') {
    warn('CORS', 'CORS_ALLOW_ALL=true in development — all origins are permitted (acceptable for local dev only)');
  } else {
    const count = allowedOrigins.split(',').map(o => o.trim()).filter(Boolean).length;
    pass('CORS', `CORS_ALLOWED_ORIGINS configured (${count} origin(s))`);
  }

  return true;
}

/** Check 5 — Stellar network connectivity (with timeout) */
async function checkStellarNetwork() {
  try {
    const serviceContainer = require('../config/serviceContainer');
    const stellarService = serviceContainer.getStellarService();

    if (!stellarService.server || typeof stellarService.server.root !== 'function') {
      warn('Stellar network', 'mock mode — skipping live connectivity check');
      return true;
    }

    await Promise.race([
      stellarService.server.root(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`timed out after ${STELLAR_TIMEOUT_MS}ms`)), STELLAR_TIMEOUT_MS)
      ),
    ]);

    const network = stellarService.getNetwork ? stellarService.getNetwork() : 'unknown';
    pass('Stellar network', `reachable (${network})`);
    return true;
  } catch (err) {
    fail('Stellar network', err.message);
    return false;
  }
}

/** Check 5 — Database file and directory permissions (Issue #890) */
function checkDatabasePermissions() {
  const DATA_DIR = './data';
  const DB_PATH = path.join(DATA_DIR, 'stellar_donations.db');

  try {
    // Check data directory permissions
    if (fs.existsSync(DATA_DIR)) {
      const dirStats = fs.statSync(DATA_DIR);
      const dirMode = dirStats.mode & parseInt('777', 8);
      
      if (dirMode !== parseInt('700', 8)) {
        warn(
          'Database directory permissions',
          `${DATA_DIR} has permissions ${(dirMode).toString(8)} (should be 700). ` +
          'Run: chmod 700 data'
        );
      } else {
        pass('Database directory permissions', `${DATA_DIR} is 0700 (owner only)`);
      }
    }

    // Check database file permissions
    if (fs.existsSync(DB_PATH)) {
      const fileStats = fs.statSync(DB_PATH);
      const fileMode = fileStats.mode & parseInt('777', 8);
      
      if (fileMode !== parseInt('600', 8)) {
        warn(
          'Database file permissions',
          `${DB_PATH} has permissions ${(fileMode).toString(8)} (should be 600). ` +
          'Run: chmod 600 data/stellar_donations.db'
        );
      } else {
        pass('Database file permissions', `${DB_PATH} is 0600 (owner only)`);
      }
    }

    return true;
  } catch (err) {
    warn('Database permissions check', err.message);
    return true; // Don't fail on permission check errors
  }
}

/**
 * Non-blocking DB integrity check run at startup.
 * Logs result at INFO level, or ERROR if corruption is detected.
 */
async function runDbIntegrityCheck() {
  const log = require('./log');
  const startedAt = Date.now();
  const issues = [];

  try {
    const integrityRows = await Database.query('PRAGMA integrity_check', []);
    for (const row of integrityRows) {
      const msg = row.integrity_check || row[Object.keys(row)[0]];
      if (msg && msg !== 'ok') issues.push(`integrity_check: ${msg}`);
    }

    const fkRows = await Database.query('PRAGMA foreign_key_check', []);
    for (const row of fkRows) {
      issues.push(`foreign_key_check: table=${row.table} rowid=${row.rowid} parent=${row.parent} fkid=${row.fkid}`);
    }
  } catch (err) {
    issues.push(`check_error: ${err.message}`);
  }

  const durationMs = Date.now() - startedAt;

  if (issues.length === 0) {
    log.info('STARTUP', 'Database integrity check passed', { durationMs });
  } else {
    log.error('STARTUP', 'Database integrity check found issues', { issues, durationMs });
  }
}

/**
 * Run all startup checks.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.exitOnFailure=false] - call process.exit(1) if any critical check fails
 * @returns {Promise<{passed: boolean, results: Array}>}
 */
async function run({ exitOnFailure = false } = {}) {
  console.log('\nRunning startup checks…\n');

  // CORS safety check runs first — a production misconfiguration is a hard failure
  const corsOk = checkCorsConfig();
  if (!corsOk && exitOnFailure) {
    console.error('\nStartup checks FAILED ✖ (CORS misconfiguration in production)\n');
    process.exit(1);
  }

  const criticalResults = [
    corsOk,
    checkEncryptionKey(),
    checkApiKeys(),
    checkSecretStrength(),   // #1117
    checkUnsafeFlags(),      // #1116
    await checkDatabase(),
    await checkStellarNetwork(),
    checkDatabasePermissions(),
  ];

  // Non-blocking DB integrity check — log result but never fail startup
  runDbIntegrityCheck().catch(() => {});

  const passed = criticalResults.every(Boolean);

  console.log(`\nStartup checks ${passed ? 'passed ✔' : 'FAILED ✖'}\n`);

  if (!passed && exitOnFailure) {
    process.exit(1);
  }

  return { passed, results };
}

module.exports = { run, results };

// Allow running directly: `node src/utils/startupChecks.js`
if (require.main === module) {
  // Load .env when run standalone
  require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
  run({ exitOnFailure: true }).catch((err) => {
    console.error('Startup checks threw an unexpected error:', err.message);
    process.exit(1);
  });
}
