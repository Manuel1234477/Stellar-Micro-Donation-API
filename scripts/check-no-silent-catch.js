#!/usr/bin/env node

'use strict';

/**
 * Guard against silently swallowed errors (#1946).
 *
 * An empty catch block, or `.catch(() => {})`, hides failures. A catch is
 * acceptable only when it:
 *   - routes the error through the best-effort helper (`bestEffort(...)` or
 *     `reportBestEffortFailure(...)`), or
 *   - contains a comment explaining why the error is ignored.
 *
 * Usage: node scripts/check-no-silent-catch.js
 * Exits 1 and lists every offending site when any are found.
 */

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'src');

// `.catch(() => {})`, `.catch((_e) => { })`
const EMPTY_PROMISE_CATCH = /\.catch\(\s*\(\s*\w*\s*\)\s*=>\s*\{\s*\}\s*\)/g;
// `catch (e) {}`, `catch {}` with whitespace-only body (no comment, no code)
const EMPTY_BLOCK_CATCH = /catch\s*(\(\s*\w*\s*\))?\s*\{\s*\}/g;

function listSourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

/**
 * Find silent catch sites in a source string.
 * @param {string} source
 * @returns {Array<{line: number, text: string}>}
 */
function findSilentCatches(source) {
  const lines = source.split('\n');
  const hits = [];
  for (const re of [EMPTY_PROMISE_CATCH, EMPTY_BLOCK_CATCH]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(source)) !== null) {
      const line = source.slice(0, m.index).split('\n').length;
      // A comment on the same line or the line directly above documents the
      // deliberate choice to ignore the error.
      const justified = /\/\/|\/\*/.test(lines[line - 1] || '') || /\/\/|\*\//.test(lines[line - 2] || '');
      if (!justified) hits.push({ line, text: m[0] });
    }
  }
  return hits.sort((a, b) => a.line - b.line);
}

function main() {
  const violations = [];
  for (const file of listSourceFiles(SRC_DIR)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const hit of findSilentCatches(source)) {
      violations.push({ file: path.relative(path.join(__dirname, '..'), file), ...hit });
    }
  }

  if (violations.length === 0) {
    console.log('check-no-silent-catch: OK (no silent catch blocks in src/)');
    return 0;
  }

  console.error(`check-no-silent-catch: ${violations.length} silent catch block(s) found:`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.text}`);
  }
  console.error('Route the error through bestEffort()/reportBestEffortFailure(), or add a comment explaining why it is ignored.');
  return 1;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { findSilentCatches };
