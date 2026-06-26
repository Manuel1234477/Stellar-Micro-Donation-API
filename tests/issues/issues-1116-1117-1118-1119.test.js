'use strict';

/**
 * Tests for issues #1116, #1117, #1118, #1119
 */

const { isBlockedIPv4, isBlockedIPv6, assertSafeOutboundUrl } = require('../../src/utils/ssrf');

// ---------------------------------------------------------------------------
// #1119 — assertSafeOutboundUrl / SSRF protection
// ---------------------------------------------------------------------------
describe('#1119 assertSafeOutboundUrl', () => {
  test('rejects http:// scheme', async () => {
    await expect(assertSafeOutboundUrl('http://example.com/hook')).rejects.toThrow('SSRF');
  });

  test('rejects invalid URL', async () => {
    await expect(assertSafeOutboundUrl('not-a-url')).rejects.toThrow('SSRF');
  });

  test('isBlockedIPv4 — loopback 127.0.0.1', () => {
    expect(isBlockedIPv4('127.0.0.1')).toBe(true);
  });

  test('isBlockedIPv4 — private 10.0.0.1', () => {
    expect(isBlockedIPv4('10.0.0.1')).toBe(true);
  });

  test('isBlockedIPv4 — private 192.168.1.1', () => {
    expect(isBlockedIPv4('192.168.1.1')).toBe(true);
  });

  test('isBlockedIPv4 — AWS metadata 169.254.169.254', () => {
    expect(isBlockedIPv4('169.254.169.254')).toBe(true);
  });

  test('isBlockedIPv4 — private 172.16.0.1', () => {
    expect(isBlockedIPv4('172.16.0.1')).toBe(true);
  });

  test('isBlockedIPv4 — public 8.8.8.8 is allowed', () => {
    expect(isBlockedIPv4('8.8.8.8')).toBe(false);
  });

  test('isBlockedIPv4 — public 93.184.216.34 is allowed', () => {
    expect(isBlockedIPv4('93.184.216.34')).toBe(false);
  });

  test('isBlockedIPv6 — loopback ::1', () => {
    expect(isBlockedIPv6('::1')).toBe(true);
  });

  test('isBlockedIPv6 — ULA fd00::1', () => {
    expect(isBlockedIPv6('fd00::1')).toBe(true);
  });

  test('isBlockedIPv6 — link-local fe80::1', () => {
    expect(isBlockedIPv6('fe80::1')).toBe(true);
  });

  test('rejects https:// to loopback IP literal', async () => {
    await expect(assertSafeOutboundUrl('https://127.0.0.1/hook')).rejects.toThrow('SSRF');
  });

  test('rejects https:// to private IP literal', async () => {
    await expect(assertSafeOutboundUrl('https://192.168.0.1/hook')).rejects.toThrow('SSRF');
  });

  test('rejects https:// to AWS metadata IP literal', async () => {
    await expect(assertSafeOutboundUrl('https://169.254.169.254/latest/meta-data')).rejects.toThrow('SSRF');
  });
});

// ---------------------------------------------------------------------------
// #1117 — secret strength validation in startupChecks
// ---------------------------------------------------------------------------
describe('#1117 checkSecretStrength (via startupChecks internals)', () => {
  // We test the logic directly by importing startupChecks and inspecting results.
  // To keep tests isolated we call run() with mocked env vars.

  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env
    Object.keys(process.env).forEach(k => { if (!(k in originalEnv)) delete process.env[k]; });
    Object.assign(process.env, originalEnv);
    // Reset module so results array is cleared
    jest.resetModules();
  });

  async function runChecks(envOverrides = {}) {
    Object.assign(process.env, envOverrides);
    const { run } = require('../../src/utils/startupChecks');
    const result = await run({ exitOnFailure: false });
    return result;
  }

  test('passes when EXPORT_SIGNING_SECRET has 32+ bytes', async () => {
    const strong = require('crypto').randomBytes(32).toString('hex');
    const { results } = await runChecks({ EXPORT_SIGNING_SECRET: strong, NODE_ENV: 'development' });
    const r = results.find(x => x.name === 'EXPORT_SIGNING_SECRET');
    expect(r).toBeDefined();
    expect(r.status).toBe('pass');
  });

  test('fails when EXPORT_SIGNING_SECRET is a placeholder "changeme"', async () => {
    const { results } = await runChecks({ EXPORT_SIGNING_SECRET: 'changeme', NODE_ENV: 'development' });
    const r = results.find(x => x.name === 'EXPORT_SIGNING_SECRET');
    expect(r).toBeDefined();
    expect(r.status).toBe('fail');
  });

  test('fails when EXPORT_SIGNING_SECRET is too short', async () => {
    const { results } = await runChecks({ EXPORT_SIGNING_SECRET: 'tooshort', NODE_ENV: 'development' });
    const r = results.find(x => x.name === 'EXPORT_SIGNING_SECRET');
    expect(r).toBeDefined();
    expect(r.status).toBe('fail');
  });

  test('fails when EXPORT_SIGNING_SECRET duplicates ENCRYPTION_KEY', async () => {
    const shared = require('crypto').randomBytes(32).toString('hex');
    const { results } = await runChecks({
      ENCRYPTION_KEY: shared,
      EXPORT_SIGNING_SECRET: shared,
      NODE_ENV: 'development',
    });
    const r = results.find(x => x.name === 'EXPORT_SIGNING_SECRET');
    expect(r).toBeDefined();
    expect(r.status).toBe('fail');
  });
});

