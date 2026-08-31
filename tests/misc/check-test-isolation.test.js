/**
 * Tests: cross-suite state leakage checker (#1585)
 *
 * Complements tests/misc/isolation.test.js, which verifies the RUNTIME helpers
 * that reset state between tests. This suite covers the STATIC gate that finds
 * leakage those helpers cannot reach: two suites claiming the same fixture id,
 * or one suite overriding a worker-wide env value and never restoring it.
 *
 * Rules are exercised against synthetic sources rather than the live tests/
 * tree, so expectations do not drift every time a suite is added.
 */

'use strict';

const path = require('path');
const {
  analyze,
  readSetupEnvBaseline,
  collectTestFiles,
  findFixtureIds,
  findTopLevelMutations,
  restoresLater,
  keyOf,
} = require('../../scripts/check-test-isolation');

const ENV_ASSIGN = /^process\.env\.([A-Z0-9_]+)\s*=\s*(.+?);?\s*$/;
const GLOBAL_ASSIGN = /^global\.([A-Za-z0-9_$]+)\s*=\s*(.+?);?\s*$/;

describe('findFixtureIds', () => {
  it('picks up a numeric fixture id', () => {
    expect(findFixtureIds('const TEST_API_KEY_ID = 99901;\n')).toEqual([
      { name: 'TEST_API_KEY_ID', value: '99901', line: 1 },
    ]);
  });

  it('picks up a string fixture id', () => {
    const found = findFixtureIds("const ADMIN_KEY = 'admin-test-key';\n");
    expect(found[0]).toMatchObject({ name: 'ADMIN_KEY', value: 'admin-test-key' });
  });

  it('ignores small numbers that are not identifiers', () => {
    expect(findFixtureIds('const RETRY_ID = 3;\n')).toEqual([]);
  });

  it('ignores constants that are not identifier-shaped', () => {
    expect(findFixtureIds('const TIMEOUT_MS = 99901;\n')).toEqual([]);
  });

  it('reports the correct line', () => {
    expect(findFixtureIds('// header\n\nconst TEST_WALLET_ID = 12345;\n')[0].line).toBe(3);
  });
});

describe('findTopLevelMutations', () => {
  it('captures a module-scope env assignment with its value', () => {
    expect(findTopLevelMutations("process.env.API_KEYS = 'a,b';\n", ENV_ASSIGN)).toEqual([
      { name: 'API_KEYS', value: "'a,b'", line: 1 },
    ]);
  });

  it('ignores an indented assignment, which sits inside a hook', () => {
    const source = "beforeEach(() => {\n  process.env.API_KEYS = 'a';\n});\n";
    expect(findTopLevelMutations(source, ENV_ASSIGN)).toEqual([]);
  });

  it('captures global assignments', () => {
    expect(findTopLevelMutations('global.fetch = jest.fn()\n', GLOBAL_ASSIGN)[0])
      .toMatchObject({ name: 'fetch' });
  });
});

describe('restoresLater', () => {
  it('is true when a teardown hook mentions the name', () => {
    const source = "process.env.FOO = '1';\nafterAll(() => {\n  delete process.env.FOO;\n})\n";
    expect(restoresLater(source, 'FOO')).toBe(true);
  });

  it('is false when nothing restores it', () => {
    expect(restoresLater("process.env.FOO = '1';\n", 'FOO')).toBe(false);
  });

  it('does not count a mention outside a teardown hook', () => {
    expect(restoresLater("process.env.FOO = '1';\nit('uses FOO', () => {});\n", 'FOO')).toBe(false);
  });
});

describe('readSetupEnvBaseline', () => {
  it('reads the values tests/setup.js establishes for every worker', () => {
    const baseline = readSetupEnvBaseline();
    expect(baseline.has('MOCK_STELLAR')).toBe(true);
    expect(baseline.get('MOCK_STELLAR')).toContain('true');
  });
});

describe('collectTestFiles', () => {
  it('returns only test files and skips non-parallel directories', () => {
    const files = collectTestFiles(path.join(__dirname, '..'));
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((file) => file.endsWith('.test.js'))).toBe(true);
    expect(files.some((file) => file.includes(`${path.sep}e2e${path.sep}`))).toBe(false);
  });
});

describe('keyOf', () => {
  it('builds a stable whitelist key', () => {
    expect(keyOf({ file: 'tests/a.test.js', rule: 'overridden-env', detail: 'API_KEYS' }))
      .toBe('tests/a.test.js::overridden-env::API_KEYS');
  });
});

describe('analyze', () => {
  const findings = analyze();

  it('returns findings shaped for the reporter and the whitelist', () => {
    for (const finding of findings) {
      expect(typeof finding.file).toBe('string');
      expect(typeof finding.rule).toBe('string');
      expect(typeof finding.detail).toBe('string');
      expect(typeof finding.line).toBe('number');
      expect(typeof finding.message).toBe('string');
    }
  });

  it('only emits known rules', () => {
    for (const rule of new Set(findings.map((f) => f.rule))) {
      expect(['colliding-fixture', 'overridden-env', 'unrestored-global']).toContain(rule);
    }
  });

  it('does not flag an env value that merely repeats the setup.js default', () => {
    const baseline = readSetupEnvBaseline();
    const repeats = findings.filter(
      (f) => f.rule === 'overridden-env' && baseline.get(f.detail) === f.detail
    );
    expect(repeats).toEqual([]);
  });

  it('reports a colliding fixture against every suite that shares it', () => {
    const collisions = findings.filter((f) => f.rule === 'colliding-fixture');
    for (const collision of collisions) {
      expect(collisions.filter((c) => c.detail === collision.detail).length).toBeGreaterThan(1);
    }
  });
});
