#!/usr/bin/env node
'use strict';

/**
 * CI check: verify docs/openapi.json is in sync with route annotations.
 * Exits with code 1 if the committed spec differs from the generated one.
 */

const fs = require('fs');
const path = require('path');

const committedPath = path.join(__dirname, '../docs/openapi.json');
const { spec } = require('../src/config/openapi');

const generated = JSON.stringify(spec, null, 2);

if (!fs.existsSync(committedPath)) {
  console.error('ERROR: docs/openapi.json does not exist. Run: node scripts/generate-openapi.js');
  process.exit(1);
}

const committed = fs.readFileSync(committedPath, 'utf8');

if (committed.trim() !== generated.trim()) {
  console.error('ERROR: docs/openapi.json is out of sync with route annotations.');
  console.error('Run: node scripts/generate-openapi.js and commit the result.');
  process.exit(1);
}

console.log('✓ docs/openapi.json is in sync with route annotations.');
