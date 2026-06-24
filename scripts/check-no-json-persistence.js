#!/usr/bin/env node
/**
 * CI guard — fail if any production source file references the legacy JSON stores
 * in executable code (not in comments).
 *
 * Patterns that must not appear in src/ executable code:
 *   - data/donations.json
 *   - data/users.json
 *   - data/wallets.json
 *   - DB_JSON_PATH / WALLETS_JSON_PATH env var references
 *
 * Run: node scripts/check-no-json-persistence.js
 * Exit 0 = clean, Exit 1 = violations found.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');

const BANNED = [
  /data\/donations\.json/,
  /data\/users\.json/,
  /data\/wallets\.json/,
  /DB_JSON_PATH/,
  /WALLETS_JSON_PATH/,
];

// Directories to skip entirely
const SKIP_DIRS = new Set(['node_modules', '.git', 'coverage', 'migrations']);

// Files allowed to mention the old paths (schema history docs / migration files)
const ALLOWED_FILE_PATTERNS = [
  /src[/\\]migrations[/\\]/,
  /src[/\\]scripts[/\\]migrations[/\\]/,
];

function isCommentLine(line) {
  const trimmed = line.trimStart();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}

const violations = [];

for (const file of walk(SRC_DIR)) {
  const rel = path.relative(ROOT, file);

  // Allow migration/schema files to reference old names for documentation
  if (ALLOWED_FILE_PATTERNS.some(p => p.test(rel))) continue;

  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (isCommentLine(lines[i])) continue;
    for (const pattern of BANNED) {
      if (pattern.test(lines[i])) {
        violations.push(`${rel}:${i + 1}: ${lines[i].trim()}`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error('\n[check-no-json-persistence] FAIL — legacy JSON store references found in src/:\n');
  for (const v of violations) console.error('  ' + v);
  console.error('\nRemove these references and use the SQLite-backed models instead.\n');
  process.exit(1);
}

console.log('[check-no-json-persistence] OK — no legacy JSON store references found in src/');
process.exit(0);
