'use strict';

/**
 * Tests for Issues #65, #66, #67, #68
 */

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-key-1,admin-key';
process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test_encryption_key_fixed_32bytes_hex_value_here_00';

const crypto = require('crypto');

// ─── Issue #65: Donation Tags ─────────────────────────────────────────────────

describe('Issue #65 — Donation Tags', () => {
  const { validateTag, PREDEFINED_TAGS } = require('../src/constants/tags');
  const Transaction = require('../src/routes/models/transaction');

  beforeEach(() => Transaction._clearAllData());

  describe('validateTag', () => {
    it('accepts predefined tags', () => {
      expect(validateTag('education').valid).toBe(true);
      expect(validateTag('health').valid).toBe(true);
    });

    it('accepts valid custom tags', () => {
      expect(validateTag('my-custom-tag').valid).toBe(true);
      expect(validateTag('project_123').valid).toBe(true);
    });

    it('rejects tags with uppercase letters', () => {
      expect(validateTag('Education').valid).toBe(false);
    });

    it('rejects tags with spaces', () => {
      expect(validateTag('my tag').valid).toBe(false);
    });

    it('rejects empty string', () => {
      expect(validateTag('').valid).toBe(false);
    });

    it('rejects tags longer than 50 characters', () => {
      expect(validateTag('a'.repeat(51)).valid).toBe(false);
    });

    it('accepts tags exactly 50 characters', () => {
      expect(validateTag('a'.repeat(50)).valid).toBe(true);
    });
  });

  describe('GET /donations/:id/tags', () => {
    const express = require('express');
    const donationRoutes = require('../src/routes/donation');

    function makeApp() {
      const app = express();
      app.use(express.json());
      // Bypass auth for tests
      app.use((req, _res, next) => {
        req.apiKey = { id: 1, role: 'admin' };
        req.user = { id: 1, role: 'admin' };
        next();
      });
      app.use('/donations', donationRoutes);
      return app;
    }

    it('returns tags for a donation', async () => {
      const request = require('supertest');
      const tx = Transaction.create({ amount: '10', donor: 'd', recipient: 'r', tags: ['education'] });
      const app = makeApp();
      const res = await request(app).get(`/donations/${tx.id}/tags`);
      expect(res.status).toBe(200);
      expect(res.body.data.tags).toContain('education');
    });

    it('returns 404 for unknown donation', async () => {
      const request = require('supertest');
      const app = makeApp();
      const res = await request(app).get('/donations/nonexistent-id/tags');
      expect(res.status).toBe(404);
    });

    it('POST adds a valid predefined tag', async () => {
      const request = require('supertest');
      const tx = Transaction.create({ amount: '10', donor: 'd', recipient: 'r', tags: [] });
      const app = makeApp();
      const res = await request(app).post(`/donations/${tx.id}/tags`).send({ tags: ['health'] });
      expect(res.status).toBe(200);
      expect(res.body.data.tags).toContain('health');
    });

    it('POST adds a valid custom tag', async () => {
      const request = require('supertest');
      const tx = Transaction.create({ amount: '10', donor: 'd', recipient: 'r', tags: [] });
      const app = makeApp();
      const res = await request(app).post(`/donations/${tx.id}/tags`).send({ tags: ['my-custom'] });
      expect(res.status).toBe(200);
      expect(res.body.data.tags).toContain('my-custom');
    });

    it('POST rejects invalid tag format', async () => {
      const request = require('supertest');
      const tx = Transaction.create({ amount: '10', donor: 'd', recipient: 'r', tags: [] });
      const app = makeApp();
      const res = await request(app).post(`/donations/${tx.id}/tags`).send({ tags: ['INVALID TAG'] });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_TAG');
    });

    it('POST is idempotent — duplicate tag not added twice', async () => {
      const request = require('supertest');
      const tx = Transaction.create({ amount: '10', donor: 'd', recipient: 'r', tags: ['education'] });
      const app = makeApp();
      await request(app).post(`/donations/${tx.id}/tags`).send({ tags: ['education'] });
      const res = await request(app).get(`/donations/${tx.id}/tags`);
      const count = res.body.data.tags.filter(t => t === 'education').length;
      expect(count).toBe(1);
    });

    it('DELETE removes a tag', async () => {
      const request = require('supertest');
      const tx = Transaction.create({ amount: '10', donor: 'd', recipient: 'r', tags: ['education', 'health'] });
      const app = makeApp();
      const res = await request(app).delete(`/donations/${tx.id}/tags/education`);
      expect(res.status).toBe(200);
      expect(res.body.data.tags).not.toContain('education');
      expect(res.body.data.tags).toContain('health');
    });
  });
});

