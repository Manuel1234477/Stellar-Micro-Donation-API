#!/usr/bin/env node
/**
 * scripts/boot-guard.js
 *
 * Fast, dependency-free CI guard (#1927) that catches boot blockers before
 * they reach main:
 *
 * 1. `node --check` on every src/**/*.js and scripts/**/*.js file (syntax parse)
 * 2. `require()` every module under src/ (excludes src/scripts/) with a minimal
 *    test environment to catch undefined exports and missing dependencies
 * 3. Boot check: require('./src/app').createApp exists and returns an object
 *
 * This complements, not replaces, the lint / typecheck / test matrix.  The job
 * is designed to complete in under a minute.
 *
 * Usage:
 *   npm run boot-guard
 *
 * Exit code 0 = all checks passed, 1 = at least one check failed.
 */

'use strict';

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const errors = [];

// ── 1. node --check on every .js file in src/ and scripts/ ────────────────────

function collectJsFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // Skip node_modules, test fixtures, etc.
    if (entry.name === 'node_modules' || entry.name === '__mocks__') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectJsFiles(fullPath));
    } else if (entry.name.endsWith('.js')) {
      results.push(fullPath);
    }
  }
  return results;
}

const srcFiles = collectJsFiles(path.join(ROOT, 'src'));
const scriptsFiles = collectJsFiles(path.join(ROOT, 'scripts'));
const allFiles = [...srcFiles, ...scriptsFiles];

let syntaxFailed = 0;
for (const file of allFiles) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    syntaxFailed++;
    errors.push({
      check: 'node --check',
      file: path.relative(ROOT, file),
      error: (result.stderr || result.stdout || '').trim(),
    });
  }
}

if (syntaxFailed === 0) {
  console.log(`✅ node --check: all ${allFiles.length} file(s) parsed successfully.`);
} else {
  console.error(`❌ node --check: ${syntaxFailed}/${allFiles.length} file(s) failed to parse.`);
}

// ── 2. require-all (delegate to require-all.js) ───────────────────────────────

const requireAllResult = spawnSync(process.execPath, [path.join(__dirname, 'require-all.js')], {
  encoding: 'utf8',
  cwd: ROOT,
  env: {
    ...process.env,
    NODE_ENV: 'test',
    API_KEYS: 'ci_key',
    ENCRYPTION_KEY: '0000000000000000000000000000000000000000000000000000000000000000',
  },
});

console.log(requireAllResult.stdout);
if (requireAllResult.stderr) console.error(requireAllResult.stderr);

if (requireAllResult.status !== 0) {
  errors.push({
    check: 'require-all',
    file: '-',
    error: `require-all exited with status ${requireAllResult.status}`,
  });
}

// ── 3. Boot check: createApp is callable ─────────────────────────────────────

const bootCheckResult = spawnSync(
  process.execPath,
  ['-e', "require('./src/app').createApp ? console.log('✅ boot-check: createApp() is callable.') : (console.error('❌ boot-check: createApp() missing or not callable.'), process.exit(1))"],
  {
    encoding: 'utf8',
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      API_KEYS: 'ci_key',
      ENCRYPTION_KEY: '0000000000000000000000000000000000000000000000000000000000000000',
    },
  }
);

console.log(bootCheckResult.stdout);
if (bootCheckResult.stderr) console.error(bootCheckResult.stderr);

if (bootCheckResult.status !== 0) {
  errors.push({
    check: 'boot-check',
    file: 'src/app.js',
    error: `boot-check exited with status ${bootCheckResult.status}`,
  });
}

// ── Summary ──────────────────────────────────────────────────────────────────

if (errors.length > 0) {
  console.error(`\n❌ boot-guard: ${errors.length} check(s) failed:\n`);
  for (const { check, file, error } of errors) {
    console.error(`  [${check}] ${file}`);
    console.error(`    → ${error}\n`);
  }
  process.exit(1);
} else {
  console.log('\n✅ boot-guard: all checks passed.');
  process.exit(0);
}
