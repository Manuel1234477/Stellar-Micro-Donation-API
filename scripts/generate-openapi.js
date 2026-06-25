#!/usr/bin/env node
'use strict';

/**
 * Generate docs/openapi.json and docs/openapi.yaml from route JSDoc annotations.
 * Run this after modifying route annotations and commit the result.
 * 
 * Guarantees byte-stable (deterministic) output so the committed spec is meaningful
 * and CI staleness detection is non-flaky.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { spec, sortObjectKeys } = require('../src/config/openapi');

// Ensure deterministic output by sorting all object keys
const stableSpec = sortObjectKeys(spec);

const jsonPath = path.join(__dirname, '../docs/openapi.json');
const yamlPath = path.join(__dirname, '../docs/openapi.yaml');

fs.writeFileSync(jsonPath, JSON.stringify(stableSpec, null, 2));
console.log(`✓ Generated docs/openapi.json (${Object.keys(stableSpec.paths || {}).length} paths, deterministically sorted)`);

fs.writeFileSync(yamlPath, yaml.dump(stableSpec, { lineWidth: 120 }));
console.log(`✓ Generated docs/openapi.yaml`);
