/**
 * Production dependency audit tests (Issue #1896)
 *
 * The production dependency tree must have no high or critical advisories,
 * and CI's `npm audit --audit-level=high` gate must pass.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

describe('Production npm audit (Issue #1896)', () => {
  it('npm audit --omit=dev --audit-level=high exits 0', () => {
    const result = spawnSync('npm', ['audit', '--omit=dev', '--audit-level=high'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 120000,
    });

    expect(result.status).toBe(0);
  }, 150000);

  it('resolves proxy-addr to a patched version', () => {
    const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
    const entry = lock.packages['node_modules/proxy-addr'];

    expect(entry).toBeDefined();
    const [major, minor, patch] = entry.version.split('.').map(Number);
    expect(major > 2 || (major === 2 && (minor > 0 || patch >= 1))).toBe(true);
  });

  it('resolves express to 4.22.x or later', () => {
    const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
    const { version } = lock.packages['node_modules/express'];
    const [major, minor, patch] = version.split('.').map(Number);

    expect(major).toBe(4);
    expect(minor > 22 || (minor === 22 && patch >= 3)).toBe(true);
  });

  it('documents any accepted residual findings in .auditignore with an expiry', () => {
    const file = path.join(ROOT, '.auditignore');
    if (!fs.existsSync(file)) return;

    const lines = fs.readFileSync(file, 'utf8')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));

    for (const line of lines) {
      expect(line).toMatch(/expires?/i);
    }
  });
});
