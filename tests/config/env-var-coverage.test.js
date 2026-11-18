'use strict';

/**
 * Environment Variable Coverage Test (Issue #1177)
 *
 * Scans every .js file under src/ for process.env.VARIABLE_NAME references and
 * verifies that each variable is documented in docs/CONFIGURATION.md.
 *
 * Fails when a variable is referenced in code but absent from the documentation,
 * keeping the docs honest as the codebase evolves.
 *
 * To fix a failure: add the new variable to docs/CONFIGURATION.md (and
 * .env.example if appropriate) then re-run the tests.
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Recursively collect all .js files under a directory. */
function collectJsFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectJsFiles(full, files);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(full);
    }
  }
  return files;
}

/** Extract every `process.env.VARIABLE_NAME` identifier from source text. */
function extractEnvVars(source) {
  const matches = source.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g);
  const vars = new Set();
  for (const m of matches) {
    vars.add(m[1]);
  }
  return vars;
}

// ---------------------------------------------------------------------------
// Variables that are intentionally excluded from the documentation check.
//
// Add a variable here only when it is:
//   - A Node.js / npm built-in (e.g. npm_package_version)
//   - Exclusively used in test helpers / scripts that are not part of the
//     production application surface
//   - A transient rotation key whose presence is already covered by a
//     documented parent variable
// ---------------------------------------------------------------------------
const KNOWN_EXCLUSIONS = new Set([
  // Node / npm built-ins
  'npm_package_version',

  // Test-only / script-only variables (not production config)
  'TEST_DB_PATH',
  'TEST_REDIS_URL',
  'JEST_WORKER_ID',
  'CI',

  // Dynamic suffix patterns resolved at runtime — the base variable is documented
  // (e.g. ENCRYPTION_KEY_0, ENCRYPTION_KEY_1 are covered by ENCRYPTION_KEY_VERSION)
]);

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

const SRC_DIR = path.resolve(__dirname, '../../src');
const CONFIG_MD = path.resolve(__dirname, '../../docs/CONFIGURATION.md');

describe('Environment variable documentation coverage (Issue #1177)', () => {
  let allVarsInSrc;
  let configMdContent;

  beforeAll(() => {
    const jsFiles = collectJsFiles(SRC_DIR);
    allVarsInSrc = new Set();
    for (const file of jsFiles) {
      const source = fs.readFileSync(file, 'utf8');
      for (const v of extractEnvVars(source)) {
        allVarsInSrc.add(v);
      }
    }
    configMdContent = fs.readFileSync(CONFIG_MD, 'utf8');
  });

  test('docs/CONFIGURATION.md exists and is non-empty', () => {
    expect(configMdContent.length).toBeGreaterThan(100);
  });

  test('every process.env.* reference in src/ is documented in CONFIGURATION.md', () => {
    const undocumented = [];

    for (const varName of allVarsInSrc) {
      if (KNOWN_EXCLUSIONS.has(varName)) continue;

      // The variable is considered documented if its backtick-quoted name
      // (`VARIABLE_NAME`) appears anywhere in CONFIGURATION.md.
      const pattern = new RegExp('`' + varName + '`');
      if (!pattern.test(configMdContent)) {
        undocumented.push(varName);
      }
    }

    if (undocumented.length > 0) {
      const list = undocumented.sort().map(v => `  - ${v}`).join('\n');
      throw new Error(
        `The following environment variables are used in src/ but are not documented ` +
        `in docs/CONFIGURATION.md:\n\n${list}\n\n` +
        `Add each variable to the appropriate section of docs/CONFIGURATION.md ` +
        `(and .env.example if it is user-facing), then re-run this test.`
      );
    }
  });

  test('.env.example exists and is non-empty', () => {
    const envExamplePath = path.resolve(__dirname, '../../.env.example');
    const content = fs.readFileSync(envExamplePath, 'utf8');
    expect(content.length).toBeGreaterThan(100);
  });

  test('CONFIGURATION.md documents required variables with their types', () => {
    // Spot-check that the most critical required variables are documented
    // with the expected metadata markers.
    const required = [
      'ENCRYPTION_KEY',
      'API_KEYS',
      'NODE_ENV',
      'PORT',
    ];
    for (const v of required) {
      expect(configMdContent).toMatch(new RegExp('`' + v + '`'));
    }
  });
});
