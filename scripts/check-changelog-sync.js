#!/usr/bin/env node
/**
 * scripts/check-changelog-sync.js
 *
 * CI validation for CHANGELOG.md.
 *
 * Checks:
 *   1. The tracked Markdown changelog exists and has its expected title
 *   2. An Unreleased section is present
 *   3. At least one dated release section is present
 *
 * Usage:
 *   node scripts/check-changelog-sync.js
 *   npm run changelog:check
 *
 * Exit codes:
 *   0  — all checks passed
 *   1  — one or more validation errors found
 */
'use strict';

/* eslint-disable security/detect-object-injection */

const fs = require('fs');
const path = require('path');

const CHANGELOG_PATH = path.join(__dirname, '..', 'CHANGELOG.md');

if (!fs.existsSync(CHANGELOG_PATH)) {
  console.error('CHANGELOG.md is required but was not found.');
  process.exit(1);
}

const changelog = fs.readFileSync(CHANGELOG_PATH, 'utf8');
const requiredSections = [
  ['title', /^# Changelog\s*$/m],
  ['Unreleased section', /^## \[Unreleased\]\s*$/m],
  ['dated release section', /^## \[\d+\.\d+\.\d+\] - \d{4}-\d{2}-\d{2}\s*$/m],
];
const missingSections = requiredSections
  .filter(([, pattern]) => !pattern.test(changelog))
  .map(([name]) => name);

if (missingSections.length > 0) {
  console.error(`CHANGELOG.md is missing required ${missingSections.join(', ')}.`);
  process.exit(1);
}

console.log('CHANGELOG.md has the required title, Unreleased section, and dated release history.');
