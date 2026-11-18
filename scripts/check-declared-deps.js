'use strict';

/**
 * CI check: every bare-specifier module required from src/ must be declared
 * in package.json (dependencies, or optionalDependencies when the require is
 * guarded by a try block). Node built-ins are ignored.
 *
 * Exits with code 1 when an undeclared package is found.
 */

const fs = require('fs');
const path = require('path');
const { builtinModules } = require('module');

const ROOT = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const pkg = require(path.join(ROOT, 'package.json'));

const declared = new Set(Object.keys(pkg.dependencies || {}));
const optional = new Set(Object.keys(pkg.optionalDependencies || {}));
const builtins = new Set(builtinModules);

/**
 * Packages src/ already requires without declaring them in "dependencies".
 * Each one must be declared (or the require removed) and deleted from this
 * list. New entries need a reviewed reason, so new gaps still fail CI.
 */
const KNOWN_GAPS = new Set([
  '@aws-sdk/client-kms',
  '@aws-sdk/client-s3',
  '@opentelemetry/auto-instrumentations-node',
  '@opentelemetry/semantic-conventions',
  'axios',
  'ioredis',
  'redis',
]);

const REQUIRE_RE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

/**
 * Maps a require specifier to its package name, or null when it is not a
 * bare package specifier (relative, absolute, or a Node built-in).
 */
function packageName(specifier) {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return null;
  const bare = specifier.replace(/^node:/, '');
  if (builtins.has(bare) || builtins.has(bare.split('/')[0])) return null;
  const parts = bare.split('/');
  return bare.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/**
 * A require is treated as guarded when a `try {` opens within the three
 * lines above it. This is a heuristic, not a parser.
 */
function isGuarded(lines, index) {
  return lines.slice(Math.max(0, index - 3), index + 1).some((l) => /\btry\s*\{/.test(l));
}

const violations = [];

for (const file of walk(SRC_DIR)) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    for (const match of line.matchAll(REQUIRE_RE)) {
      const name = packageName(match[1]);
      if (!name || declared.has(name) || KNOWN_GAPS.has(name)) continue;
      if (optional.has(name) && isGuarded(lines, index)) continue;
      violations.push({ name, location: `${path.relative(ROOT, file)}:${index + 1}` });
    }
  });
}

if (violations.length > 0) {
  console.error('ERROR: src/ requires packages that are not declared in package.json:\n');
  for (const { name, location } of violations) {
    console.error(`  ${name}  (${location})`);
  }
  console.error('\nAdd each package to "dependencies" (or "optionalDependencies" if guarded by try/catch).');
  process.exit(1);
}

console.log('OK — every package required from src/ is declared in package.json.');
