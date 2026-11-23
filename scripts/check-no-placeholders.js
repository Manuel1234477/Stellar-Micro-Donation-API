#!/usr/bin/env node
'use strict';

/**
 * CI guard: reject tool placeholder markers in tracked files (#2121).
 *
 * Truncation placeholders and handsoff markers were committed to the repo
 * before. The truncated text was lost and the markers added noise. This guard
 * fails with the file and line for any deny-listed pattern.
 *
 * To block a new marker, add an entry to DENY_LIST below.
 *
 * Usage:
 *   node scripts/check-no-placeholders.js              # scan all tracked files
 *   node scripts/check-no-placeholders.js <file> ...   # scan the given files
 *
 * Exit 0 = clean, Exit 1 = a marker was found.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/** This file contains the patterns themselves, so it is never scanned. */
const SELF = 'scripts/check-no-placeholders.js';

/** Each entry: a regex plus the reason it is banned. */
const DENY_LIST = [
  {
    name: 'truncation-placeholder',
    pattern: /truncated \d+ chars/,
    reason: 'tool output truncation placeholder; code was lost',
  },
  {
    name: 'truncation-instruction',
    pattern: /edit only what you need/,
    reason: 'tool output truncation placeholder; code was lost',
  },
  {
    name: 'handsoff-marker',
    pattern: /<!-- handsoff-issue-\d+ -->/,
    reason: 'automation marker appended to a tracked file',
  },
];

/**
 * Find deny-list violations in one file's text.
 *
 * @param {string} file - Repo-relative path (for reporting)
 * @param {string} text - File contents
 * @returns {Array<{file: string, line: number, rule: string, reason: string}>}
 */
function findViolations(file, text) {
  const violations = [];
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    for (const rule of DENY_LIST) {
      if (rule.pattern.test(line)) {
        violations.push({ file, line: index + 1, rule: rule.name, reason: rule.reason });
      }
    }
  });
  return violations;
}

function listTrackedFiles() {
  const output = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' });
  return output.split('\0').filter(Boolean);
}

function main(argv) {
  const requested = argv.length > 0 ? argv : listTrackedFiles();
  const files = requested
    .map((f) => f.split(path.sep).join('/'))
    .filter((f) => f !== SELF);

  const violations = [];
  for (const file of files) {
    const fullPath = path.join(ROOT, file);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) continue;
    const buffer = fs.readFileSync(fullPath);
    if (buffer.includes(0)) continue; // skip binary files
    violations.push(...findViolations(file, buffer.toString('utf8')));
  }

  if (violations.length === 0) {
    console.log('check-no-placeholders: clean');
    return 0;
  }

  console.error(`check-no-placeholders: ${violations.length} placeholder marker(s) found:`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  [${v.rule}] ${v.reason}`);
  }
  console.error('Restore the original content, or remove the marker, then commit again.');
  return 1;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { DENY_LIST, findViolations };
