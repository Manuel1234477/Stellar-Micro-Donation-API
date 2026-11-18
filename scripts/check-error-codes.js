#!/usr/bin/env node
/**
 * scripts/check-error-codes.js (Issue #1957)
 *
 * Ratchet check for error codes emitted by the API.
 *
 * Scans `src/` for literal error codes (`code: 'UPPER_SNAKE'` and `res.failure('...')`)
 * and requires each one to be either:
 *   1. catalogued in src/utils/errors.js (ERROR_CODES), or
 *   2. listed in scripts/error-codes-baseline.txt (legacy codes, grandfathered).
 *
 * New codes therefore must be catalogued. The baseline may only shrink: when a
 * baseline entry becomes catalogued the check asks you to remove it, so the
 * list converges to empty.
 *
 * Usage:
 *   node scripts/check-error-codes.js            # check (exit 1 on violations)
 *   node scripts/check-error-codes.js --update   # rewrite the baseline (removes stale entries)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const BASELINE = path.join(__dirname, 'error-codes-baseline.txt');
const CODE_RE = /(?:code:\s*|res\.failure\(\s*)['"]([A-Z][A-Z0-9_]+)['"]/g;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function collectUsedCodes() {
  const used = new Map(); // code -> first file that emits it
  for (const file of walk(SRC)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(CODE_RE)) {
      if (!used.has(match[1])) used.set(match[1], path.relative(ROOT, file));
    }
  }
  return used;
}

function catalogedCodes() {
  const { ERROR_CODES } = require('../src/utils/errors');
  return new Set(Object.values(ERROR_CODES).map(c => c.code));
}

function readBaseline() {
  if (!fs.existsSync(BASELINE)) return new Set();
  return new Set(
    fs.readFileSync(BASELINE, 'utf8')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#')),
  );
}

function main() {
  const used = collectUsedCodes();
  const catalogued = catalogedCodes();
  const baseline = readBaseline();

  const uncatalogued = [...used.keys()].filter(c => !catalogued.has(c));
  const violations = uncatalogued.filter(c => !baseline.has(c));
  const stale = [...baseline].filter(c => catalogued.has(c) || !used.has(c));

  if (process.argv.includes('--update')) {
    const lines = [
      '# Legacy error codes emitted in src/ that are not yet in ERROR_CODES.',
      '# Ratchet: this list may only shrink. Add codes to src/utils/errors.js instead.',
      '# Regenerate with: node scripts/check-error-codes.js --update',
      ...uncatalogued.sort(),
    ];
    fs.writeFileSync(BASELINE, lines.join('\n') + '\n', 'utf8');
    console.log(`✓ Baseline written with ${uncatalogued.length} legacy codes`);
    return 0;
  }

  if (violations.length) {
    console.error('✗ Uncatalogued error codes (add them to src/utils/errors.js ERROR_CODES):');
    for (const c of violations) console.error(`    ${c}  (first seen in ${used.get(c)})`);
    return 1;
  }

  if (stale.length) {
    console.error('✗ Stale entries in scripts/error-codes-baseline.txt (remove them, or run --update):');
    for (const c of stale) console.error(`    ${c}`);
    return 1;
  }

  console.log(`✓ ${used.size} error codes checked; ${uncatalogued.length} legacy codes remain in the baseline`);
  return 0;
}

process.exitCode = main();
