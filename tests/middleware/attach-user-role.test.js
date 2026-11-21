'use strict';

/**
 * Issue #1940: attachUserRole must not downgrade a presented API key to guest
 * when validation fails for infrastructure reasons. It must fail closed with
 * 503 SERVICE_UNAVAILABLE + Retry-After, keep invalid keys at 401, and count
 * the failure in auth_validation_errors_total.
 */

const request = require('supertest');

jest.mock('../../src/models/apiKeys', () => ({
  ...jest.requireActual('../../src/models/apiKeys'),
  validateApiKey: jest.fn(),
}));

const express = require('express');
const { validateApiKey } = require('../../src/models/apiKeys');
const { attachUserRole } = require('../../src/middleware/rbac');
const { authValidationErrorsTotal } = require('../../src/utils/metrics');

const VALID_KEY = 'test-key-valid-1940';

function buildApp() {
  const app = express();
  app.use((req, res, next) => {
    req.id = 'req-1940';
    next();
  });
  app.use(attachUserRole());
  // Reached only when attachUserRole calls next(); reports the identity it produced.
  app.get('/whoami', (req, res) => {
    res.json({ user: req.user || null });
  });
  app.use((err, req, res, next) => {
    void next;
    res.status(err.status || 500).json({ success: false, error: { code: err.code || 'ERROR' } });
  });
  return app;
}

async function authValidationErrorCount() {
  const data = await authValidationErrorsTotal.get();
  return data.values.reduce((sum, v) => sum + v.value, 0);
}

describe('attachUserRole fail-closed on API key validation errors (#1940)', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    validateApiKey.mockReset();
  });

  it('returns 503 with Retry-After when validation throws, instead of treating the caller as guest', async () => {
    const dbError = Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
    validateApiKey.mockRejectedValue(dbError);
    const before = await authValidationErrorCount();

    const res = await request(app).get('/whoami').set('x-api-key', VALID_KEY);

    expect(res.status).toBe(503);
    expect(res.headers['retry-after']).toBe('5');
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(res.body.error.requestId).toBe('req-1940');
    expect(res.body.user).toBeUndefined();
    expect(await authValidationErrorCount()).toBe(before + 1);
  });

  it('never reports an outage as guest access (no 403 path is reached)', async () => {
    validateApiKey.mockRejectedValue(new Error('connection pool exhausted'));

    const res = await request(app).get('/whoami').set('x-api-key', VALID_KEY);

    expect(res.status).toBe(503);
    expect(res.status).not.toBe(403);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('treats an invalid key as unauthenticated (guest), not as a server error', async () => {
    validateApiKey.mockResolvedValue(null);

    const res = await request(app).get('/whoami').set('x-api-key', 'not-a-real-key');

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('guest');
  });

  it('does not count a successful but invalid lookup as a validation error', async () => {
    validateApiKey.mockResolvedValue(null);
    const before = await authValidationErrorCount();

    await request(app).get('/whoami').set('x-api-key', 'not-a-real-key');

    expect(await authValidationErrorCount()).toBe(before);
  });

  it('still authenticates a valid key and attaches its role', async () => {
    validateApiKey.mockResolvedValue({ id: 42, role: 'admin', name: 'ops', scopes: [] });

    const res = await request(app).get('/whoami').set('x-api-key', VALID_KEY);

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('admin');
    expect(res.body.user.id).toBe('apikey-42');
  });
});
