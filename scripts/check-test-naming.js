#!/usr/bin/env node
'use strict';

/**
 * check-test-naming.js (#1175)
 *
 * Scans the tests/ directory for files that match legacy issue-slug naming
 * patterns.  Used as a lightweight CI gate so no new legacy-named files land
 * while the gradual migration (see docs/TEST_NAMING_CONVENTION.md) is in
 * progress.
 *
 * Behaviour
 * ---------
 * - Prints every legacy-named file it finds.
 * - Exits 0 when only _known_ legacy files are found (migration in progress).
 * - Exits 1 when a file that is NOT in the known-legacy whitelist is found,
 *   meaning a contributor added a new file with the wrong naming.
 *
 * Usage
 * -----
 *   node scripts/check-test-naming.js          # local check
 *   node scripts/check-test-naming.js --strict # treat ALL legacy names as errors
 */

const fs = require('fs');
const path = require('path');

const TESTS_DIR = path.join(__dirname, '..', 'tests');
const STRICT = process.argv.includes('--strict');

// ─── Legacy patterns (issue-slug naming) ─────────────────────────────────────
// A file is "legacy-named" if its basename matches any of these patterns.
const LEGACY_PATTERNS = [
  // issue-NNN or issues-NNN style (anywhere in the tests tree)
  /^issue-\d+/i,
  /^issues-\d+/i,
  // feature-slug style at the repo root tests/ level (not inside a subdirectory)
  /^add-/i,
];

// ─── Known-legacy whitelist ───────────────────────────────────────────────────
// Files that were already in the repo when this rule was introduced.
// They are excluded from the "new violation" check so the build stays green
// until each file is migrated (Phase 1–3 of the migration plan).
// To migrate a file: rename it (git mv), remove it from this list.
// The whitelist is intentionally empty: every legacy-named file must be
// migrated (see issues #1791 / #1792).  Add entries here only as a temporary
// escape hatch while a migration PR is in flight.
const KNOWN_LEGACY = new Set([]);

// ─── Root-level test files ────────────────────────────────────────────────────
// Test files must live in a feature folder (tests/admin, tests/donations, …),
// never directly under tests/.  Only setup/helper files are allowed there.
const ALLOWED_ROOT_TEST_FILES = new Set([
  'tests/setup.js',
  'tests/globalSetup.js',
]);

// ─── Scan ─────────────────────────────────────────────────────────────────────

function walk(dir, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip non-test directories
      if (!['node_modules', '.git', 'coverage', 'dist'].includes(entry.name)) {
        walk(full, results);
      }
    } else if (entry.name.endsWith('.test.js')) {
      results.push(full);
    }
  }
  return results;
}

const allTestFiles = walk(TESTS_DIR);
const legacyFiles = [];
const newViolations = [];
const rootViolations = [];

for (const absPath of allTestFiles) {
  const relPath = path.relative(path.join(__dirname, '..'), absPath).replace(/\\/g, '/');
  const base = path.basename(absPath);

  // (b) No test files directly under tests/ (except setup files).
  if (path.dirname(relPath) === 'tests' && !ALLOWED_ROOT_TEST_FILES.has(relPath)) {
    rootViolations.push(relPath);
  }

  // (a) Legacy issue-slug naming is never allowed.
  const isLegacy = LEGACY_PATTERNS.some((re) => re.test(base));
  if (!isLegacy) continue;

  legacyFiles.push(relPath);
  if (STRICT || !KNOWN_LEGACY.has(relPath)) {
    newViolations.push(relPath);
  }
}

// ─── Output ───────────────────────────────────────────────────────────────────

if (rootViolations.length > 0) {
  console.error(`\n❌  ${rootViolations.length} test file(s) found directly under tests/:\n`);
  for (const f of rootViolations) {
    console.error(`  ❌ ${f}`);
  }
  console.error(
    '\n   Move each suite into the matching feature folder (e.g. tests/services/,\n' +
    '   tests/donations/, tests/routes/).  Only setup files may live in tests/.\n'
  );
}

if (legacyFiles.length === 0 && rootViolations.length === 0) {
  console.log('✅  No legacy-named test files found.');
  process.exit(0);
}

if (legacyFiles.length > 0) {
  console.log(`\nLegacy-named test files (${legacyFiles.length} total):`);
  for (const f of legacyFiles) {
    const isNew = newViolations.includes(f);
    console.log(`  ${isNew ? '❌' : '⚠️ '} ${f}`);
  }
}

if (newViolations.length > 0) {
  console.error(
    `\n❌  ${newViolations.length} new legacy-named file(s) found.\n` +
    '   Please follow the naming convention in docs/TEST_NAMING_CONVENTION.md:\n' +
    '   name your test file after the module it covers, not the issue it fixes.\n'
  );
}

if (newViolations.length > 0 || rootViolations.length > 0) {
  process.exit(1);
}

console.log(
  `\n⚠️   ${legacyFiles.length} known-legacy file(s) above are scheduled for migration.\n` +
  '   See docs/TEST_NAMING_CONVENTION.md for the migration plan.\n' +
  '   No new violations were introduced — build passes.\n'
);
process.exit(0);
