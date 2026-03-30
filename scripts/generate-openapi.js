#!/usr/bin/env node
'use strict';

/**
 * Generate docs/openapi.json from route JSDoc annotations.
 * Run this after modifying route annotations and commit the result.
 */

const fs = require('fs');
const path = require('path');
const { spec } = require('../src/config/openapi');

const outPath = path.join(__dirname, '../docs/openapi.json');
fs.writeFileSync(outPath, JSON.stringify(spec, null, 2));
console.log(`✓ Generated docs/openapi.json (${Object.keys(spec.paths || {}).length} paths)`);
