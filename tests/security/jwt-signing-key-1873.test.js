/**
 * Issue #1873: access tokens are signed with JWT_SIGNING_SECRET, never ENCRYPTION_KEY,
 * carry a kid header, and remain verifiable during rotation via JWT_SIGNING_SECRET_PREVIOUS.
 */

const crypto = require('crypto');
const JwtService = require('../../src/services/JwtService');

const { issueAccessToken, verifyAccessToken } = JwtService;

const JWT_SECRET = 'jwt_signing_secret_for_1873_tests_0123456789abcdef';
const PREVIOUS_SECRET = 'previous_jwt_signing_secret_1873_0123456789abcdef';
const ENCRYPTION_KEY_VALUE = 'encryption_key_value_must_not_sign_tokens_0123';

function decodeHeader(token) {
  return JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
}

function signWith(secret, header, claims) {
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${claims}`).digest('base64url');
  return `${header}.${claims}.${sig}`;
}

describe('JWT signing key separation (#1873)', () => {
  const envSnapshot = {};
  const VARS = ['JWT_SIGNING_SECRET', 'JWT_SIGNING_SECRET_PREVIOUS', 'ENCRYPTION_KEY', 'NODE_ENV'];

  beforeEach(() => {
    VARS.forEach(name => { envSnapshot[name] = process.env[name]; });
    process.env.JWT_SIGNING_SECRET = JWT_SECRET;
    delete process.env.JWT_SIGNING_SECRET_PREVIOUS;
  });

  afterEach(() => {
    VARS.forEach(name => {
      if (envSnapshot[name] === undefined) delete process.env[name];
      else process.env[name] = envSnapshot[name];
    });
  });

  it('issues tokens whose signature matches JWT_SIGNING_SECRET', () => {
    const token = issueAccessToken({ sub: 'user-1', role: 'user' });
    const [header, claims, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${claims}`).digest('base64url');
    expect(sig).toBe(expected);
  });

  it('does not accept tokens signed with ENCRYPTION_KEY', () => {
    process.env.ENCRYPTION_KEY = ENCRYPTION_KEY_VALUE;
    const header = Buffer.from(JSON.stringify(decodeHeader(issueAccessToken({ sub: 'x' })))).toString('base64url');
    const claims = Buffer.from(JSON.stringify({ sub: 'admin', role: 'admin', exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
    const forged = signWith(ENCRYPTION_KEY_VALUE, header, claims);

    const result = verifyAccessToken(forged);

    expect(result.valid).toBe(false);
  });

  it('keeps existing sessions valid when ENCRYPTION_KEY is rotated', () => {
    process.env.ENCRYPTION_KEY = 'original_data_encryption_key_0123456789abcdef';
    const token = issueAccessToken({ sub: 'user-2' });

    process.env.ENCRYPTION_KEY = 'rotated_data_encryption_key_0123456789abcdef';
    const result = verifyAccessToken(token);

    expect(result.valid).toBe(true);
    expect(result.payload.sub).toBe('user-2');
  });

  it('adds a kid header that identifies the signing key without revealing it', () => {
    const header = decodeHeader(issueAccessToken({ sub: 'user-3' }));

    expect(header.kid).toMatch(/^[0-9a-f]{16}$/);
    expect(header.kid).not.toContain(JWT_SECRET.slice(0, 8));
  });

  it('verifies tokens issued under the previous key during rotation', () => {
    process.env.JWT_SIGNING_SECRET = PREVIOUS_SECRET;
    const oldToken = issueAccessToken({ sub: 'user-4' });

    process.env.JWT_SIGNING_SECRET = JWT_SECRET;
    process.env.JWT_SIGNING_SECRET_PREVIOUS = PREVIOUS_SECRET;

    expect(verifyAccessToken(oldToken).valid).toBe(true);
    expect(verifyAccessToken(issueAccessToken({ sub: 'user-5' })).valid).toBe(true);
  });

  it('rejects tokens from a key that is no longer current or previous', () => {
    process.env.JWT_SIGNING_SECRET = PREVIOUS_SECRET;
    const retiredToken = issueAccessToken({ sub: 'user-6' });

    process.env.JWT_SIGNING_SECRET = JWT_SECRET;
    delete process.env.JWT_SIGNING_SECRET_PREVIOUS;

    const result = verifyAccessToken(retiredToken);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('unknown signing key');
  });

  it('rejects a JWT_SIGNING_SECRET shorter than 32 characters', () => {
    process.env.JWT_SIGNING_SECRET = 'too-short';
    expect(() => issueAccessToken({ sub: 'user-7' })).toThrow(/at least 32 characters/);
  });

  it('fails in production when JWT_SIGNING_SECRET is absent', () => {
    delete process.env.JWT_SIGNING_SECRET;
    process.env.NODE_ENV = 'production';
    expect(() => issueAccessToken({ sub: 'user-8' })).toThrow(/JWT_SIGNING_SECRET is not configured/);
  });
});
