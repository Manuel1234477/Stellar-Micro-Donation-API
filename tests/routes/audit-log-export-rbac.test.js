'use strict';
/**
 * Audit Log Export — RBAC + field redaction, route level (Issue #1547)
 *
 * Exercises the real rbac.js (checkPermission/requireAdmin) and roles.json
 * against the mounted routes/auditLogExport.js router, verifying:
 * - Guests are rejected (401)
 * - Non-admins may export their OWN api key's log, always redacted
 * - Non-admins may NOT export another api key's log (403)
 * - Admins get an unredacted export by default, and can opt into redaction
 * - Unknown ?redact= field names are rejected (400)
 * - The X-Export-* manifest headers reflect the redaction that was applied
 */
const request = require('supertest');
const express = require('express');

jest.mock('../../src/utils/database', () => ({
  get: jest.fn(),
  run: jest.fn(),
  query: jest.fn(),
}));
jest.mock('../../src/services/AuditLogService', () => ({
  log: jest.fn().mockResolvedValue({}),
  CATEGORY: { API_KEY_MANAGEMENT: 'API_KEY_MANAGEMENT', AUTHORIZATION: 'AUTHORIZATION' },
  SEVERITY: { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH' },
  ACTION: {
    PERMISSION_GRANTED: 'PERMISSION_GRANTED',
    PERMISSION_DENIED: 'PERMISSION_DENIED',
    ADMIN_ACCESS_GRANTED: 'ADMIN_ACCESS_GRANTED',
    ADMIN_ACCESS_DENIED: 'ADMIN_ACCESS_DENIED',
  },
}));
jest.mock('../../src/models/apiKeys', () => ({
  getApiKeyById: jest.fn(),
}));

const Database = require('../../src/utils/database');
const apiKeysModel = require('../../src/models/apiKeys');
const { errorHandler } = require('../../src/middleware/errorHandler');

function buildApp(user) {
  const app = express();
  app.use((req, res, next) => {
    req.id = 'test-request-id';
    req.ip = '198.51.100.7';
    req.user = user;
    if (user && user.apiKeyId) req.apiKey = { id: user.apiKeyId, role: user.role };
    next();
  });
  const router = require('../../src/routes/auditLogExport');
  app.use('/api-keys', router);
  app.use(errorHandler);
  return app;
}

const SAMPLE_ROW = {
  id: 1,
  timestamp: '2024-01-15T10:30:00.000Z',
  category: 'AUTHENTICATION',
  action: 'API_KEY_VALIDATED',
  severity: 'LOW',
  result: 'SUCCESS',
  userId: 'apikey-key-1',
  requestId: 'req-1',
  ipAddress: '203.0.113.5',
  resource: '/api/test',
  reason: null,
  details: '{}',
};

describe('Audit log export RBAC + redaction (Issue #1547, route level)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    apiKeysModel.getApiKeyById.mockResolvedValue({ id: 'key-1' });
    Database.get.mockResolvedValue({ count: 1 });
    Database.query.mockResolvedValue([SAMPLE_ROW]);
    Database.run.mockResolvedValue({});
  });

  it('rejects an unauthenticated/guest request with 401', async () => {
    const app = buildApp({ id: 'guest', role: 'guest' });
    const res = await request(app).get('/api-keys/key-1/audit-log');
    expect(res.status).toBe(401);
  });

  it('non-admin exporting their own key gets a redacted export by default', async () => {
    const app = buildApp({ id: 'apikey-key-1', role: 'user', apiKeyId: 'key-1' });
    const res = await request(app).get('/api-keys/key-1/audit-log');

    expect(res.status).toBe(200);
    expect(res.headers['x-export-redaction-status']).toBe('REDACTED');
    const parsed = JSON.parse(res.text);
    expect(parsed[0].ipAddress).toBe('[REDACTED]');
    expect(parsed[0].userId).toBe('[REDACTED]');
  });

  it("non-admin cannot export another API key's audit log", async () => {
    const app = buildApp({ id: 'apikey-key-2', role: 'user', apiKeyId: 'key-2' });
    const res = await request(app).get('/api-keys/key-1/audit-log');
    expect(res.status).toBe(403);
  });

  it('admin gets an unredacted export by default', async () => {
    const app = buildApp({ id: 'apikey-admin-1', role: 'admin' });
    const res = await request(app).get('/api-keys/key-1/audit-log');

    expect(res.status).toBe(200);
    expect(res.headers['x-export-redaction-status']).toBe('UNREDACTED');
    const parsed = JSON.parse(res.text);
    expect(parsed[0].ipAddress).toBe('203.0.113.5');
  });

  it('admin can request specific field redaction via ?redact=', async () => {
    const app = buildApp({ id: 'apikey-admin-1', role: 'admin' });
    const res = await request(app).get('/api-keys/key-1/audit-log?redact=ip');

    expect(res.status).toBe(200);
    expect(res.headers['x-export-redacted-fields']).toBe('ip');
    const parsed = JSON.parse(res.text);
    expect(parsed[0].ipAddress).toBe('[REDACTED]');
    expect(parsed[0].userId).toBe('apikey-key-1'); // not requested — untouched
  });

  it('non-admin requesting extra fields still gets the mandatory defaults too', async () => {
    const app = buildApp({ id: 'apikey-key-1', role: 'user', apiKeyId: 'key-1' });
    const res = await request(app).get('/api-keys/key-1/audit-log?redact=ip');

    expect(res.headers['x-export-redacted-fields'].split(',').sort()).toEqual(
      ['apiKeyFragment', 'ip', 'userId'].sort()
    );
  });

  it('rejects an unknown redact field with 400', async () => {
    const app = buildApp({ id: 'apikey-admin-1', role: 'admin' });
    const res = await request(app).get('/api-keys/key-1/audit-log?redact=ssn');
    expect(res.status).toBe(400);
  });

  it('sets the manifest timestamp and record count headers', async () => {
    const app = buildApp({ id: 'apikey-admin-1', role: 'admin' });
    const res = await request(app).get('/api-keys/key-1/audit-log');

    expect(res.headers['x-export-timestamp']).toBeDefined();
    expect(new Date(res.headers['x-export-timestamp']).toString()).not.toBe('Invalid Date');
    expect(res.headers['x-export-record-count']).toBe('1');
  });
});
