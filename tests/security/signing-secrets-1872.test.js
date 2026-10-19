/**
 * Issue #1872: HMAC signing secrets must never fall back to source-code literals.
 */

const fs = require('fs');
const path = require('path');
const {
  getSigningSecret,
  findMissingSigningSecrets
} = require('../../src/utils/signingSecrets');

const SRC_DIR = path.join(__dirname, '../../src');
const FORBIDDEN_LITERALS = [
  'export-signing-secret',
  'dev-secret',
  'dev_jwt_secret_change_in_production'
];

function listSourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

describe('Signing secret resolution (#1872)', () => {
  const envSnapshot = {};
  const VARS = ['NODE_ENV', 'TEST_SIGNING_A', 'TEST_SIGNING_B'];

  beforeEach(() => {
    VARS.forEach(name => { envSnapshot[name] = process.env[name]; delete process.env[name]; });
  });

  afterEach(() => {
    VARS.forEach(name => {
      if (envSnapshot[name] === undefined) delete process.env[name];
      else process.env[name] = envSnapshot[name];
    });
  });

  describe.each(['production', 'staging'])('in %s', (env) => {
    it('throws a clear error when no secret is configured', () => {
      process.env.NODE_ENV = env;
      expect(() => getSigningSecret('EXPORT_SIGNING_SECRET', ['TEST_SIGNING_A', 'TEST_SIGNING_B']))
        .toThrow(/EXPORT_SIGNING_SECRET is not configured.*TEST_SIGNING_A, TEST_SIGNING_B/);
    });

    it('returns the configured secret', () => {
      process.env.NODE_ENV = env;
      process.env.TEST_SIGNING_A = 'configured-secret-value';
      expect(getSigningSecret('EXPORT_SIGNING_SECRET', ['TEST_SIGNING_A'])).toBe('configured-secret-value');
    });
  });

  describe('outside strict environments', () => {
    it('generates a random per-process secret instead of a constant', () => {
      process.env.NODE_ENV = 'development';
      const secret = getSigningSecret('EXPORT_SIGNING_SECRET', ['TEST_SIGNING_A']);

      expect(secret).toMatch(/^[0-9a-f]{64}$/);
      expect(FORBIDDEN_LITERALS).not.toContain(secret);
    });

    it('keeps the generated secret stable for the life of the process', () => {
      process.env.NODE_ENV = 'test';
      const first = getSigningSecret('STABLE_SECRET_NAME', ['TEST_SIGNING_A']);
      const second = getSigningSecret('STABLE_SECRET_NAME', ['TEST_SIGNING_A']);
      expect(second).toBe(first);
    });

    it('uses variables in priority order and ignores blank values', () => {
      process.env.NODE_ENV = 'test';
      process.env.TEST_SIGNING_A = '   ';
      process.env.TEST_SIGNING_B = 'second-choice';
      expect(getSigningSecret('ORDERED_SECRET', ['TEST_SIGNING_A', 'TEST_SIGNING_B'])).toBe('second-choice');
    });
  });

  describe('findMissingSigningSecrets', () => {
    it('reports only the requirements with no configured variable', () => {
      process.env.TEST_SIGNING_A = 'present';
      const missing = findMissingSigningSecrets([
        { name: 'PRESENT', envVarNames: ['TEST_SIGNING_A'] },
        { name: 'ABSENT', envVarNames: ['TEST_SIGNING_B'] }
      ]);
      expect(missing).toEqual(['ABSENT']);
    });
  });

  it('leaves no hard-coded signing secret literal anywhere in src', () => {
    const offenders = listSourceFiles(SRC_DIR).filter(file => {
      const content = fs.readFileSync(file, 'utf8');
      return FORBIDDEN_LITERALS.some(literal => content.includes(literal));
    });
    expect(offenders).toEqual([]);
  });
});
