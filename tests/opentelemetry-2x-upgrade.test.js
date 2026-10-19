/**
 * OpenTelemetry 2.x upgrade tests (Issue #1897)
 *
 * The tracing stack must be on the 2.x line, free of the high-severity
 * advisories on the old 0.57 / 1.30 line, and enable only the
 * instrumentations the app uses.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const deps = { ...pkg.dependencies, ...pkg.optionalDependencies };
const majorOf = range => Number(String(range).replace(/^[^\d]*/, '').split('.')[0]);

describe('OpenTelemetry 2.x upgrade (Issue #1897)', () => {
  it('pins @opentelemetry/sdk-node to the 2.x line', () => {
    expect(deps['@opentelemetry/sdk-node']).toBeDefined();
    expect(majorOf(deps['@opentelemetry/sdk-node'])).toBeGreaterThanOrEqual(2);
  });

  it('pins the OTLP trace exporter to the 2.x line', () => {
    expect(deps['@opentelemetry/exporter-trace-otlp-http']).toBeDefined();
    expect(majorOf(deps['@opentelemetry/exporter-trace-otlp-http'])).toBeGreaterThanOrEqual(2);
  });

  it('pins @opentelemetry/resources to the 2.x line', () => {
    expect(deps['@opentelemetry/resources']).toBeDefined();
    expect(majorOf(deps['@opentelemetry/resources'])).toBeGreaterThanOrEqual(2);
  });

  it('no longer depends on the old 0.57 / 1.30 lines', () => {
    const oldLine = Object.entries(deps)
      .filter(([name]) => name.startsWith('@opentelemetry/'))
      .filter(([, range]) => /\^?0\.5[0-9]\.|\^?1\.30\./.test(range));

    expect(oldLine).toEqual([]);
  });

  it('tracing.js uses resourceFromAttributes instead of the removed Resource class', () => {
    const content = fs.readFileSync(path.join(ROOT, 'src/utils/tracing.js'), 'utf8');

    expect(content).toMatch(/resourceFromAttributes/);
    expect(content).not.toMatch(/new Resource\(/);
  });

  it('enables only the http, express and sqlite/undici instrumentations', () => {
    const content = fs.readFileSync(path.join(ROOT, 'src/utils/tracing.js'), 'utf8');
    const enabled = [...content.matchAll(/['"]@opentelemetry\/instrumentation-([a-z-]+)['"]/g)]
      .map(m => m[1]);

    const allowed = new Set(['http', 'express', 'sqlite3', 'undici']);
    expect(enabled.filter(name => !allowed.has(name))).toEqual([]);
  });

  it('keeps the distributed tracing test suite present', () => {
    expect(fs.existsSync(path.join(ROOT, 'tests/tracing/distributed-tracing-opentelemetry.test.js'))).toBe(true);
  });
});
