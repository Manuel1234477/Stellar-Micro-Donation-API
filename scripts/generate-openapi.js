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

/**
 * Attempt to locate the source file and line for a YAML parse error.
 *
 * swagger-jsdoc parses each route file's @openapi block individually, but the
 * resulting error message only contains a line number relative to the block.
 * We scan route files for @openapi blocks and try to parse each one so we can
 * report the offending file path and the absolute line number.
 *
 * @param {Error} err - The error thrown during spec generation.
 * @returns {string|null} A human-readable location string, or null if unknown.
 */
function locateYamlError(err) {
  const message = String((err && err.message) || err || '');
  const lineMatch = message.match(/at line (\d+), column (\d+)/i);
  if (!lineMatch) {
    return null;
  }
  const targetLine = parseInt(lineMatch[1], 10);

  const routesDir = path.join(__dirname, '../src/routes');
  let files = [];
  try {
    files = collectJsFiles(routesDir);
  } catch (e) {
    return null;
  }

  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch (e) {
      continue;
    }
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (!/@openapi\b/.test(lines[i])) {
        continue;
      }
      // Collect the JSDoc block starting at this line.
      const blockLines = [];
      let j = i;
      // Find the start of the comment block (walk back to the opening /**).
      let start = i;
      while (start > 0 && !/\/\*\*/.test(lines[start])) {
        start--;
      }
      // Collect until the closing */.
      let end = start;
      while (end < lines.length && !/\*\//.test(lines[end])) {
        end++;
      }
      // Extract the YAML portion (strip leading " * ").
      const yamlLines = [];
      let yamlStartLine = -1;
      for (let k = start; k <= end && k < lines.length; k++) {
        const stripped = lines[k].replace(/^\s*\*\s?/, '');
        if (yamlStartLine === -1 && /@openapi\b/.test(lines[k])) {
          yamlStartLine = k;
          continue;
        }
        if (yamlStartLine !== -1) {
          yamlLines.push(stripped);
        }
      }
      if (yamlStartLine === -1) {
        continue;
      }
      const yamlText = yamlLines.join('\n');
      try {
        yaml.load(yamlText);
      } catch (parseErr) {
        const blockLineMatch = String(parseErr.message || '').match(/at line (\d+), column (\d+)/i);
        if (blockLineMatch) {
          const blockLine = parseInt(blockLineMatch[1], 10);
          // The YAML text starts on the line after @openapi.
          const absoluteLine = yamlStartLine + blockLine + 1;
          return `${file}:${absoluteLine} (${parseErr.message.split('\n')[0]})`;
        }
      }
    }
  }

  return null;
}

/**
 * Recursively collect .js files under a directory.
 * @param {string} dir
 * @returns {string[]}
 */
function collectJsFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectJsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      results.push(full);
    }
  }
  return results;
}

// Ensure deterministic output by sorting all object keys
let stableSpec;
try {
  stableSpec = sortObjectKeys(spec);
} catch (err) {
  const location = locateYamlError(err);
  if (location) {
    console.error(`ERROR: Failed to generate OpenAPI spec. YAML parse error in ${location}`);
  } else {
    console.error(`ERROR: Failed to generate OpenAPI spec: ${err && err.message ? err.message : err}`);
  }
  process.exit(1);
}

const jsonPath = path.join(__dirname, '../docs/openapi.json');
const yamlPath = path.join(__dirname, '../docs/openapi.yaml');

fs.writeFileSync(jsonPath, JSON.stringify(stableSpec, null, 2));
console.log(`✓ Generated docs/openapi.json (${Object.keys(stableSpec.paths || {}).length} paths, deterministically sorted)`);

fs.writeFileSync(yamlPath, yaml.dump(stableSpec, { lineWidth: 120 }));
console.log(`✓ Generated docs/openapi.yaml`);