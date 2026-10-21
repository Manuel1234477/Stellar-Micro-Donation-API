#!/usr/bin/env node
/**
 * scripts/require-all.js
 *
 * Boot guard: require() every module under src/ (excluding src/scripts/) with a
 * minimal test environment to catch undefined exports and missing dependencies
 * before they reach production.  Fails on any thrown error.
 *
 * Used by the CI "boot-guard" job (#1927).  Complements the `node --check` syntax
 * pass which only parses files without executing them.
 *
 * Usage:
 *   node scripts/require-all.js
 *
 * Environment:
 *   NODE_ENV=test
 *   API_KEYS=ci_key
 *   ENCRYPTION_KEY=0000...0000 (64-char hex)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'src');
const SCRIPTS_DIR = path.join(SRC_DIR, 'scripts');

const errors = [];
let checked = 0;

/**
 * Recursively collect all .js files under a directory.
 * @param {string} dir
 * @returns {string[]}
 */
function collectJsFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectJsFiles(fullPath));
    } else if (entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) {
      results.push(fullPath);
    }
  }
  return results;
}

// Set minimal env so config/ doesn't reject startup
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
if (!process.env.API_KEYS) process.env.API_KEYS = 'ci_key';
if (!process.env.ENCRYPTION_KEY) {
  process.env.ENCRYPTION_KEY = '0000000000000000000000000000000000000000000000000000000000000000';
}

const files = collectJsFiles(SRC_DIR).filter(
  f => !f.startsWith(SCRIPTS_DIR)
);

for (const file of files) {
  checked++;
  try {
    require(file);
  } catch (err) {
    // Some modules legitimately cannot be required in isolation (e.g. they
    // expect a server lifecycle).  Collect errors and report them all at the
    // end so developers see the full picture.
    errors.push({ file: path.relative(process.cwd(), file), error: err.message });
  }
}

if (errors.length > 0) {
  console.error(`\n❌ require-all: ${errors.length} module(s) failed to load out of ${checked} checked:\n`);
  for (const { file, error } of errors) {
    console.error(`  ${file}\n    → ${error}\n`);
  }
  process.exit(1);
} else {
  console.log(`✅ require-all: all ${checked} module(s) loaded successfully.`);
  process.exit(0);
}
