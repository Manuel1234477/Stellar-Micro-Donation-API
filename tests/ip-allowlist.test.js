/**
 * Tests for API key IP allowlisting
 * Covers: allowed IPs, blocked IPs, CIDR ranges (IPv4 + IPv6), logging, and PATCH endpoint
 */

const request = require('supertest');
const express = require('express');
const apiKeysModel = require('../src/models/apiKeys');
const db = require('../src/utils/database');
const { isIpAllowed, isInCidr } = require('../src/utils/ipAllowlist');
const log = require('../src/utils/log');
const requireApiKey = require('../src/middleware/apiKey');
const apiKeysRouter = require('../src/routes/apiKeys');
const { attachUserRole } = require('../src/middleware/rbac');

// ─── Minimal test app ────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());

  // Attach a request id so middleware doesn't blow up
  app.use((req, _res, next) => { req.id = 'test-req'; next(); });

  app.use(requireApiKey);
  app.use(attachUserRole());

  // Simple health route for middleware tests
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  // API keys management routes (admin only)
  app.use('/api/v1/api-keys', apiKeysRouter);

  // Error handler
  app.use((err, _req, res, _next) => {
    const status = err.statusCode || err.status || 500;
    res.status(status).json({ success: false, error: { code: err.errorCode || 'ERROR', message: err.message } });
  });

  return app;
}

// ─── Unit tests: ipAllowlist utility ────────────────────────────────────────

