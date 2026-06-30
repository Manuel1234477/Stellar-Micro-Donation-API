#!/usr/bin/env node
/**
 * scripts/check-changelog-sync.js
 *
 * CI validation for CHANGELOG.json.
 *
 * Checks:
 *   1. File exists and is valid JSON
 *   2. schemaVersion matches expected value (1.0.0)
 *   3. Each Change_Entry has required fields with correct types
 *   4. affectedEndpoints entries have method + path
 *   5. Change_Type is one of the allowed values
 *
 * Usage:
 *   node scripts/check-changelog-sync.js
 *   npm run changelog:check
 *
 * Exit codes:
 *   0  — all checks passed
 *   1  — one or more validation errors found
 */
'use strict';

const fs = require('fs');
const path = require('path');

const CHANGELOG_JSON_PATH = path.join(__dirname, '..', 'CHANGELOG.json');
const EXPECTED_SCHEMA_VERSION = '1.0.0';

const VALID_CHANGE_TYPES = new Set([
  'added', 'changed', 'deprecated', 'removed', 'fixed', 'security',
]);

const REQUIRED_ENTRY_FIELDS = ['version', 'type', 'description', 'affectedEndpoints', 'timestamp', 'commitHash', 'isBreaking'];

let errors = 0;

function fail(msg) {
  console.error(`  ✗ ${msg}`);
  errors++;
}

function pass(msg) {
  console.log(`  ✓ ${msg}`);
}

// ── 1. File existence and JSON parse ─────────────────────────────────────────
console.log('\nChecking CHANGELOG.json …\n');

if (!fs.existsSync(CHANGELOG_JSON_PATH)) {
  // If no CHANGELOG.json exists yet, that is acceptable (generator hasn't been run)
  console.log('  ℹ  CHANGELOG.json not found — skipping validation (run `npm run changelog:write` to generate).');
  process.exit(0);
}

let changelog;
try {
  changelog = JSON.parse(fs.readFileSync(CHANGELOG_JSON_PATH, 'utf8'));
  pass('CHANGELOG.json is valid JSON');
} catch (e) {
  fail(`CHANGELOG.json is not valid JSON: ${e.message}`);
  process.exit(1);
}

// ── 2. Schema version ─────────────────────────────────────────────────────────
if (changelog.schemaVersion === EXPECTED_SCHEMA_VERSION) {
  pass(`schemaVersion is "${EXPECTED_SCHEMA_VERSION}"`);
} else {
  fail(`schemaVersion is "${changelog.schemaVersion}", expected "${EXPECTED_SCHEMA_VERSION}"`);
}

// ── 3. changes array ─────────────────────────────────────────────────────────
if (!Array.isArray(changelog.changes)) {
  fail('"changes" must be an array');
  process.exit(1);
} else {
  pass(`changes is an array with ${changelog.changes.length} entries`);
}

// ── 4. Validate each entry ────────────────────────────────────────────────────
let entryErrors = 0;

for (let i = 0; i < changelog.changes.length; i++) {
  const entry = changelog.changes[i];
  const prefix = `changes[${i}]`;

  // Required fields
  for (const field of REQUIRED_ENTRY_FIELDS) {
    if (entry[field] === undefined || entry[field] === null) {
      fail(`${prefix}: missing required field "${field}"`);
      entryErrors++;
    }
  }

  // type must be a valid Change_Type
  if (entry.type !== undefined && !VALID_CHANGE_TYPES.has(entry.type)) {
    fail(`${prefix}: invalid type "${entry.type}". Must be one of: ${[...VALID_CHANGE_TYPES].join(', ')}`);
    entryErrors++;
  }

  // affectedEndpoints must be an array
  if (!Array.isArray(entry.affectedEndpoints)) {
    fail(`${prefix}: affectedEndpoints must be an array`);
    entryErrors++;
  } else {
    // Each endpoint must have method + path
    for (let j = 0; j < entry.affectedEndpoints.length; j++) {
      const ep = entry.affectedEndpoints[j];
      if (!ep.method || typeof ep.method !== 'string') {
        fail(`${prefix}.affectedEndpoints[${j}]: missing or invalid "method" field`);
        entryErrors++;
      }
      if (!ep.path || typeof ep.path !== 'string') {
        fail(`${prefix}.affectedEndpoints[${j}]: missing or invalid "path" field`);
        entryErrors++;
      }
    }
  }

  // timestamp should be ISO-8601
  if (entry.timestamp && isNaN(Date.parse(entry.timestamp))) {
    fail(`${prefix}: timestamp "${entry.timestamp}" is not a valid ISO-8601 date`);
    entryErrors++;
  }

  // isBreaking must be boolean
  if (entry.isBreaking !== undefined && typeof entry.isBreaking !== 'boolean') {
    fail(`${prefix}: isBreaking must be a boolean`);
    entryErrors++;
  }
}

if (entryErrors === 0) {
  pass(`All ${changelog.changes.length} Change_Entry records are valid`);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('');
if (errors === 0) {
  console.log('✅  CHANGELOG.json is valid.\n');
  process.exit(0);
} else {
  console.error(`❌  Found ${errors} validation error(s). Fix them and re-run.\n`);
  process.exit(1);
}
