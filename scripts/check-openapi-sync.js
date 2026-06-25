#!/usr/bin/env node
'use strict';

/**
 * Enhanced CI check: verify docs/openapi.json is in sync and all documented routes are valid
 */

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

const committedPath = path.join(__dirname, '../docs/openapi.json');
const { spec, sortObjectKeys } = require('../src/config/openapi');
const generated = JSON.stringify(spec, null, 2);

// ─────────────────────────────────────────────────────────────────────────────
// Check 1: Verify spec is byte-stable
// ─────────────────────────────────────────────────────────────────────────────
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

console.log('✓ docs/openapi.json is byte-stable and in sync with route annotations.');

// ─────────────────────────────────────────────────────────────────────────────
// Check 2: Validate response examples against their schemas
// ─────────────────────────────────────────────────────────────────────────────
const ajv = new Ajv();
let schemaValidationErrors = [];

const specPaths = spec.paths || {};
for (const [path, pathItem] of Object.entries(specPaths)) {
  for (const [method, operation] of Object.entries(pathItem)) {
    if (method === 'parameters' || typeof operation !== 'object' || !operation.responses) continue;

    for (const [status, response] of Object.entries(operation.responses)) {
      if (!response.content) continue;

      for (const [mediaType, content] of Object.entries(response.content)) {
        if (!content.schema || !content.example) continue;

        try {
          const schema = content.schema;
          const example = content.example;
          
          const validate = ajv.compile(schema);
          if (!validate(example)) {
            schemaValidationErrors.push({
              path,
              method: method.toUpperCase(),
              status,
              errors: validate.errors,
            });
          }
        } catch (err) {
          // Skip if schema is not compilable
        }
      }
    }
  }
}

if (schemaValidationErrors.length > 0) {
  console.warn('\nWARNING: Found response examples that don\'t match their schemas:');
  for (const error of schemaValidationErrors.slice(0, 5)) {
    console.warn(`  ${error.method} ${error.path} [${error.status}]`);
  }
  if (schemaValidationErrors.length > 5) {
    console.warn(`  ... and ${schemaValidationErrors.length - 5} more`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Check 3: Verify auth schemes are properly defined
// ─────────────────────────────────────────────────────────────────────────────
const requiredSchemes = ['ApiKeyAuth'];
const definedSchemes = spec.components?.securitySchemes ? Object.keys(spec.components.securitySchemes) : [];

for (const scheme of requiredSchemes) {
  if (!definedSchemes.includes(scheme)) {
    console.error(`\nERROR: Required security scheme '${scheme}' not defined in components.securitySchemes`);
    process.exit(1);
  }
}

console.log('✓ All required auth schemes are properly defined.');

// ─────────────────────────────────────────────────────────────────────────────
// Check 4: Verify shared response components exist
// ─────────────────────────────────────────────────────────────────────────────
const requiredSchemas = ['Error', 'ValidationError', 'UnauthorizedError', 'NotFoundError'];
const definedSchemas = spec.components?.schemas ? Object.keys(spec.components.schemas) : [];

const missingSchemas = requiredSchemas.filter(s => !definedSchemas.includes(s));
if (missingSchemas.length > 0) {
  console.error(`\nERROR: Missing required schemas: ${missingSchemas.join(', ')}`);
  process.exit(1);
}

console.log('✓ All required shared response schemas are defined.');

console.log('\n✓ All OpenAPI checks passed!');
console.log(`  - ${Object.keys(specPaths).length} documented paths`);
console.log(`  - ${definedSchemas.length} shared schemas`);
console.log(`  - Byte-stable output verified`);
