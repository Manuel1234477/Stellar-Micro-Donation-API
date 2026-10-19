/**
 * Identifier generation tests (Issue #1895)
 *
 * Request, job and backup identifiers must come from crypto.randomUUID(),
 * not Math.random(), so they cannot be guessed or collide.
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');

// Files where Math.random() is allowed: non-identifier uses such as
// jitter, log sampling, routing and mock services.
const ALLOWLIST = new Set([
  'utils/log.js',
  'utils/sequenceManager.js',
  'services/StellarService.js',
  'services/NetworkFeeService.js',
  'services/RecurringDonationScheduler.js',
  'services/MockStellarService.js',
  'services/MockStellarServiceStub.js',
  'services/mock/fees.js',
  'services/mock/payments.js',
]);

function listSourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

describe('Identifier generation without Math.random (Issue #1895)', () => {
  const files = listSourceFiles(SRC);
  const relative = file => path.relative(SRC, file).split(path.sep).join('/');

  it('uses Math.random() only in allowlisted, non-identifier files', () => {
    const offenders = files
      .filter(file => !ALLOWLIST.has(relative(file)))
      .filter(file => fs.readFileSync(file, 'utf8').includes('Math.random'))
      .map(relative);

    expect(offenders).toEqual([]);
  });

  it.each([
    'middleware/requestId.js',
    'routes/admin/db.js',
    'services/SseManager.js',
    'services/BackupScheduler.js',
    'services/RestoreTestRunner.js',
    'services/BulkWalletImportService.js',
  ])('%s does not use Math.random()', (rel) => {
    const content = fs.readFileSync(path.join(SRC, rel), 'utf8');
    expect(content).not.toMatch(/Math\.random/);
  });

  it('requestId middleware has no Math.random fallback and uses crypto.randomUUID', () => {
    const content = fs.readFileSync(path.join(SRC, 'middleware/requestId.js'), 'utf8');
    expect(content).toMatch(/crypto\.randomUUID\(/);
    expect(content).not.toMatch(/Math\.random/);
  });

  it('BulkWalletImportService has no dead fallback when randomUUID is unavailable', () => {
    const content = fs.readFileSync(path.join(SRC, 'services/BulkWalletImportService.js'), 'utf8');
    expect(content).not.toMatch(/crypto\.randomUUID\s*\?/);
  });

  it('ESLint forbids Math.random in src/ outside the allowlist', () => {
    const eslintConfig = fs.readdirSync(path.join(__dirname, '..'))
      .filter(name => /^eslint\.config\.(c?js|mjs)$|^\.eslintrc/.test(name));
    expect(eslintConfig.length).toBeGreaterThan(0);

    const config = fs.readFileSync(path.join(__dirname, '..', eslintConfig[0]), 'utf8');
    expect(config).toMatch(/no-restricted-properties/);
    expect(config).toMatch(/Math/);
    expect(config).toMatch(/random/);
  });
});
