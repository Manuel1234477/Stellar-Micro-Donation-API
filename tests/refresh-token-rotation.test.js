/**
 * Tests: JWT Refresh Token Rotation (#391)
 *
 * Covers:
 * - Access token issuance and 15-minute expiry
 * - Refresh token issuance and 7-day expiry
 * - Refresh token rotation (old invalidated, new issued)
 * - Token family revocation on refresh token reuse (theft detection)
 * - All tokens revoked on API key rotation
 * - Edge cases: missing token, malformed token, expired token
 *
 * No live Stellar network required.
 */

const crypto = require('crypto');
const db = require('../src/utils/database');
const JwtService = require('../src/services/JwtService');

const {
  initializeRefreshTokensTable,
  issueAccessToken,
  verifyAccessToken,
  issueTokenPair,
  rotateRefreshToken,
  revokeTokenFamily,
  revokeAllForApiKey,
  ACCESS_TOKEN_TTL_MS,
  REFRESH_TOKEN_TTL_MS,
} = JwtService;

// ─── helpers ────────────────────────────────────────────────────────────────

const TEST_API_KEY_ID = 99901;
const TEST_API_KEY_ID_2 = 99902;

async function cleanup() {
  await db.run(`DELETE FROM refresh_tokens WHERE api_key_id IN (?, ?)`, [TEST_API_KEY_ID, TEST_API_KEY_ID_2]);
}

// ─── setup ───────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await initializeRefreshTokensTable();
});

afterEach(async () => {
  await cleanup();
});

// ─── Access token ─────────────────────────────────────────────────────────────

describe('issueAccessToken / verifyAccessToken', () => {
  it('issues a three-part JWT string', () => {
    const token = issueAccessToken({ sub: 1, role: 'user' });
    expect(token.split('.')).toHaveLength(3);
  });

  it('verifies a freshly issued token as valid', () => {
    const token = issueAccessToken({ sub: 1, role: 'user' });
    const result = verifyAccessToken(token);
    expect(result.valid).toBe(true);
    expect(result.payload.sub).toBe(1);
    expect(result.payload.role).toBe('user');
  });

  it('embeds iat and exp claims', () => {
    const before = Math.floor(Date.now() / 1000);
    const token = issueAccessToken({ sub: 2 });
    const { payload } = verifyAccessToken(token);
    expect(payload.iat).toBeGreaterThanOrEqual(before);
    expect(payload.exp).toBe(payload.iat + Math.floor(ACCESS_TOKEN_TTL_MS / 1000));
  });

  it('access token TTL is 15 minutes', () => {
    expect(ACCESS_TOKEN_TTL_MS).toBe(15 * 60 * 1000);
  });

  it('rejects a token with a tampered payload', () => {
    const token = issueAccessToken({ sub: 1 });
    const [h, , s] = token.split('.');
    const fakeClaims = Buffer.from(JSON.stringify({ sub: 999, exp: 9999999999 })).toString('base64url');
    const result = verifyAccessToken(`${h}.${fakeClaims}.${s}`);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('invalid signature');
  });

  it('rejects a token with a tampered signature', () => {
    const token = issueAccessToken({ sub: 1 });
    const parts = token.split('.');
    parts[2] = 'invalidsignature';
    const result = verifyAccessToken(parts.join('.'));
    expect(result.valid).toBe(false);
  });

  it('rejects a malformed token (wrong number of parts)', () => {
    const result = verifyAccessToken('not.a.valid.jwt.token');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('malformed token');
  });

  it('rejects an empty string', () => {
    const result = verifyAccessToken('');
    expect(result.valid).toBe(false);
  });

  it('rejects an expired token', () => {
    // Manually craft a token with exp in the past
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const claims = Buffer.from(JSON.stringify({ sub: 1, iat: 1000, exp: 1001 })).toString('base64url');
    const secret = require('../src/config/securityConfig').securityConfig.ENCRYPTION_KEY || 'dev_jwt_secret_change_in_production';
    const sig = crypto.createHmac('sha256', secret).update(`${header}.${claims}`).digest('base64url');
    const result = verifyAccessToken(`${header}.${claims}.${sig}`);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('token expired');
  });
});

// ─── Token pair issuance ──────────────────────────────────────────────────────

