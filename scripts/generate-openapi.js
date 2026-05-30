#!/usr/bin/env node
'use strict';

/**
 * Generate docs/openapi.json and docs/openapi.yaml from route JSDoc annotations.
 * Run this after modifying route annotations and commit the result.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { spec } = require('../src/config/openapi');

const jsonPath = path.join(__dirname, '../docs/openapi.json');
const yamlPath = path.join(__dirname, '../docs/openapi.yaml');

fs.writeFileSync(jsonPath, JSON.stringify(spec, null, 2));
console.log(`✓ Generated docs/openapi.json (${Object.keys(spec.paths || {}).length} paths)`);

fs.writeFileSync(yamlPath, yaml.dump(spec, { lineWidth: 120 }));
console.log(`✓ Generated docs/openapi.yaml`);
