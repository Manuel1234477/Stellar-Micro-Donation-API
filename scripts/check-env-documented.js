#!/usr/bin/env node
'use strict';

/**
 * check-env-documented.js (#1785)
 *
 * CI gate. Fails when:
 *   1. code under src/ reads an environment variable that is not declared in
 *      src/config/envSchema.js, or
 *   2. .env.example / docs/CONFIGURATION.md are out of date with the schema
 *      (so every declared variable is listed in .env.example).
 *
 * Usage: node scripts/check-env-documented.js
 * Fix:   declare the variable in src/config/envSchema.js, then
 *        `npm run config:generate`.
 */

const fs = require('fs');
const path = require('path');
const { ENV_VARS, ENV_VAR_PATTERNS, IMPLICIT_ENV_VARS } = require('../src/config/envSchema');
const { diffGeneratedFiles } = require('./generate-config-docs');

const ROOT = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const ENV_EXAMPLE_PATH = path.join(ROOT, '.env.example');

// `process.env.NAME` and `process.env['NAME']` / `process.env["NAME"]`.
const ENV_READ_RE = /process\.env(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\])/g;

function collectJsFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectJsFiles(full, files);
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}

/** @returns {Map<string, string[]>} variable name -> "file:line" locations */
function collectEnvReads(dir = SRC_DIR) {
  const reads = new Map();
  for (const file of collectJsFiles(dir)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const m of line.matchAll(ENV_READ_RE)) {
        const name = m[1] || m[2];
        if (!reads.has(name)) reads.set(name, []);
        reads.get(name).push(`${path.relative(ROOT, file)}:${i + 1}`);
      }
    });
  }
  return reads;
}

function isDeclared(name) {
  return ENV_VARS.some((v) => v.name === name)
    || ENV_VAR_PATTERNS.some((p) => p.pattern.test(name))
    || IMPLICIT_ENV_VARS.has(name);
}

/** @returns {Array<{name: string, locations: string[]}>} */
function findUndocumented(dir = SRC_DIR) {
  const missing = [];
  for (const [name, locations] of collectEnvReads(dir)) {
    if (!isDeclared(name)) missing.push({ name, locations });
  }
  return missing.sort((a, b) => a.name.localeCompare(b.name));
}

/** @returns {string[]} problems with the generated files */
function checkGeneratedFiles() {
  const problems = [];
  const example = fs.existsSync(ENV_EXAMPLE_PATH) ? fs.readFileSync(ENV_EXAMPLE_PATH, 'utf8') : '';
  for (const def of ENV_VARS) {
    if (!new RegExp(`^(# )?${def.name}=`, 'm').test(example)) {
      problems.push(`${def.name} is missing from .env.example`);
    }
  }
  for (const stale of diffGeneratedFiles()) {
    problems.push(`${path.relative(ROOT, stale.file)} is out of date with src/config/envSchema.js`);
  }
  return problems;
}

function main() {
  const undocumented = findUndocumented();
  const problems = checkGeneratedFiles();

  if (undocumented.length) {
    console.error('✖ Environment variables read in src/ but not declared in src/config/envSchema.js:\n');
    for (const { name, locations } of undocumented) {
      console.error(`  ${name}`);
      for (const loc of locations.slice(0, 3)) console.error(`      ${loc}`);
    }
    console.error('');
  }
  for (const p of problems) console.error(`✖ ${p}`);

  if (undocumented.length || problems.length) {
    console.error('\nDeclare variables in src/config/envSchema.js, then run `npm run config:generate`.');
    process.exit(1);
  }
  console.log(`✔ All environment variables read in src/ are declared and documented (${ENV_VARS.length} variables).`);
}

if (require.main === module) main();

module.exports = { collectEnvReads, findUndocumented, checkGeneratedFiles };
