#!/usr/bin/env node
'use strict';

/**
 * Mutation Testing Runner
 *
 * Runs Stryker mutation tests on critical modules to measure test effectiveness.
 * Requires: npm install --save-dev @stryker-mutator/core @stryker-mutator/jest-runner
 *
 * Usage:
 *   npm run mutation:test       - Run once and generate report
 *   npm run mutation:watch      - Run in watch mode
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const strykerPath = path.join(__dirname, '../node_modules/.bin/stryker');
const confPath = path.join(__dirname, '../stryker.conf.json');

// Check if Stryker is installed
if (!fs.existsSync(strykerPath)) {
  console.error('❌ Stryker is not installed.');
  console.error('');
  console.error('Install mutation testing tools:');
  console.error('  npm install --save-dev @stryker-mutator/core @stryker-mutator/jest-runner');
  console.error('');
  console.error('Then run mutation tests:');
  console.error('  npm run mutation:test');
  console.error('');
  console.error('For more info, see: mutation-testing-guide.md');
  process.exit(1);
}

try {
  const args = process.argv.slice(2);
  const cmd = `"${strykerPath}" run ${confPath} ${args.join(' ')}`;
  console.log(`Running: ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
} catch (err) {
  console.error('\n❌ Mutation testing failed.');
  console.error('See reports/mutation/index.html for details.');
  process.exit(1);
}
