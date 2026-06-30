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
const KNOWN_LEGACY = new Set([
  // Root-level issue-slug files
  'tests/issues-65-66-67-68.test.js',
  'tests/issues-764-765-766-767.test.js',
  'tests/issues-796-797-798.test.js',
  'tests/issues-802-803.test.js',
  'tests/issue-806.test.js',
  'tests/security-issues-1122-1123-1124-1125.test.js',
  // Root-level feature-slug files
  'tests/add-pagination-to-all-list-endpoints.test.js',
  'tests/add-support-for-donation-notes-and-tags.test.js',
  'tests/add-openapiswagger-documentation-generation.test.js',
  // tests/issues/ sub-directory (all files there are issue-scoped by design —
  // they will be moved in Phase 2 of the migration)
  'tests/issues/issue-908-db-tracing.test.js',
  'tests/issues/issues-1144-1145-1146-1147.test.js',
  'tests/issues/issue-63-mock-latency.test.js',
  'tests/issues/issue-61-extend-api-key.test.js',
  'tests/issues/issues-18-19-20-21.test.js',
  'tests/issues/issues-1116-1117-1118-1119.test.js',
  'tests/issues/808-next-execution-date.test.js',
  'tests/issues/issue-1157-idempotency.test.js',
  'tests/issues/issue-916-exponential-backoff.test.js',
  'tests/issues/issues-1160-1161-1162-1163.test.js',
  'tests/issues/issue-64-system-info.test.js',
  'tests/issues/issue-39-patch-stream-schedule.test.js',
  'tests/issues/issue-909-receipt-get.test.js',
  'tests/issues/issue-910-cors-config.test.js',
  'tests/issues/debug-patch.test.js',
  'tests/issues/issues-918-919-920-921.test.js',
  'tests/issues/issue-917-transaction-sync-pagination.test.js',
  'tests/issues/issue-123-async-donation-export.test.js',
  'tests/issues/issue-62-wallet-tx-pagination.test.js',
  'tests/issues/issue-911-soft-delete-schedule.test.js',
  'tests/issues/issues-69-70-71.test.js',
  'tests/issues/issue-915-wallet-balance-endpoint.test.js',
  'tests/issues/issues-1144-1145-1146-1147.test.js',
  // tests/admin/ issue-prefixed files (pre-existing)
  'tests/admin/issue-104-keys-import.test.js',
  'tests/admin/issue-105-pending-transactions.test.js',
  'tests/admin/issue-106-db-reindex.test.js',
  'tests/admin/issue-107-matching-status.test.js',
  'tests/admin/issue-108-quota-usage.test.js',
  'tests/admin/issue-110-anomalies.test.js',
  'tests/admin/issue-111-cost-breakdown.test.js',
  // tests/config/ issue-prefixed files (pre-existing)
  'tests/config/issue-1101-encryption-key-validation.test.js',
  // tests/donations/ issue-prefixed files (pre-existing)
  'tests/donations/issue-109-donation-notes.test.js',
  // tests/misc/ issue-prefixed files (pre-existing)
  'tests/misc/issue-793-tiers-public.test.js',
  'tests/misc/issue-794-fees.test.js',
  'tests/misc/issue-795-donations-pending.test.js',
  // tests/routes/ issue-prefixed files (pre-existing)
  'tests/routes/issue-1113-csv-formula-injection.test.js',
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

for (const absPath of allTestFiles) {
  const relPath = path.relative(path.join(__dirname, '..'), absPath).replace(/\\/g, '/');
  const base = path.basename(absPath);

  const isLegacy = LEGACY_PATTERNS.some((re) => re.test(base));
  if (!isLegacy) continue;

  legacyFiles.push(relPath);
  if (STRICT || !KNOWN_LEGACY.has(relPath)) {
    newViolations.push(relPath);
  }
}

// ─── Output ───────────────────────────────────────────────────────────────────

if (legacyFiles.length === 0) {
  console.log('✅  No legacy-named test files found.');
  process.exit(0);
}

console.log(`\nLegacy-named test files (${legacyFiles.length} total):`);
for (const f of legacyFiles) {
  const isNew = newViolations.includes(f);
  console.log(`  ${isNew ? '❌' : '⚠️ '} ${f}`);
}

if (newViolations.length > 0) {
  console.error(
    `\n❌  ${newViolations.length} new legacy-named file(s) found.\n` +
    '   Please follow the naming convention in docs/TEST_NAMING_CONVENTION.md:\n' +
    '   name your test file after the module it covers, not the issue it fixes.\n'
  );
  process.exit(1);
}

console.log(
  `\n⚠️   ${legacyFiles.length} known-legacy file(s) above are scheduled for migration.\n` +
  '   See docs/TEST_NAMING_CONVENTION.md for the migration plan.\n' +
  '   No new violations were introduced — build passes.\n'
);
process.exit(0);