describe('issueTokenPair', () => {
  it('returns accessToken, refreshToken, and familyId', async () => {
    const pair = await issueTokenPair(TEST_API_KEY_ID, { role: 'user' });
    expect(pair).toHaveProperty('accessToken');
    expect(pair).toHaveProperty('refreshToken');
    expect(pair).toHaveProperty('familyId');
  });

  it('access token is immediately valid', async () => {
    const { accessToken } = await issueTokenPair(TEST_API_KEY_ID);
    const result = verifyAccessToken(accessToken);
    expect(result.valid).toBe(true);
  });

  it('refresh token is a 64-char hex string', async () => {
    const { refreshToken } = await issueTokenPair(TEST_API_KEY_ID);
    expect(refreshToken).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refresh token TTL is 7 days', () => {
    expect(REFRESH_TOKEN_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('stores refresh token as hash (not plaintext) in DB', async () => {
    const { refreshToken } = await issueTokenPair(TEST_API_KEY_ID);
    const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const row = await db.get(`SELECT * FROM refresh_tokens WHERE token_hash = ?`, [hash]);
    expect(row).not.toBeNull();
    expect(row.token_hash).toBe(hash);
    // Raw token must NOT be stored
    const rawRow = await db.get(`SELECT * FROM refresh_tokens WHERE token_hash = ?`, [refreshToken]);
    expect(rawRow).toBeFalsy();
  });

  it('each call creates a new family_id', async () => {
    const p1 = await issueTokenPair(TEST_API_KEY_ID);
    const p2 = await issueTokenPair(TEST_API_KEY_ID);
    expect(p1.familyId).not.toBe(p2.familyId);
  });
});

// ─── Refresh token rotation ───────────────────────────────────────────────────

describe('rotateRefreshToken', () => {
  it('returns a new access token and refresh token', async () => {
    const { refreshToken } = await issueTokenPair(TEST_API_KEY_ID);
    const result = await rotateRefreshToken(refreshToken);
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('accessToken');
    expect(result).toHaveProperty('refreshToken');
    expect(result.apiKeyId).toBe(TEST_API_KEY_ID);
  });

  it('new access token is valid', async () => {
    const { refreshToken } = await issueTokenPair(TEST_API_KEY_ID);
    const { accessToken } = await rotateRefreshToken(refreshToken);
    expect(verifyAccessToken(accessToken).valid).toBe(true);
  });

  it('old refresh token cannot be used again (marked used)', async () => {
    const { refreshToken } = await issueTokenPair(TEST_API_KEY_ID);
    await rotateRefreshToken(refreshToken);
    // Second use should throw TOKEN_FAMILY_REVOKED
    await expect(rotateRefreshToken(refreshToken)).rejects.toMatchObject({
      code: 'TOKEN_FAMILY_REVOKED',
    });
  });

  it('new refresh token is different from the old one', async () => {
    const { refreshToken: old } = await issueTokenPair(TEST_API_KEY_ID);
    const { refreshToken: next } = await rotateRefreshToken(old);
    expect(next).not.toBe(old);
  });

  it('new refresh token can be used for a subsequent rotation', async () => {
    const { refreshToken: r1 } = await issueTokenPair(TEST_API_KEY_ID);
    const { refreshToken: r2 } = await rotateRefreshToken(r1);
    const result = await rotateRefreshToken(r2);
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('accessToken');
  });

  it('returns null for an unknown token', async () => {
    const result = await rotateRefreshToken('0'.repeat(64));
    expect(result).toBeNull();
  });

  it('returns null for an empty string', async () => {
    const result = await rotateRefreshToken('');
    expect(result).toBeNull();
  });
});

// ─── Token family revocation (theft detection) ───────────────────────────────

describe('Token family revocation on reuse', () => {
  it('throws TOKEN_FAMILY_REVOKED when a used token is replayed', async () => {
    const { refreshToken } = await issueTokenPair(TEST_API_KEY_ID);
    await rotateRefreshToken(refreshToken); // legitimate use
    await expect(rotateRefreshToken(refreshToken)).rejects.toMatchObject({
      code: 'TOKEN_FAMILY_REVOKED',
    });
  });

  it('revokes all tokens in the family after reuse', async () => {
    const { refreshToken: r1, familyId } = await issueTokenPair(TEST_API_KEY_ID);
    const { refreshToken: r2 } = await rotateRefreshToken(r1);
    // Replay r1 → revokes family
    await expect(rotateRefreshToken(r1)).rejects.toMatchObject({ code: 'TOKEN_FAMILY_REVOKED' });
    // r2 (same family) should now be revoked too
    const result = await rotateRefreshToken(r2);
    expect(result).toBeNull();
    // Verify DB state
    const rows = await db.all(`SELECT revoked FROM refresh_tokens WHERE family_id = ?`, [familyId]);
    expect(rows.every(r => r.revoked === 1)).toBe(true);
  });

  it('revokeTokenFamily marks all family tokens as revoked', async () => {
    const { familyId, refreshToken } = await issueTokenPair(TEST_API_KEY_ID);
    await revokeTokenFamily(familyId);
    const result = await rotateRefreshToken(refreshToken);
    expect(result).toBeNull();
  });

  it('revoking one family does not affect another family', async () => {
    const { familyId: f1 } = await issueTokenPair(TEST_API_KEY_ID);
    const { refreshToken: r2 } = await issueTokenPair(TEST_API_KEY_ID);
    await revokeTokenFamily(f1);
    // r2 is in a different family — should still work
    const result = await rotateRefreshToken(r2);
    expect(result).not.toBeNull();
  });
});

// ─── Revoke all tokens for an API key ────────────────────────────────────────

describe('revokeAllForApiKey', () => {
  it('revokes all refresh tokens for the given API key', async () => {
    const { refreshToken: r1 } = await issueTokenPair(TEST_API_KEY_ID);
    const { refreshToken: r2 } = await issueTokenPair(TEST_API_KEY_ID);
    await revokeAllForApiKey(TEST_API_KEY_ID);
    expect(await rotateRefreshToken(r1)).toBeNull();
    expect(await rotateRefreshToken(r2)).toBeNull();
  });

  it('does not revoke tokens for a different API key', async () => {
    const { refreshToken: r1 } = await issueTokenPair(TEST_API_KEY_ID);
    const { refreshToken: r2 } = await issueTokenPair(TEST_API_KEY_ID_2);
    await revokeAllForApiKey(TEST_API_KEY_ID);
    // r2 belongs to a different key — should still be valid
    const result = await rotateRefreshToken(r2);
    expect(result).not.toBeNull();
  });

  it('is idempotent — calling twice does not error', async () => {
    await issueTokenPair(TEST_API_KEY_ID);
    await expect(revokeAllForApiKey(TEST_API_KEY_ID)).resolves.not.toThrow();
    await expect(revokeAllForApiKey(TEST_API_KEY_ID)).resolves.not.toThrow();
  });
});

// ─── Auth routes (HTTP layer) ─────────────────────────────────────────────────

describe('POST /auth/token and POST /auth/refresh (HTTP)', () => {
  // These tests exercise the route layer using the express app directly via
  // module-level requires, avoiding the app.js syntax issue with Jest's Babel.
  // We test the route handler logic by calling the service directly and
  // verifying the HTTP contract via the route module's express router.

  const express = require('express');

  function buildTestApp() {
    const app = express();
    app.use(express.json());
    // Inject a fake apiKey so requireApiKey is bypassed
    app.use((req, _res, next) => {
      req.apiKey = { id: TEST_API_KEY_ID, role: 'user' };
      next();
    });
    app.use('/auth', require('../src/routes/auth'));
    return app;
  }

  it('POST /auth/token returns 200 with accessToken and refreshToken', async () => {
    const request = require('supertest');
    const app = buildTestApp();
    const res = await request(app).post('/auth/token').send();
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('accessToken');
    expect(res.body.data).toHaveProperty('refreshToken');
    expect(res.body.data.tokenType).toBe('Bearer');
    expect(res.body.data.expiresIn).toBe(900);
  });

  it('POST /auth/refresh with valid token returns 200 with new tokens', async () => {
    const request = require('supertest');
    const app = buildTestApp();
    // Issue a pair first
    const issueRes = await request(app).post('/auth/token').send();
    const { refreshToken } = issueRes.body.data;

    const refreshRes = await request(app).post('/auth/refresh').send({ refreshToken });
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.data).toHaveProperty('accessToken');
    expect(refreshRes.body.data).toHaveProperty('refreshToken');
    expect(refreshRes.body.data.refreshToken).not.toBe(refreshToken);
  });

  it('POST /auth/refresh without body returns 400', async () => {
    const request = require('supertest');
    const app = buildTestApp();
    const res = await request(app).post('/auth/refresh').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_REFRESH_TOKEN');
  });

  it('POST /auth/refresh with invalid token returns 401', async () => {
    const request = require('supertest');
    const app = buildTestApp();
    const res = await request(app).post('/auth/refresh').send({ refreshToken: 'invalid' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('POST /auth/refresh with reused token returns 401 TOKEN_FAMILY_REVOKED', async () => {
    const request = require('supertest');
    const app = buildTestApp();
    const issueRes = await request(app).post('/auth/token').send();
    const { refreshToken } = issueRes.body.data;
    // First use — legitimate
    await request(app).post('/auth/refresh').send({ refreshToken });
    // Second use — theft detection
    const res = await request(app).post('/auth/refresh').send({ refreshToken });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_FAMILY_REVOKED');
  });
});
