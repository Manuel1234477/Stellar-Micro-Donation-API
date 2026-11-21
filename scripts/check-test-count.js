#!/usr/bin/env node
'use strict';

/**
 * check-test-count.js (#2105)
 *
 * Fails when Jest executed noticeably fewer test suites than the committed
 * baseline. A crashed globalSetup, a mistyped --testPathPattern or a bad
 * testPathIgnorePatterns entry can silently drop most of the suite while the
 * run still reports success. This check compares the executed count from the
 * Jest JSON report against scripts/test-suite-baseline.json.
 *
 * Usage
 * -----
 *   node scripts/check-test-count.js                  # compare (CI gate)
 *   node scripts/check-test-count.js --update         # rewrite the baseline
 *   node scripts/check-test-count.js --report <file>  # custom Jest JSON path
 *
 * Updating the baseline
 * ---------------------
 * Only update the baseline in a PR that legitimately removes or consolidates
 * suites. Run `npm run test:coverage:ci` first, then
 * `node scripts/check-test-count.js --update`, and mention the reason in the PR.
 *
 * Exit codes: 0 ok, 1 suite count below threshold or report missing/invalid.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BASELINE_PATH = path.join(__dirname, 'test-suite-baseline.json');
const DEFAULT_REPORT = path.join(ROOT, 'coverage', 'jest-results.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function parseArgs(argv) {
  const args = { update: false, report: DEFAULT_REPORT };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--update') args.update = true;
    else if (argv[i] === '--report') args.report = path.resolve(argv[++i] || '');
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(args.report)) {
    console.error(`❌  Jest JSON report not found at ${path.relative(ROOT, args.report)}.`);
    console.error('   Run `npm run test:coverage:ci` first.');
    return 1;
  }

  const report = readJson(args.report);
  const executed = report.numTotalTestSuites;
  if (!Number.isInteger(executed)) {
    console.error('❌  Jest report has no numTotalTestSuites field.');
    return 1;
  }

  if (args.update) {
    const baseline = {
      numTotalTestSuites: executed,
      tolerancePercent: readJson(BASELINE_PATH).tolerancePercent ?? 5,
    };
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n');
    console.log(`✅  Baseline updated to ${executed} suites in ${path.relative(ROOT, BASELINE_PATH)}.`);
    return 0;
  }

  if (!fs.existsSync(BASELINE_PATH)) {
    console.error(`❌  Baseline file missing: ${path.relative(ROOT, BASELINE_PATH)}.`);
    return 1;
  }

  const { numTotalTestSuites: expected, tolerancePercent = 5 } = readJson(BASELINE_PATH);
  const minimum = Math.floor(expected * (1 - tolerancePercent / 100));
  const difference = executed - expected;

  console.log(
    `Test suites executed: ${executed}, baseline: ${expected}, ` +
      `difference: ${difference >= 0 ? '+' : ''}${difference}, ` +
      `minimum allowed: ${minimum} (${tolerancePercent}% tolerance)`
  );

  if (executed < minimum) {
    console.error(
      `\n❌  Jest ran ${expected - executed} fewer suites than the baseline allows.\n` +
        '   If the drop is intentional, update the baseline in this PR with\n' +
        '   `node scripts/check-test-count.js --update` and explain why.\n'
    );
    return 1;
  }

  console.log('✅  Executed suite count is within the allowed range.');
  return 0;
}

process.exitCode = main();