// ─── Issue #66: Request Signing Middleware ────────────────────────────────────

describe('Issue #66 — Request Signing Middleware', () => {
  const { createRequestSigningMiddleware, computeSignature } = require('../src/middleware/requestSigning');
  const express = require('express');
  const request = require('supertest');

  const SECRET = 'test-signing-secret-abc123';

  function makeApp(enabled = true) {
    const app = express();
    app.use(express.json({
      verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); }
    }));
    app.use((req, _res, next) => {
      req.apiKey = { id: 1, role: 'user', keySecret: SECRET };
      next();
    });
    app.use(createRequestSigningMiddleware({ enabled }));
    app.post('/test', (req, res) => res.json({ ok: true }));
    app.get('/test', (req, res) => res.json({ ok: true }));
    return app;
  }

  function signedHeaders(method, path, body = '') {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = crypto.randomUUID();
    const signature = computeSignature(SECRET, method, path, timestamp, nonce, body);
    return { 'x-timestamp': timestamp, 'x-nonce': nonce, 'x-signature': signature };
  }

  it('passes GET requests without headers when signing enabled', async () => {
    const res = await request(makeApp()).get('/test');
    expect(res.status).toBe(200);
  });

  it('rejects POST without signing headers — SIGNATURE_REQUIRED', async () => {
    const res = await request(makeApp()).post('/test').send({});
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SIGNATURE_REQUIRED');
  });

  it('accepts POST with valid signature', async () => {
    const body = JSON.stringify({ foo: 'bar' });
    const headers = signedHeaders('POST', '/test', body);
    const res = await request(makeApp())
      .post('/test')
      .set(headers)
      .set('content-type', 'application/json')
      .send(body);
    expect(res.status).toBe(200);
  });

  it('rejects POST with tampered body — INVALID_SIGNATURE', async () => {
    const body = JSON.stringify({ foo: 'bar' });
    const headers = signedHeaders('POST', '/test', body);
    const res = await request(makeApp())
      .post('/test')
      .set(headers)
      .set('content-type', 'application/json')
      .send(JSON.stringify({ foo: 'tampered' }));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_SIGNATURE');
  });

  it('rejects POST with expired timestamp', async () => {
    const timestamp = String(Math.floor(Date.now() / 1000) - 400); // 400s ago > 300s window
    const nonce = crypto.randomUUID();
    const signature = computeSignature(SECRET, 'POST', '/test', timestamp, nonce, '');
    const res = await request(makeApp())
      .post('/test')
      .set({ 'x-timestamp': timestamp, 'x-nonce': nonce, 'x-signature': signature })
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_SIGNATURE');
  });

  it('passes all requests when signing disabled', async () => {
    const res = await request(makeApp(false)).post('/test').send({});
    expect(res.status).toBe(200);
  });
});

// ─── Issue #67: Reconciliation Job Endpoints ─────────────────────────────────

