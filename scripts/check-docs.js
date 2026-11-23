#!/usr/bin/env node
'use strict';

/**
 * check-docs.js
 *
 * Documentation integrity gate. Fails (exit 1) when:
 *  - README.md is longer than MAX_README_LINES
 *  - a relative Markdown link in README.md, CONTRIBUTING.md, SECURITY.md or docs/**\/*.md points to a missing file
 *  - README.md references a repository path (scripts/, src/, docs/, ...) that does not exist
 *  - README.md runs an `npm run <script>` that is not defined in package.json
 *  - README.md or docs/quickstart.md shows an unversioned API path (use /api/v1)
 *
 * Usage: node scripts/check-docs.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MAX_README_LINES = 250;
const REPO_DIRS = ['scripts', 'src', 'docs', 'examples', 'monitoring', 'tests', 'deploy', 'sdk'];
// npm built-ins that are valid without a matching package.json script.
const NPM_BUILTINS = new Set(['install', 'ci', 'start', 'test', 'run', 'i', 'audit']);
// Paths that were valid API routes before the /api/v1 prefix was mandatory.
const UNVERSIONED_API = /(?:localhost:\d+|\b(?:GET|POST|PUT|PATCH|DELETE)\s+)\/(?:donations|wallets|stream|stats|transactions|health)\b/;

const errors = [];
const fail = (file, message) => errors.push(`${file}: ${message}`);

function walkMarkdown(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkMarkdown(full);
    return entry.name.endsWith('.md') ? [full] : [];
  });
}

function checkLinks(file, content) {
  for (const match of content.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const raw = match[1].trim().split(/\s+/)[0].replace(/^<|>$/g, '');
    if (!raw || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(raw)) continue;
    const target = raw.split(/[?#]/, 1)[0];
    if (!target || /(?:^|\/)(?:issues|pulls|discussions)$/.test(target)) continue;
    const resolved = path.resolve(path.dirname(file), decodeURIComponent(target));
    if (!fs.existsSync(resolved)) {
      fail(path.relative(ROOT, file), `broken link -> ${raw}`);
    }
  }
}

function checkReadme(readmePath) {
  const content = fs.readFileSync(readmePath, 'utf8');
  const lineCount = content.split('\n').length;
  if (lineCount > MAX_README_LINES) {
    fail('README.md', `${lineCount} lines; keep it under ${MAX_README_LINES} and link to docs/ for details`);
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const scripts = pkg.scripts || {};
  for (const match of content.matchAll(/\bnpm (?:run )?([a-z][a-z0-9:_-]*)/g)) {
    const name = match[1];
    if (!NPM_BUILTINS.has(name) && !Object.prototype.hasOwnProperty.call(scripts, name)) {
      fail('README.md', `references "npm run ${name}" which is not defined in package.json`);
    }
  }

  const pathPattern = new RegExp(`(?<![\\w./-])((?:${REPO_DIRS.join('|')})/[A-Za-z0-9_./-]*[A-Za-z0-9_])`, 'g');
  for (const match of content.matchAll(pathPattern)) {
    const repoPath = match[1];
    if (!fs.existsSync(path.join(ROOT, repoPath))) {
      fail('README.md', `references missing path ${repoPath}`);
    }
  }
}

function checkUnversioned(file, content) {
  content.split('\n').forEach((line, index) => {
    if (UNVERSIONED_API.test(line)) {
      fail(`${file}:${index + 1}`, 'unversioned API path; use /api/v1');
    }
  });
}

function main() {
  const readme = path.join(ROOT, 'README.md');
  const quickstart = path.join(ROOT, 'docs', 'quickstart.md');
  // Root-level docs are link-checked too (#2116); the docs/ tree is walked recursively.
  const rootDocs = ['CONTRIBUTING.md', 'SECURITY.md']
    .map((name) => path.join(ROOT, name))
    .filter((file) => fs.existsSync(file));
  const markdownFiles = [readme, ...rootDocs, ...walkMarkdown(path.join(ROOT, 'docs'))];

  for (const file of markdownFiles) {
    checkLinks(file, fs.readFileSync(file, 'utf8'));
  }

  checkReadme(readme);
  checkUnversioned('README.md', fs.readFileSync(readme, 'utf8'));
  checkUnversioned('docs/quickstart.md', fs.readFileSync(quickstart, 'utf8'));

  if (errors.length > 0) {
    console.error(`check-docs: ${errors.length} problem(s) found`);
    for (const error of errors) console.error(`  ✗ ${error}`);
    process.exit(1);
  }
  console.log(`check-docs: passed (${markdownFiles.length} files link-checked)`);
}

if (require.main === module) {
  main();
}

module.exports = { checkLinks, checkReadme, checkUnversioned, MAX_README_LINES };
