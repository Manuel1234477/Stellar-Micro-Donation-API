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
  
  if (trimmedKey.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(trimmedKey)) {
    fail(
      'ENCRYPTION_KEY',
      `must be exactly 64 hex characters — 64 hexadecimal digits (32 bytes) — got ${trimmedKey.length} chars. ` +
      `Run 'npm run generate-key'`
    );
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

  pass('ENCRYPTION_KEY', isProduction ? 'set and valid (production, 64 hex chars)' : 'set and valid (64 hex chars)');
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

/** Check 3b — Database configuration and WAL mode diagnostics (#1483) */
async function checkDatabaseDiagnostics() {
  try {
    const pragmas = await Database.getDiagnosticPragmas();

    const journalMode = (pragmas.journalMode || 'UNKNOWN').toUpperCase();
    const synchronous = (pragmas.synchronous || 'UNKNOWN').toString();

    if (journalMode === 'WAL') {
      pass('Database WAL mode', 'enabled (concurrent reads during writes)');
    } else if (journalMode === 'ERROR') {
      warn('Database WAL mode', 'could not query pragma — unable to verify mode');
    } else {
      warn('Database WAL mode', `${journalMode} mode active (not WAL) — concurrency may be reduced; enable PRAGMA journal_mode=WAL for better performance`);
    }

    const poolStatus = Database.getPoolStatus();
    const poolInfo = `pool size=${poolStatus.poolSize}, min=${poolStatus.poolMin}, max=${poolStatus.poolMax}`;
    pass('Database pool', poolInfo);

    return true;
  } catch (err) {
    warn('Database diagnostics', `could not query settings: ${err.message}`);
    return true;
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

/** Check — Horizon URL format and reachability policy (#1234) */
function checkHorizonUrl() {
  const raw = process.env.HORIZON_URL;
  if (!raw || !raw.trim()) {
    pass('HORIZON_URL', 'not set — using the default URL for the configured Stellar network');
    return true;
  }
  const value = raw.trim();

  let parsed;
  try {
    parsed = new URL(value);
  } catch (_) {
    fail('HORIZON_URL', `must be a valid URL — got "${value}" (e.g. https://horizon-testnet.stellar.org)`);
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    fail('HORIZON_URL', `must use http(s) — got "${parsed.protocol}//" in "${value}"`);
    return false;
  }

  const isProduction = (process.env.NODE_ENV || '').toLowerCase() === 'production';
  if (isProduction && parsed.protocol !== 'https:') {
    fail('HORIZON_URL', `must use https in production — got "${parsed.protocol}//" (plaintext Horizon traffic is insecure)`);
    return false;
  }

  // Warn when the override does not match the canonical URL for the active network.
  let expected = null;
  try {
    const { environments } = require('../config/stellarEnvironments');
    const rawEnv = (process.env.STELLAR_ENVIRONMENT || 'testnet').toLowerCase();
    const network = (process.env.STELLAR_NETWORK || rawEnv).toLowerCase();
    expected = environments[network] ? environments[network].horizonUrl : null;
  } catch (_) {
    expected = null;
  }

  if (expected && expected !== value) {
    warn(
      'HORIZON_URL',
      `"${value}" does not match the expected URL for the configured network ("${expected}"). ` +
      'Ensure this is intentional — a mismatched Horizon endpoint can silently target the wrong network.'
    );
  } else {
    pass('HORIZON_URL', `valid URL (${parsed.protocol.replace(':', '')})`);
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

/** Check — Database path and permissions (#890, #1234) */
function checkDbPath() {
  if (process.env.DB_PATH === ':memory:') {
    pass('Database path', ':memory: — in-memory database, path checks skipped');
    return true;
  }

  // Resolve the effective DB path the same way src/utils/database.js does.
  const resolvedDbPath = process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.join(__dirname, '../../data/stellar_donations.db');
  const dir = path.dirname(resolvedDbPath);
  let allOk = true;

  try {
    // Parent directory must exist — SQLite cannot create a file in a missing dir.
    if (!fs.existsSync(dir)) {
      fail(
        'Database path',
        `DB_PATH directory "${dir}" does not exist — create it (e.g. mkdir -p "${dir}") or set DB_PATH to an existing directory`
      );
      allOk = false;
    } else {
      try {
        fs.accessSync(dir, fs.constants.W_OK);
      } catch (_) {
        fail('Database path', `DB_PATH directory "${dir}" is not writable — the database file cannot be created there`);
        allOk = false;
      }
    }

    const fileExists = fs.existsSync(resolvedDbPath);
    if (fileExists) {
      try {
        fs.accessSync(resolvedDbPath, fs.constants.R_OK | fs.constants.W_OK);
        pass('Database path', `"${resolvedDbPath}" exists and is readable/writable`);
      } catch (_) {
        fail('Database path', `DB_PATH file "${resolvedDbPath}" is not readable/writable — check its permissions`);
        allOk = false;
      }
    } else {
      pass('Database path', `"${resolvedDbPath}" does not exist yet — it will be created on first use`);
    }

    // Permission hygiene (warn only — operational guidance, not fatal).
    if (fs.existsSync(dir)) {
      const dirMode = fs.statSync(dir).mode & parseInt('777', 8);
      if (dirMode !== parseInt('700', 8)) {
        warn(
          'Database directory permissions',
          `${dir} has permissions ${dirMode.toString(8)} (should be 700). ` +
          `Run: chmod 700 ${dir}`
        );
      } else {
        pass('Database directory permissions', `${dir} is 0700 (owner only)`);
      }
    }

    if (fileExists) {
      const fileMode = fs.statSync(resolvedDbPath).mode & parseInt('777', 8);
      if (fileMode !== parseInt('600', 8)) {
        warn(
          'Database file permissions',
          `${resolvedDbPath} has permissions ${fileMode.toString(8)} (should be 600). ` +
          `Run: chmod 600 ${resolvedDbPath}`
        );
      } else {
        pass('Database file permissions', `${resolvedDbPath} is 0600 (owner only)`);
      }
    }

    return allOk;
  } catch (err) {
    warn('Database path check', err.message);
    return allOk; // Never fail startup on unexpected stat/access errors
  }
}

/** Stellar signing key env vars — validated for format when present (#1234) */
const STELLAR_SIGNING_KEY_VARS = [
  'SERVICE_SECRET_KEY',
  'SERVICE_SIGNING_KEY',
  'STELLAR_SECRET',
  'SPONSOR_SECRET',
];

/** Check — presence/validity of Stellar signing keys (#1234) */
function checkStellarSigningKeys() {
  const { isValidStellarSecretKey } = require('./validators');
  const isProduction = (process.env.NODE_ENV || '').toLowerCase() === 'production';
  const isMock = process.env.MOCK_STELLAR === 'true' || process.env.USE_MOCK_STELLAR === 'true';
  let allOk = true;

  for (const name of STELLAR_SIGNING_KEY_VARS) {
    const val = process.env[name];
    if (!val || !val.trim()) {
      // Optional — only flag absence when a live network is targeted in production.
      if (isProduction && !isMock) {
        warn(name, `not set — service signing / SEP-10 authentication will be unavailable`);
      }
      continue;
    }
    if (!isValidStellarSecretKey(val.trim())) {
      fail(
        name,
        `must be a valid Stellar secret key (56 chars: "S" followed by 55 base32 chars A-Z,2-7) — got ${val.trim().length} chars`
      );
      allOk = false;
      continue;
    }
    pass(name, 'valid Stellar secret key format');
  }

  return allOk;
}

/**
 * Numeric env vars with valid ranges (#1234).
 *
 * severity:
 *   'fail' — the consuming layer hard-throws on an invalid value (e.g. the SQLite
 *            pool in src/utils/database.js), so failing fast at boot with a clear
 *            message beats an obscure failure on the first query.
 *   'warn' — the consuming layer silently falls back to a default; optional
 *            misconfiguration warns rather than aborts.
 */
const NUMERIC_ENV_CHECKS = [
  { name: 'PORT', min: 1, max: 65535, expect: 'an integer between 1 and 65535', severity: 'fail' },
  { name: 'DB_POOL_SIZE', min: 1, expect: 'a positive integer (SQLite connection pool size)', severity: 'fail' },
  { name: 'DB_POOL_MIN', min: 1, expect: 'a positive integer (minimum idle SQLite connections)', severity: 'fail' },
  { name: 'DB_POOL_MAX', min: 1, expect: 'a positive integer (maximum SQLite connections)', severity: 'fail' },
  { name: 'DB_ACQUIRE_TIMEOUT', min: 1, expect: 'a positive integer (milliseconds)', severity: 'fail' },
  { name: 'DB_QUERY_TIMEOUT_MS', min: 1, expect: 'a positive integer (milliseconds)', severity: 'fail' },
  { name: 'SLOW_QUERY_THRESHOLD_MS', min: 0, expect: 'a non-negative integer (milliseconds)', severity: 'fail' },
  { name: 'SLOW_QUERY_BUFFER_SIZE', min: 1, expect: 'a positive integer', severity: 'fail' },
  { name: 'HORIZON_POOL_SIZE', min: 1, max: 10, expect: 'an integer between 1 and 10 (per-process Horizon connections)', severity: 'warn' },
  { name: 'HORIZON_POOL_COOLDOWN_MS', min: 1, expect: 'a positive integer (milliseconds)', severity: 'warn' },
  { name: 'HORIZON_API_TIMEOUT_MS', min: 1, expect: 'a positive integer (milliseconds)', severity: 'warn' },
  { name: 'HORIZON_SUBMIT_TIMEOUT_MS', min: 1, expect: 'a positive integer (milliseconds)', severity: 'warn' },
  { name: 'HORIZON_STREAM_TIMEOUT_MS', min: 1, expect: 'a positive integer (milliseconds)', severity: 'warn' },
  { name: 'HORIZON_MAX_RETRY_ATTEMPTS', min: 0, expect: 'a non-negative integer', severity: 'warn' },
  { name: 'HORIZON_RETRY_BASE_DELAY_MS', min: 1, expect: 'a positive integer (milliseconds)', severity: 'warn' },
  { name: 'HORIZON_RETRY_MAX_DELAY_MS', min: 1, expect: 'a positive integer (milliseconds)', severity: 'warn' },
  { name: 'HORIZON_CB_FAILURE_THRESHOLD', min: 1, expect: 'a positive integer (consecutive failures)', severity: 'warn' },
  { name: 'HORIZON_CB_WINDOW_MS', min: 1, expect: 'a positive integer (milliseconds)', severity: 'warn' },
  { name: 'HORIZON_CB_COOLDOWN_MS', min: 1, expect: 'a positive integer (milliseconds)', severity: 'warn' },
  { name: 'SHUTDOWN_TIMEOUT_MS', min: 1, expect: 'a positive integer (milliseconds)', severity: 'warn' },
  { name: 'SHUTDOWN_TIMEOUT', min: 1, expect: 'a positive integer (milliseconds)', severity: 'warn' },
  { name: 'REQUEST_TIMEOUT_MS', min: 1, expect: 'a positive integer (milliseconds)', severity: 'warn' },
  { name: 'MOCK_STELLAR_LATENCY_MS', min: 0, expect: 'a non-negative integer (milliseconds)', severity: 'warn' },
];

/**
 * Check — numeric ranges for pool sizes and timeouts (#1234).
 * Values whose consumer hard-throws are hard failures; values whose consumer
 * silently falls back to a default produce a warning instead.
 */
function checkNumericRanges() {
  let allOk = true;

  for (const { name, min, max, expect, severity } of NUMERIC_ENV_CHECKS) {
    const raw = process.env[name];
    if (raw === undefined || raw === null || String(raw).trim() === '') continue;
    const value = String(raw).trim();

    const report = (status, detail) => {
      if (status === 'fail') {
        fail(name, detail);
        allOk = false;
      } else {
        warn(name, detail);
      }
    };

    if (!/^-?\d+$/.test(value)) {
      report(severity, `must be ${expect} — got "${value}"`);
      continue;
    }

    const num = parseInt(value, 10);
    if (num < min || (max !== undefined && num > max)) {
      report(severity, `must be ${expect} — got ${num}`);
      continue;
    }

    // Coherence checks between related variables (always warnings — both values
    // are individually valid, the combination is just incoherent).
    if (name === 'DB_POOL_MIN' && process.env.DB_POOL_MAX !== undefined &&
        num > parseInt(process.env.DB_POOL_MAX, 10)) {
      warn('DB_POOL_MIN', `must be <= DB_POOL_MAX (${process.env.DB_POOL_MAX}) — got ${num}`);
      continue;
    }
    if (name === 'DB_POOL_MAX' && process.env.DB_POOL_MIN !== undefined &&
        num < parseInt(process.env.DB_POOL_MIN, 10)) {
      warn('DB_POOL_MAX', `must be >= DB_POOL_MIN (${process.env.DB_POOL_MIN}) — got ${num}`);
      continue;
    }
    if (name === 'HORIZON_RETRY_MAX_DELAY_MS' && process.env.HORIZON_RETRY_BASE_DELAY_MS !== undefined &&
        num < parseInt(process.env.HORIZON_RETRY_BASE_DELAY_MS, 10)) {
      warn('HORIZON_RETRY_MAX_DELAY_MS', `must be >= HORIZON_RETRY_BASE_DELAY_MS (${process.env.HORIZON_RETRY_BASE_DELAY_MS}) — got ${num}`);
      continue;
    }
  }
  return allOk;
}

/** Check — mutually-exclusive / co-required flags (#1234) */
function checkCoRequiredFlags() {
  const isProduction = (process.env.NODE_ENV || '').toLowerCase() === 'production';
  let allOk = true;

  // SIGNING_PROVIDER must be a known backend and carry its required credentials.
  const signingProvider = (process.env.SIGNING_PROVIDER || 'local').toLowerCase();
  if (!['local', 'hsm', 'kms'].includes(signingProvider)) {
    fail('SIGNING_PROVIDER', `must be one of: local, hsm, kms — got "${process.env.SIGNING_PROVIDER}"`);
    allOk = false;
  } else if (signingProvider === 'hsm') {
    if (!process.env.HSM_SLOT_ID || !process.env.HSM_PIN) {
      fail('SIGNING_PROVIDER', 'SIGNING_PROVIDER=hsm requires HSM_SLOT_ID and HSM_PIN to be set');
      allOk = false;
    } else {
      pass('SIGNING_PROVIDER', 'hsm configured (HSM_SLOT_ID and HSM_PIN present)');
    }
  } else if (signingProvider === 'kms') {
    if (!process.env.KMS_PROVIDER || !process.env.KMS_KEY_ID) {
      fail('SIGNING_PROVIDER', 'SIGNING_PROVIDER=kms requires KMS_PROVIDER and KMS_KEY_ID to be set');
      allOk = false;
    } else {
      pass('SIGNING_PROVIDER', 'kms configured (KMS_PROVIDER and KMS_KEY_ID present)');
    }
  } else {
    pass('SIGNING_PROVIDER', 'local (in-process signing)');
  }

  // REQUIRE_REQUEST_SIGNING=true needs the HMAC secret to verify signatures.
  if (process.env.REQUIRE_REQUEST_SIGNING === 'true' && !process.env.REQUEST_SIGNING_SECRET) {
    fail('REQUIRE_REQUEST_SIGNING', '=true requires REQUEST_SIGNING_SECRET to be set — inbound request signatures cannot be verified without it');
    allOk = false;
  }

  // RATE_LIMIT_STORE=redis needs a Redis connection URL.
  const rateLimitStore = (process.env.RATE_LIMIT_STORE || 'memory').toLowerCase();
  if (!['memory', 'redis'].includes(rateLimitStore)) {
    fail('RATE_LIMIT_STORE', `must be one of: memory, redis — got "${process.env.RATE_LIMIT_STORE}"`);
    allOk = false;
  } else if (rateLimitStore === 'redis') {
    if (!process.env.REDIS_URL) {
      fail('RATE_LIMIT_STORE', '=redis requires REDIS_URL to be set — rate-limit counters have no backing store');
      allOk = false;
    } else {
      pass('RATE_LIMIT_STORE', 'redis configured (REDIS_URL present)');
    }
  }

  // ENCRYPTION_KEY_VERSION=1 requires the previous key for rotation.
  if (process.env.ENCRYPTION_KEY_VERSION === '1' && !process.env.ENCRYPTION_KEY_1) {
    fail('ENCRYPTION_KEY_VERSION', '=1 requires ENCRYPTION_KEY_1 (the previous key) to be set — key rotation cannot start without it');
    allOk = false;
  }

  // Mocking Stellar in production means no real transactions — dangerous for a payments service.
  const isMock = process.env.MOCK_STELLAR === 'true' || process.env.USE_MOCK_STELLAR === 'true';
  if (isProduction && isMock) {
    warn('MOCK_STELLAR', '=true in production — no real Stellar transactions will be sent; disable it before deploying');
  }

  // STELLAR_ENVIRONMENT and STELLAR_NETWORK disagreeing is confusing; STELLAR_NETWORK wins.
  if (process.env.STELLAR_ENVIRONMENT && process.env.STELLAR_NETWORK &&
      process.env.STELLAR_ENVIRONMENT.toLowerCase() !== process.env.STELLAR_NETWORK.toLowerCase()) {
    warn(
      'STELLAR_ENVIRONMENT',
      `"${process.env.STELLAR_ENVIRONMENT}" differs from STELLAR_NETWORK "${process.env.STELLAR_NETWORK}" — ` +
      'STELLAR_NETWORK takes precedence; set both to the same value to avoid confusion'
    );
  }

  return allOk;
}

/** Check — Geo-blocking database presence when strict mode is active (#1533) */
function checkGeoBlocking() {
  const strictMode = process.env.GEO_STRICT_MODE !== 'false';
  const rawBlocked = process.env.GEO_BLOCKED_COUNTRIES;
  const blockedCountries = rawBlocked ? rawBlocked.split(',').map(s => s.trim()).filter(Boolean) : [];
  const dbPath = process.env.MAXMIND_DB_PATH || path.join(__dirname, '../../data/GeoLite2-Country.mmdb');

  if (blockedCountries.length > 0) {
    if (!fs.existsSync(dbPath)) {
      if (strictMode) {
        fail('Geo-blocking', `GEO_BLOCKED_COUNTRIES is configured but MaxMind database not found at "${dbPath}" with GEO_STRICT_MODE=true`);
        return false;
      }
      warn('Geo-blocking', `GEO_BLOCKED_COUNTRIES is configured but MaxMind database not found at "${dbPath}" (GEO_STRICT_MODE=false; geo-blocking inactive)`);
    } else {
      pass('Geo-blocking', `MaxMind database found, blocking ${blockedCountries.length} country/countries`);
    }
  } else {
    pass('Geo-blocking', 'no country restrictions configured');
  }
  return true;
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
    checkSecretStrength(),      // #1117
    checkUnsafeFlags(),         // #1116
    checkHorizonUrl(),          // #1234
    checkDbPath(),              // #890, #1234
    checkStellarSigningKeys(),  // #1234
    checkNumericRanges(),       // #1234
    checkCoRequiredFlags(),     // #1234
    checkGeoBlocking(),         // #1533
    await checkDatabase(),
    await checkDatabaseDiagnostics(), // #1483
    await checkStellarNetwork(),
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