// ---------------------------------------------------------------------------
// #1116 — unsafe flags guard in startupChecks
// ---------------------------------------------------------------------------
describe('#1116 checkUnsafeFlags', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    Object.keys(process.env).forEach(k => { if (!(k in originalEnv)) delete process.env[k]; });
    Object.assign(process.env, originalEnv);
    jest.resetModules();
  });

  async function runChecks(envOverrides = {}) {
    Object.assign(process.env, envOverrides);
    const { run } = require('../../src/utils/startupChecks');
    return run({ exitOnFailure: false });
  }

  test('fails when DISABLE_RATE_LIMIT=true in production', async () => {
    const { results } = await runChecks({ NODE_ENV: 'production', DISABLE_RATE_LIMIT: 'true' });
    const r = results.find(x => x.name === 'DISABLE_RATE_LIMIT');
    expect(r).toBeDefined();
    expect(r.status).toBe('fail');
  });

  test('fails when DEBUG_MODE=true in production', async () => {
    const { results } = await runChecks({ NODE_ENV: 'production', DEBUG_MODE: 'true' });
    const r = results.find(x => x.name === 'DEBUG_MODE');
    expect(r).toBeDefined();
    expect(r.status).toBe('fail');
  });

  test('warns (not fails) when DEBUG_MODE=true in development', async () => {
    const { results } = await runChecks({ NODE_ENV: 'development', DEBUG_MODE: 'true' });
    const r = results.find(x => x.name === 'DEBUG_MODE');
    expect(r).toBeDefined();
    expect(r.status).toBe('warn');
  });

  test('passes when no unsafe flags set in production', async () => {
    const { results } = await runChecks({ NODE_ENV: 'production', DISABLE_RATE_LIMIT: 'false', DEBUG_MODE: 'false' });
    const r = results.find(x => x.name === 'Unsafe flags');
    expect(r).toBeDefined();
    expect(r.status).toBe('pass');
  });
});

// ---------------------------------------------------------------------------
// #1118 — TOTP replay persistence helpers (unit)
// ---------------------------------------------------------------------------
describe('#1118 TOTP used-codes DB persistence', () => {
  // We verify that the middleware uses DB.get/run for replay protection
  // by monkey-patching the database module.

  const mockDb = {
    run: jest.fn().mockResolvedValue({}),
    get: jest.fn().mockResolvedValue(null), // no existing row by default
  };

  beforeEach(() => {
    jest.resetModules();
    jest.mock('../../src/utils/database', () => mockDb);
    jest.mock('../../src/services/TOTPService', () => ({
      verify: jest.fn().mockResolvedValue(true),
    }));
    mockDb.run.mockResolvedValue({});
    mockDb.get.mockResolvedValue(null);
  });

  afterEach(() => {
    jest.resetModules();
  });

  function makeReq(code) {
    return { apiKey: { id: 42 }, get: jest.fn().mockReturnValue(code), };
  }

  test('inserts replay key into DB after valid TOTP', async () => {
    process.env.REQUIRE_ADMIN_2FA = 'true';
    const { requireAdminTOTP } = require('../../src/middleware/adminTOTP');
    const middleware = requireAdminTOTP();
    const req = makeReq('123456');
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    // DB insert should have been called with INSERT OR IGNORE
    const insertCall = mockDb.run.mock.calls.find(c => c[0].includes('INSERT OR IGNORE'));
    expect(insertCall).toBeDefined();
  });

  test('blocks replay when DB already has the key', async () => {
    process.env.REQUIRE_ADMIN_2FA = 'true';
    mockDb.get.mockResolvedValue({ 1: 1 }); // simulate row found
    const { requireAdminTOTP } = require('../../src/middleware/adminTOTP');
    const middleware = requireAdminTOTP();
    const req = makeReq('123456');
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