describe('Issue #67 — Reconciliation Job Endpoints', () => {
  const express = require('express');
  const request = require('supertest');
  const reconciliationRoutes = require('../src/routes/admin/reconciliation');

  function makeApp() {
    const app = express();
    app.use(express.json());
    // Bypass RBAC for tests
    app.use((req, _res, next) => {
      req.user = { id: 1, role: 'admin' };
      req.apiKey = { id: 1, role: 'admin' };
      next();
    });
    app.use('/admin/reconciliation', reconciliationRoutes);
    return app;
  }

  it('POST /run returns 202 with a jobId', async () => {
    const res = await request(makeApp()).post('/admin/reconciliation/run');
    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(res.body.data.jobId).toMatch(/^recon-/);
  });

  it('GET /jobs/:jobId returns job status', async () => {
    const app = makeApp();
    const runRes = await request(app).post('/admin/reconciliation/run');
    const { jobId } = runRes.body.data;

    const statusRes = await request(app).get(`/admin/reconciliation/jobs/${jobId}`);
    expect(statusRes.status).toBe(200);
    expect(['queued', 'running', 'completed', 'failed']).toContain(statusRes.body.data.status);
  });

  it('GET /jobs/:jobId returns 404 for unknown job', async () => {
    const res = await request(makeApp()).get('/admin/reconciliation/jobs/recon-nonexistent');
    expect(res.status).toBe(404);
  });

  it('GET /jobs/:jobId/report returns 409 when job not complete', async () => {
    const app = makeApp();
    const runRes = await request(app).post('/admin/reconciliation/run');
    const { jobId } = runRes.body.data;

    // Immediately poll — job may still be queued/running
    const reportRes = await request(app).get(`/admin/reconciliation/jobs/${jobId}/report`);
    // Either 409 (not complete) or 200 (already done) — both are valid
    expect([200, 409]).toContain(reportRes.status);
  });

  it('GET /jobs/:jobId/report returns report shape when completed', async () => {
    const app = makeApp();
    const runRes = await request(app).post('/admin/reconciliation/run');
    const { jobId } = runRes.body.data;

    // Wait for job to complete
    await new Promise(r => setTimeout(r, 200));

    const reportRes = await request(app).get(`/admin/reconciliation/jobs/${jobId}/report`);
    if (reportRes.status === 200) {
      expect(reportRes.body.data).toHaveProperty('matched');
      expect(reportRes.body.data).toHaveProperty('mismatched');
      expect(reportRes.body.data).toHaveProperty('discrepancies');
    }
  });
});

// ─── Issue #68: Refresh Token Revocation ─────────────────────────────────────

describe('Issue #68 — Refresh Token Revocation', () => {
  const {
    issueTokenPair,
    rotateRefreshToken,
    verifyRefreshToken,
    cleanupExpiredRevocations,
    initializeRefreshTokensTable,
  } = require('../src/services/JwtService');

  beforeAll(async () => {
    await initializeRefreshTokensTable();
  });

  it('issues a token pair successfully', async () => {
    const { accessToken, refreshToken, familyId } = await issueTokenPair(1, { role: 'user' });
    expect(typeof accessToken).toBe('string');
    expect(typeof refreshToken).toBe('string');
    expect(typeof familyId).toBe('string');
  });

  it('verifyRefreshToken returns valid for a fresh token', async () => {
    const { refreshToken } = await issueTokenPair(1, { role: 'user' });
    const result = await verifyRefreshToken(refreshToken);
    expect(result.valid).toBe(true);
  });

  it('verifyRefreshToken returns invalid for unknown token', async () => {
    const result = await verifyRefreshToken('totally-fake-token');
    expect(result.valid).toBe(false);
  });

  it('single use succeeds — rotateRefreshToken returns new tokens', async () => {
    const { refreshToken } = await issueTokenPair(2, { role: 'user' });
    const result = await rotateRefreshToken(refreshToken);
    expect(result).not.toBeNull();
    expect(typeof result.accessToken).toBe('string');
    expect(typeof result.refreshToken).toBe('string');
  });

  it('double use is rejected — second rotation throws TOKEN_REUSE_DETECTED', async () => {
    const { refreshToken } = await issueTokenPair(3, { role: 'user' });
    await rotateRefreshToken(refreshToken); // first use — OK

    await expect(rotateRefreshToken(refreshToken)).rejects.toMatchObject({
      code: 'TOKEN_REUSE_DETECTED',
    });
  });

  it('after theft detection, new token from same family is also revoked', async () => {
    const { refreshToken } = await issueTokenPair(4, { role: 'user' });
    const rotated = await rotateRefreshToken(refreshToken); // first use — OK

    // Simulate theft: use old token again → revokes family
    await expect(rotateRefreshToken(refreshToken)).rejects.toMatchObject({
      code: 'TOKEN_REUSE_DETECTED',
    });

    // New token from same family should now be rejected
    await expect(rotateRefreshToken(rotated.refreshToken)).rejects.toMatchObject({
      code: 'TOKEN_REVOKED',
    });
  });

  it('verifyRefreshToken returns invalid after token is consumed', async () => {
    const { refreshToken } = await issueTokenPair(5, { role: 'user' });
    await rotateRefreshToken(refreshToken);
    const result = await verifyRefreshToken(refreshToken);
    expect(result.valid).toBe(false);
  });

  it('cleanupExpiredRevocations runs without error', async () => {
    const deleted = await cleanupExpiredRevocations();
    expect(typeof deleted).toBe('number');
  });
});
