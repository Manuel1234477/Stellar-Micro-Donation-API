#!/usr/bin/env node
/**
 * check-src-orphans.js
 *
 * Uses madge to detect orphaned source modules — files inside src/ that are
 * never imported by any other file in the project.
 *
 * Entry points (files that are allowed to have no importers) are listed in
 * ALLOWLIST below. These are modules intentionally invoked directly (server
 * bootstrap, CLI scripts, etc.) rather than required by other modules.
 *
 * Exit 0 = clean (no unexpected orphans)
 * Exit 1 = unexpected orphaned modules found
 *
 * Usage:
 *   node scripts/check-src-orphans.js
 *   npm run check:orphans
 */

'use strict';

const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

// Files inside src/ that are intentional orphans (entry points or scripts
// invoked directly via node/npm run, not required by any other module).
const ALLOWLIST = new Set([
  // App entry point
  'src/app.js',

  // CLI / one-shot scripts — invoked via npm run or node directly
  'src/scripts/initDB.js',
  'src/scripts/migrate.js',
  'src/scripts/migrate-rollback.js',
  'src/scripts/migrate-status.js',
  'src/scripts/addMemoColumn.js',
  'src/scripts/reencrypt-memos.js',
  'src/scripts/migrations/addCurrencyColumns.js',
  'src/scripts/generateKey.js',
  'src/scripts/rotateKEK.js',
  'src/scripts/manageApiKeys.js',
  'src/scripts/security-scan.js',
]);

let madgeOutput;
try {
  // --orphans: only list files with no importers
  // --warning: suppress non-fatal circular-dependency warnings
  madgeOutput = execSync(
    'npx madge --orphans --extensions js src/',
    {
      cwd: ROOT,
      encoding: 'utf8',
      // stderr goes to the terminal so CI can see madge warnings
      stdio: ['pipe', 'pipe', 'inherit'],
    }
  );
} catch (err) {
  // madge exits non-zero when orphans are found; capture stdout from the error
  madgeOutput = err.stdout || '';
  if (!madgeOutput && err.message) {
    console.error('[check-src-orphans] Failed to run madge:', err.message);
    process.exit(2);
  }
}

// madge --orphans prints one relative path per line (relative to the first
// argument, i.e. src/), prefixed with optional ANSI colour codes.
const rawLines = madgeOutput
  .split('\n')
  .map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').trim())  // strip ANSI
  .filter(Boolean);

// Re-root paths relative to the project root so they match ALLOWLIST entries.
const orphans = rawLines
  .map((rel) => `src/${rel}`)
  .filter((p) => !ALLOWLIST.has(p));

if (orphans.length === 0) {
  const total = rawLines.length;
  const skipped = total - orphans.length;
  console.log(
    `[check-src-orphans] OK — no unexpected orphans` +
    (skipped > 0 ? ` (${skipped} allowlisted entry point(s) ignored)` : '') +
    '.'
  );
  process.exit(0);
}

console.error('\n[check-src-orphans] FAIL — The following src/ modules have no importers:\n');
for (const file of orphans) {
  console.error(`  ❌ ${file}`);
}
console.error(
  '\nEither wire each module into the application, move it to a scripts/' +
  ' entry point, add it to the ALLOWLIST in scripts/check-src-orphans.js,' +
  ' or delete it along with its tests.\n'
);
process.exit(1);
