#!/usr/bin/env node
/**
 * validate-env — Environment variable validation script
 *
 * Checks all variables listed in .env.example.
 * - Required variables: exit 1 if missing or empty.
 * - Optional variables: warn if present but invalid.
 *
 * Output symbols:
 *   ✅  valid
 *   ⚠️   warning (optional, present but invalid format)
 *   ❌  error   (required and missing, or critically invalid)
 */

'use strict';

require('dotenv').config();

let errors = 0;
let warnings = 0;

function ok(name, detail) {
  console.log(`  ✅  ${name}${detail ? ': ' + detail : ''}`);
}

function warn(name, detail) {
  warnings++;
  console.warn(`  ⚠️   ${name}: ${detail}`);
}

function error(name, detail) {
  errors++;
  console.error(`  ❌  ${name}: ${detail}`);
}

// ── Validators ────────────────────────────────────────────────────────────

function isBool(v) { return v === 'true' || v === 'false'; }
function isPositiveInt(v) { return /^\d+$/.test(v) && parseInt(v, 10) > 0; }
function isNonNegativeInt(v) { return /^\d+$/.test(v); }
function isPositiveNumber(v) { return !isNaN(parseFloat(v)) && parseFloat(v) > 0; }
function isNonNegativeNumber(v) { return !isNaN(parseFloat(v)) && parseFloat(v) >= 0; }

function isValidUrl(v) {
  try { new URL(v); return true; } catch { return false; }
}

// ── Required variables ────────────────────────────────────────────────────

function checkRequired(name, validator, hint) {
  const v = process.env[name];
  if (!v || !v.trim()) {
    error(name, `required but not set${hint ? ' — ' + hint : ''}`);
    return;
  }
  if (validator && !validator(v.trim())) {
    error(name, hint || 'invalid value');
    return;
  }
  ok(name);
}

// ── Optional variables ────────────────────────────────────────────────────

function checkOptional(name, validator, hint) {
  const v = process.env[name];
  if (!v || !v.trim()) return; // absent is fine
  if (validator && !validator(v.trim())) {
    warn(name, hint || 'invalid value');
  } else {
    ok(name);
  }
}

// ── Checks ────────────────────────────────────────────────────────────────

console.log('\nValidating environment variables…\n');

// REQUIRED
checkRequired(
  'ENCRYPTION_KEY',
  v => /^[0-9a-fA-F]{64}$/.test(v),
  'must be exactly 64 hex characters — run `npm run generate-key`'
);

checkRequired('API_KEYS', v => v.split(',').map(k => k.trim()).filter(Boolean).length > 0,
  'must contain at least one API key (comma-separated)');

// OPTIONAL — server
checkOptional('PORT',
  v => isPositiveInt(v) && parseInt(v, 10) <= 65535,
  'must be an integer between 1 and 65535');

checkOptional('NODE_ENV',
  v => ['development', 'production', 'test'].includes(v),
  'must be one of: development, production, test');

// OPTIONAL — Stellar
checkOptional('STELLAR_ENVIRONMENT',
  v => ['testnet', 'mainnet', 'futurenet'].includes(v),
  'must be one of: testnet, mainnet, futurenet');

checkOptional('HORIZON_URL', isValidUrl, 'must be a valid URL');

checkOptional('MOCK_STELLAR', isBool, 'must be true or false');

// OPTIONAL — database
checkOptional('DB_TYPE', v => v === 'sqlite', 'must be: sqlite');
checkOptional('DB_PATH'); // any non-empty string is valid
checkOptional('DB_POOL_SIZE', isPositiveInt, 'must be a positive integer');
checkOptional('DB_ACQUIRE_TIMEOUT', isPositiveInt, 'must be a positive integer (milliseconds)');

// OPTIONAL — API
checkOptional('API_PREFIX', v => v.startsWith('/'), 'must start with /');
checkOptional('RATE_LIMIT', isPositiveInt, 'must be a positive integer');

// OPTIONAL — CORS
checkOptional('CORS_ALLOWED_ORIGINS', v => {
  return v.split(',').map(o => o.trim()).every(o => {
    if (o === '*') return true;
    try { new URL(o); return true; } catch { return false; }
  });
}, 'must be a comma-separated list of valid origins or *');

// OPTIONAL — logging
checkOptional('LOG_TO_FILE', isBool, 'must be true or false');
checkOptional('LOG_DIR'); // any non-empty string is valid
checkOptional('LOG_VERBOSE', isBool, 'must be true or false');
checkOptional('DEBUG_MODE', isBool, 'must be true or false');

// OPTIONAL — donation limits
checkOptional('MIN_DONATION_AMOUNT', isPositiveNumber, 'must be a positive number');
checkOptional('MAX_DONATION_AMOUNT', isPositiveNumber, 'must be a positive number');
checkOptional('MAX_DAILY_DONATION_PER_DONOR', isNonNegativeNumber, 'must be a non-negative number');

// ── Summary ───────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(50));
if (errors === 0 && warnings === 0) {
  console.log('✅  All environment variables are valid.\n');
} else {
  if (warnings > 0) console.warn(`⚠️   ${warnings} warning(s)`);
  if (errors > 0)   console.error(`❌  ${errors} error(s) — fix the above before starting the server\n`);
  else              console.log('');
}

if (errors > 0) process.exit(1);