describe('isIpAllowed utility', () => {
  describe('null / empty allowlist', () => {
    it('allows any IP when allowedIps is null', () => {
      expect(isIpAllowed('1.2.3.4', null)).toBe(true);
    });

    it('allows any IP when allowedIps is empty array', () => {
      expect(isIpAllowed('1.2.3.4', [])).toBe(true);
    });

    it('allows any IP when allowedIps is undefined', () => {
      expect(isIpAllowed('1.2.3.4', undefined)).toBe(true);
    });
  });

  describe('exact IPv4 matching', () => {
    it('allows a listed IPv4 address', () => {
      expect(isIpAllowed('1.2.3.4', ['1.2.3.4'])).toBe(true);
    });

    it('blocks an unlisted IPv4 address', () => {
      expect(isIpAllowed('1.2.3.5', ['1.2.3.4'])).toBe(false);
    });

    it('allows one of several listed IPs', () => {
      expect(isIpAllowed('10.0.0.2', ['10.0.0.1', '10.0.0.2', '10.0.0.3'])).toBe(true);
    });
  });

  describe('exact IPv6 matching', () => {
    it('allows a listed IPv6 address', () => {
      expect(isIpAllowed('2001:db8::1', ['2001:db8::1'])).toBe(true);
    });

    it('blocks an unlisted IPv6 address', () => {
      expect(isIpAllowed('2001:db8::2', ['2001:db8::1'])).toBe(false);
    });
  });

  describe('IPv4 CIDR ranges', () => {
    it('allows an IP inside a /24 range', () => {
      expect(isIpAllowed('192.168.1.100', ['192.168.1.0/24'])).toBe(true);
    });

    it('blocks an IP outside a /24 range', () => {
      expect(isIpAllowed('192.168.2.1', ['192.168.1.0/24'])).toBe(false);
    });

    it('allows the network address itself', () => {
      expect(isIpAllowed('10.0.0.0', ['10.0.0.0/8'])).toBe(true);
    });

    it('allows the broadcast-adjacent address in /8', () => {
      expect(isIpAllowed('10.255.255.255', ['10.0.0.0/8'])).toBe(true);
    });

    it('blocks an IP just outside a /8 range', () => {
      expect(isIpAllowed('11.0.0.1', ['10.0.0.0/8'])).toBe(false);
    });

    it('handles /32 (single host) correctly', () => {
      expect(isIpAllowed('1.2.3.4', ['1.2.3.4/32'])).toBe(true);
      expect(isIpAllowed('1.2.3.5', ['1.2.3.4/32'])).toBe(false);
    });

    it('handles /0 (allow all) correctly', () => {
      expect(isIpAllowed('8.8.8.8', ['0.0.0.0/0'])).toBe(true);
    });
  });

  describe('IPv6 CIDR ranges', () => {
    it('allows an IP inside a /32 IPv6 range', () => {
      expect(isIpAllowed('2001:db8::1', ['2001:db8::/32'])).toBe(true);
    });

    it('blocks an IP outside a /32 IPv6 range', () => {
      expect(isIpAllowed('2001:db9::1', ['2001:db8::/32'])).toBe(false);
    });

    it('handles /128 (single host) correctly', () => {
      expect(isIpAllowed('::1', ['::1/128'])).toBe(true);
      expect(isIpAllowed('::2', ['::1/128'])).toBe(false);
    });
  });

  describe('mixed allowlist', () => {
    it('allows an IP matching a CIDR entry in a mixed list', () => {
      expect(isIpAllowed('192.168.1.50', ['10.0.0.1', '192.168.1.0/24'])).toBe(true);
    });

    it('blocks an IP not matching any entry in a mixed list', () => {
      expect(isIpAllowed('172.16.0.1', ['10.0.0.1', '192.168.1.0/24'])).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('returns false when clientIp is empty string', () => {
      expect(isIpAllowed('', ['1.2.3.4'])).toBe(false);
    });

    it('returns false when clientIp is null', () => {
      expect(isIpAllowed(null, ['1.2.3.4'])).toBe(false);
    });
  });
});

// ─── Integration tests: middleware enforcement ───────────────────────────────

describe('IP allowlist middleware integration', () => {
  let app;

  beforeAll(async () => {
    await apiKeysModel.initializeApiKeysTable();
    app = buildApp();
  });

  afterAll(async () => {
    await db.run("DELETE FROM api_keys WHERE created_by = 'ip-test'");
  });

  it('allows requests when no allowedIps is set', async () => {
    const { key } = await apiKeysModel.createApiKey({ name: 'No Allowlist', role: 'user', createdBy: 'ip-test' });
    const res = await request(app).get('/health').set('x-api-key', key);
    expect(res.status).toBe(200);
  });

  it('allows requests from a listed IP (loopback variants)', async () => {
    // supertest connects from 127.0.0.1; Express may present it as ::ffff:127.0.0.1
    const { key } = await apiKeysModel.createApiKey({
      name: 'Allowed Loopback',
      role: 'user',
      createdBy: 'ip-test',
      allowedIps: ['127.0.0.1', '::ffff:127.0.0.1', '::1'],
    });
    const res = await request(app).get('/health').set('x-api-key', key);
    expect(res.status).toBe(200);
  });

  it('rejects requests from an IP not in the allowlist with 403', async () => {
    const { key } = await apiKeysModel.createApiKey({
      name: 'Blocked Key',
      role: 'user',
      createdBy: 'ip-test',
      allowedIps: ['203.0.113.1'],   // RFC 5737 documentation range — never a real client
    });
    const res = await request(app).get('/health').set('x-api-key', key);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('allows requests matching a CIDR range that includes loopback', async () => {
    const { key } = await apiKeysModel.createApiKey({
      name: 'CIDR Loopback',
      role: 'user',
      createdBy: 'ip-test',
      allowedIps: ['127.0.0.0/8', '::ffff:127.0.0.0/104', '::1/128'],
    });
    const res = await request(app).get('/health').set('x-api-key', key);
    expect(res.status).toBe(200);
  });

  it('rejects requests not matching a CIDR range with 403', async () => {
    const { key } = await apiKeysModel.createApiKey({
      name: 'CIDR Block',
      role: 'user',
      createdBy: 'ip-test',
      allowedIps: ['203.0.113.0/24'],
    });
    const res = await request(app).get('/health').set('x-api-key', key);
    expect(res.status).toBe(403);
  });

  it('logs a warning with clientIp and keyId when a request is rejected', async () => {
    const warnSpy = jest.spyOn(log, 'warn');
    const { key, id } = await apiKeysModel.createApiKey({
      name: 'Log Test Key',
      role: 'user',
      createdBy: 'ip-test',
      allowedIps: ['203.0.113.1'],
    });

    await request(app).get('/health').set('x-api-key', key);

    const call = warnSpy.mock.calls.find(([, msg]) => msg === 'Request rejected: IP not in allowlist');
    expect(call).toBeDefined();
    const meta = call[2];
    expect(meta).toMatchObject({ keyId: id });
    expect(meta).toHaveProperty('clientIp');

    warnSpy.mockRestore();
  });
});

// ─── Integration tests: POST /api/v1/api-keys with allowedIps ───────────────

describe('POST /api/v1/api-keys with allowedIps', () => {
  let app;
  let adminKey;

  beforeAll(async () => {
    await apiKeysModel.initializeApiKeysTable();
    const admin = await apiKeysModel.createApiKey({ name: 'Route Admin', role: 'admin', createdBy: 'ip-route-test' });
    adminKey = admin.key;
    app = buildApp();
  });

  afterAll(async () => {
    await db.run("DELETE FROM api_keys WHERE created_by = 'ip-route-test'");
  });

  it('creates a key with allowedIps and persists them', async () => {
    const res = await request(app)
      .post('/api/v1/api-keys')
      .set('x-api-key', adminKey)
      .send({ name: 'IP Restricted Key', role: 'user', allowedIps: ['10.0.0.1', '192.168.0.0/16'] });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const stored = await apiKeysModel.validateApiKey(res.body.data.key);
    expect(stored.allowedIps).toEqual(['10.0.0.1', '192.168.0.0/16']);
  });

  it('creates a key without allowedIps (unrestricted)', async () => {
    const res = await request(app)
      .post('/api/v1/api-keys')
      .set('x-api-key', adminKey)
      .send({ name: 'Unrestricted Key', role: 'user' });

    expect(res.status).toBe(201);
    const stored = await apiKeysModel.validateApiKey(res.body.data.key);
    expect(stored.allowedIps).toBeNull();
  });
});

// ─── Integration tests: PATCH /api/v1/api-keys/:id ──────────────────────────

describe('PATCH /api/v1/api-keys/:id', () => {
  let app;
  let adminKey;
  let targetKeyId;

  beforeAll(async () => {
    await apiKeysModel.initializeApiKeysTable();
    const admin = await apiKeysModel.createApiKey({ name: 'Patch Admin', role: 'admin', createdBy: 'ip-patch-test' });
    adminKey = admin.key;
    const target = await apiKeysModel.createApiKey({ name: 'Patch Target', role: 'user', createdBy: 'ip-patch-test' });
    targetKeyId = target.id;
    app = buildApp();
  });

  afterAll(async () => {
    await db.run("DELETE FROM api_keys WHERE created_by = 'ip-patch-test'");
  });

  it('sets allowedIps on an existing key', async () => {
    const res = await request(app)
      .patch(`/api/v1/api-keys/${targetKeyId}`)
      .set('x-api-key', adminKey)
      .send({ allowedIps: ['1.2.3.4'] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const row = await db.get('SELECT allowed_ips FROM api_keys WHERE id = ?', [targetKeyId]);
    expect(JSON.parse(row.allowed_ips)).toEqual(['1.2.3.4']);
  });

  it('clears allowedIps by passing null', async () => {
    const res = await request(app)
      .patch(`/api/v1/api-keys/${targetKeyId}`)
      .set('x-api-key', adminKey)
      .send({ allowedIps: null });

    expect(res.status).toBe(200);
    const row = await db.get('SELECT allowed_ips FROM api_keys WHERE id = ?', [targetKeyId]);
    expect(row.allowed_ips).toBeNull();
  });

  it('returns 404 for a non-existent key id', async () => {
    const res = await request(app)
      .patch('/api/v1/api-keys/999999')
      .set('x-api-key', adminKey)
      .send({ allowedIps: ['1.2.3.4'] });

    expect(res.status).toBe(404);
  });

  it('rejects PATCH without admin role', async () => {
    const user = await apiKeysModel.createApiKey({ name: 'Patch User', role: 'user', createdBy: 'ip-patch-test' });
    const res = await request(app)
      .patch(`/api/v1/api-keys/${targetKeyId}`)
      .set('x-api-key', user.key)
      .send({ allowedIps: ['1.2.3.4'] });

    expect(res.status).toBe(403);
  });
});
