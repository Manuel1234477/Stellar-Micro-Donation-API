#!/usr/bin/env node
'use strict';

/**
 * Run every repository guard locally, in the same order CI uses (#2119).
 *
 * Usage: npm run verify
 *
 * Runs each step even when an earlier one fails, so a single run shows every
 * problem. Prints a summary table and exits 1 if any step failed. CI's `verify`
 * job runs this same script, so local and CI results cannot drift.
 */

const { spawnSync } = require('child_process');

/** Ordered list of npm scripts. Add a guard here and it is enforced everywhere. */
const STEPS = [
  'check:no-float-money',
  'check:declared-deps',
  'check:test-naming',
  'check:isolation',
  'check:i18n-orphans',
  'check:no-silent-catch',
  'check:no-tracked-artifacts',
  'validate:rbac',
  'check:orphans',
  'check:docs',
  'openapi:check',
  'changelog:check',
  'typecheck',
  'boot-guard',
];

/**
 * Run one npm script and capture its output.
 *
 * @param {string} name - npm script name
 * @returns {{name: string, ok: boolean, durationMs: number, output: string}}
 */
function runStep(name) {
  const start = Date.now();
  const result = spawnSync('npm', ['run', '--silent', name], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  return {
    name,
    ok: result.status === 0,
    durationMs: Date.now() - start,
    output,
  };
}

/** Print a fixed-width summary table. */
function printSummary(results) {
  const nameWidth = Math.max(...results.map((r) => r.name.length), 'STEP'.length);
  const line = '-'.repeat(nameWidth + 22);
  console.log(`\n${line}`);
  console.log(`${'STEP'.padEnd(nameWidth)}  ${'RESULT'.padEnd(6)}  TIME`);
  console.log(line);
  for (const r of results) {
    const status = r.ok ? 'PASS' : 'FAIL';
    console.log(`${r.name.padEnd(nameWidth)}  ${status.padEnd(6)}  ${(r.durationMs / 1000).toFixed(1)}s`);
  }
  console.log(line);
}

function main() {
  const results = [];
  for (const name of STEPS) {
    console.log(`\n==> npm run ${name}`);
    const result = runStep(name);
    results.push(result);
    if (!result.ok) {
      // Show the output of failing steps only, so passing steps stay quiet.
      process.stdout.write(result.output);
    }
  }

  printSummary(results);

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`\n${failed.length} of ${results.length} check(s) failed: ${failed.map((r) => r.name).join(', ')}`);
    process.exit(1);
  }
  console.log(`\nAll ${results.length} checks passed.`);
}

if (require.main === module) {
  main();
}

module.exports = { STEPS };
