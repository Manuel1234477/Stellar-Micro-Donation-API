#!/usr/bin/env node
/**
 * CI guard — fail if runtime data or scratch files are tracked by git.
 *
 * Tracked paths that must not exist:
 *   - anything under data/ except data/.gitkeep (backups, JSON stores, SQLite
 *     databases, memo keys)
 *   - root-level tmp-* scratch scripts (e.g. tmp-debug.js; one such script wiped
 *     the wallets table when run against a local database)
 *
 * Run: node scripts/check-no-tracked-artifacts.js
 * Exit 0 = clean, Exit 1 = violations found.
 */

'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const ALLOWED = new Set(['data/.gitkeep']);

const BANNED = [
  { label: 'runtime data directory', test: (file) => file.startsWith('data/') && !ALLOWED.has(file) },
  { label: 'root scratch script', test: (file) => /^tmp-[^/]*$/.test(file) },
];

function listTrackedFiles() {
  const output = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' });
  return output.split('\0').filter(Boolean);
}

function main() {
  const violations = [];

  for (const file of listTrackedFiles()) {
    const rule = BANNED.find((r) => r.test(file));
    if (rule) violations.push({ file, label: rule.label });
  }

  if (violations.length === 0) {
    console.log('check-no-tracked-artifacts: clean');
    return 0;
  }

  console.error(`check-no-tracked-artifacts: ${violations.length} tracked artifact(s) found:`);
  for (const v of violations) {
    console.error(`  ${v.file}  (${v.label})`);
  }
  console.error('Remove them with `git rm --cached <file>`; runtime data must stay untracked.');
  return 1;
}

process.exitCode = main();
