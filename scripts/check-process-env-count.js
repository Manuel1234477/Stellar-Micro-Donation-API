#!/usr/bin/env node
'use strict';

/**
 * check-process-env-count.js (#2111)
 *
 * Ratchet for the migration of direct `process.env` reads into the central env
 * schema (src/config/envSchema.js + readEnv() in src/config/env.js).
 *
 * Counts `process.env.X` / `process.env[...]` reads under src/ outside
 * src/config/, ignoring `process.env.NODE_ENV` (allowlisted during the
 * migration, matching the ESLint rule in eslint.config.js). Fails when the
 * count is above the recorded baseline, so the number can only go down.
 *
 * Usage:
 *   node scripts/check-process-env-count.js            check against baseline
 *   node scripts/check-process-env-count.js --update   record the current count
 *   node scripts/check-process-env-count.js --files    per-file breakdown
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const CONFIG_DIR = path.join(SRC_DIR, 'config');
const BASELINE_PATH = path.join(ROOT, 'eslint-rules', 'process-env-baseline.json');

const ENV_READ_RE = /process\.env(?:\.([A-Za-z_$][A-Za-z0-9_$]*)|\s*\[)/g;
const ALLOWLIST = new Set(['NODE_ENV']);

function collectJsFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (full === CONFIG_DIR) continue;
      collectJsFiles(full, files);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(full);
    }
  }
  return files;
}

/** @returns {{ total: number, byFile: Record<string, number> }} */
function countDirectReads(dir = SRC_DIR) {
  const byFile = {};
  let total = 0;
  for (const file of collectJsFiles(dir)) {
    const source = fs.readFileSync(file, 'utf8');
    let count = 0;
    for (const m of source.matchAll(ENV_READ_RE)) {
      if (m[1] && ALLOWLIST.has(m[1])) continue;
      count += 1;
    }
    if (count > 0) {
      byFile[path.relative(ROOT, file).split(path.sep).join('/')] = count;
      total += count;
    }
  }
  return { total, byFile };
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return null;
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')).count;
}

function main(argv = process.argv.slice(2)) {
  const { total, byFile } = countDirectReads();

  if (argv.includes('--files')) {
    Object.entries(byFile)
      .sort((a, b) => b[1] - a[1])
      .forEach(([file, n]) => console.log(`${String(n).padStart(4)}  ${file}`));
  }

  if (argv.includes('--update')) {
    fs.writeFileSync(BASELINE_PATH, `${JSON.stringify({ count: total }, null, 2)}\n`);
    console.log(`Recorded ${total} direct process.env reads outside src/config.`);
    return 0;
  }

  const baseline = readBaseline();
  console.log(`Direct process.env reads outside src/config (excluding NODE_ENV): ${total}`
    + (baseline === null ? '' : ` (baseline ${baseline})`));

  if (baseline !== null && total > baseline) {
    console.error(
      `\n${total - baseline} new direct process.env read(s). Declare the variable in `
      + 'src/config/envSchema.js and read it with readEnv() from src/config/env.js.'
    );
    return 1;
  }
  if (baseline !== null && total < baseline) {
    console.log('Count went down — run with --update to lower the baseline.');
  }
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { countDirectReads, readBaseline, BASELINE_PATH };
