#!/usr/bin/env node
'use strict';

/**
 * check-parse.js (#1978)
 *
 * Parse guard for the application and tooling. Runs `node --check` on every
 * .js file under src/ and scripts/ and exits non-zero if any file has a syntax
 * error. It catches the class of break that previously reached main (route files
 * that do not parse) before a PR can merge. It does not execute any code, so it
 * needs no environment variables or database.
 *
 * Usage:
 *   node scripts/check-parse.js
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIRS = ['src', 'scripts'];

function listJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function main() {
  const files = DIRS.flatMap((d) => {
    const abs = path.join(ROOT, d);
    return fs.existsSync(abs) ? listJsFiles(abs) : [];
  }).sort();

  const failures = [];
  for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) {
      failures.push({ file: path.relative(ROOT, file), error: (result.stderr || '').trim().split('\n').slice(0, 4).join('\n') });
    }
  }

  if (failures.length > 0) {
    console.error(`check-parse: ${failures.length} file(s) fail to parse:\n`);
    for (const f of failures) console.error(`  ${f.file}\n${f.error}\n`);
    process.exit(1);
  }
  console.log(`check-parse: ${files.length} file(s) parse cleanly`);
}

main();
