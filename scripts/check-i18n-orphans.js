#!/usr/bin/env node
/**
 * check-i18n-orphans.js
 *
 * Scans the src/i18n/ directory (if present) and asserts that every locale file
 * is required or imported somewhere in src/ or tests/.
 *
 * Exit 0 = clean (no orphaned files)
 * Exit 1 = orphaned files found
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const I18N_DIR = path.join(ROOT, 'src', 'i18n');

if (!fs.existsSync(I18N_DIR)) {
  console.log('[check-i18n-orphans] OK — src/i18n directory does not exist.');
  process.exit(0);
}

const localeFiles = fs.readdirSync(I18N_DIR).filter((f) => f.endsWith('.js') || f.endsWith('.json'));
if (localeFiles.length === 0) {
  console.log('[check-i18n-orphans] OK — src/i18n is empty.');
  process.exit(0);
}

function scanDir(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', '.git', 'coverage', 'dist'].includes(entry.name) && fullPath !== I18N_DIR) {
        scanDir(fullPath, fileList);
      }
    } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.ts') || entry.name.endsWith('.mjs'))) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

const codebaseFiles = [
  ...scanDir(path.join(ROOT, 'src')),
  ...scanDir(path.join(ROOT, 'tests')),
];

const codebaseContent = codebaseFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const orphanedFiles = [];

for (const file of localeFiles) {
  const baseNameWithoutExt = path.basename(file, path.extname(file));
  const pattern = new RegExp(`i18n/(${file}|${baseNameWithoutExt})`, 'i');
  if (!pattern.test(codebaseContent)) {
    orphanedFiles.push(file);
  }
}

if (orphanedFiles.length > 0) {
  console.error('\n[check-i18n-orphans] FAIL — The following files in src/i18n/ are not required anywhere:\n');
  for (const file of orphanedFiles) {
    console.error(`  ❌ src/i18n/${file}`);
  }
  console.error('\nEither require these locale files in the codebase or remove them.\n');
  process.exit(1);
}

console.log(`[check-i18n-orphans] OK — All ${localeFiles.length} file(s) under src/i18n/ are properly referenced.`);
process.exit(0);
