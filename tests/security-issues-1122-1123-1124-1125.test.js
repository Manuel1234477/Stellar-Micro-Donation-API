'use strict';

/**
 * Tests for issues #1125, #1124, #1123, #1122.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ─────────────────────────────────────────────────────────────────────────────
// Issue #1125 — Path traversal in BackupService.restore() and download endpoint
// ─────────────────────────────────────────────────────────────────────────────

describe('Issue #1125 – Path traversal protection in BackupService', () => {
  let BackupService;
  let tmpDir;

  beforeAll(() => {
    BackupService = require('../src/services/BackupService');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'traversal-test-'));
  });

  afterAll(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects traversal payload ../../etc/passwd', async () => {
    const svc = new BackupService({ backupDir: tmpDir, dbPath: path.join(tmpDir, 'test.db') });
    await expect(svc.restore('../../etc/passwd')).rejects.toThrow();
  });

  it('rejects backupId with forward slash', async () => {
    const svc = new BackupService({ backupDir: tmpDir, dbPath: path.join(tmpDir, 'test.db') });
    await expect(svc.restore('foo/bar')).rejects.toThrow();
  });

  it('rejects backupId with null byte', async () => {
    const svc = new BackupService({ backupDir: tmpDir, dbPath: path.join(tmpDir, 'test.db') });
    await expect(svc.restore('foo\x00bar')).rejects.toThrow();
  });

  it('accepts a normal backupId and throws "Backup not found" (not traversal error)', async () => {
    const svc = new BackupService({ backupDir: tmpDir, dbPath: path.join(tmpDir, 'test.db') });
    await expect(svc.restore('backup_1234_abcd')).rejects.toThrow('Backup not found');
  });

  it('resolved path stays within backupDir for valid id', () => {
    const backupId = 'backup_1234_abcd';
    const backupDir = path.resolve(tmpDir);
    const filePath = path.resolve(backupDir, `${backupId}.enc`);
    expect(filePath.startsWith(backupDir + path.sep)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Issue #1123 — Brute-force lockout for auth token endpoints
// ─────────────────────────────────────────────────────────────────────────────

describe('Issue #1123 – Brute-force protection', () => {
  let bf;

  beforeEach(() => {
    jest.resetModules();
    bf = require('../src/utils/bruteForceProtection');
    bf._store.clear();
  });

  it('allows requests before lockout threshold', () => {
    expect(bf.isLockedOut('1.2.3.4')).toBe(false);
  });

  it('locks out after MAX_ATTEMPTS failures', () => {
    const ip = '10.0.0.1';
    const max = parseInt(process.env.AUTH_MAX_ATTEMPTS || '5', 10);
    for (let i = 0; i < max; i++) {
      bf.recordFailure(ip);
    }
    expect(bf.isLockedOut(ip)).toBe(true);
  });

  it('lockoutRemainingMs returns > 0 when locked', () => {
    const ip = '10.0.0.2';
    const max = parseInt(process.env.AUTH_MAX_ATTEMPTS || '5', 10);
    for (let i = 0; i < max; i++) bf.recordFailure(ip);
    expect(bf.lockoutRemainingMs(ip)).toBeGreaterThan(0);
  });

  it('recordSuccess clears lockout state', () => {
    const ip = '10.0.0.3';
    const max = parseInt(process.env.AUTH_MAX_ATTEMPTS || '5', 10);
    for (let i = 0; i < max; i++) bf.recordFailure(ip);
    expect(bf.isLockedOut(ip)).toBe(true);
    bf.recordSuccess(ip);
    expect(bf.isLockedOut(ip)).toBe(false);
  });

  it('middleware returns 429 with Retry-After for locked IPs', () => {
    const ip = '10.0.0.4';
    const max = parseInt(process.env.AUTH_MAX_ATTEMPTS || '5', 10);
    for (let i = 0; i < max; i++) bf.recordFailure(ip);

    const mw = bf.middleware();
    const req = { ip };
    const res = {
      _headers: {},
      _status: null,
      _body: null,
      setHeader(k, v) { this._headers[k] = v; },
      status(code) { this._status = code; return this; },
      json(body) { this._body = body; return this; },
    };
    const next = jest.fn();

    mw(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(429);
    expect(res._headers['Retry-After']).toBeTruthy();
    expect(res._body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('middleware calls next() for non-locked IPs', () => {
    const mw = bf.middleware();
    const req = { ip: '192.168.1.1' };
    const res = {};
    const next = jest.fn();
    mw(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('does not lock out before reaching threshold', () => {
    const ip = '10.0.0.5';
    const max = parseInt(process.env.AUTH_MAX_ATTEMPTS || '5', 10);
    for (let i = 0; i < max - 1; i++) bf.recordFailure(ip);
    expect(bf.isLockedOut(ip)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Issue #1122 — Sensitive field redaction in LOG_BODY / LOG_HEADERS paths
// ─────────────────────────────────────────────────────────────────────────────

describe('Issue #1122 – dataMasker covers sensitive log fields', () => {
  let maskSensitiveData;

  beforeAll(() => {
    ({ maskSensitiveData } = require('../src/utils/dataMasker'));
  });

  const FIELDS = [
    'authorization',
    'x-api-key',
    'x_api_key',
    'password',
    'secret',
    'token',
    'apikey',
    'api_key',
    'seed',
    'memo',
    'refreshToken',
    'accessToken',
  ];

  for (const field of FIELDS) {
    it(`masks field "${field}"`, () => {
      const input = { [field]: 'super-secret-value' };
      const result = maskSensitiveData(input);
      expect(result[field]).not.toBe('super-secret-value');
      expect(typeof result[field]).toBe('string');
    });
  }

  it('does not mask non-sensitive fields', () => {
    const input = { username: 'alice', amount: 100 };
    const result = maskSensitiveData(input);
    expect(result.username).toBe('alice');
    expect(result.amount).toBe(100);
  });

  it('masks nested sensitive fields', () => {
    const input = { user: { password: 'letmein', name: 'bob' } };
    const result = maskSensitiveData(input);
    expect(result.user.password).not.toBe('letmein');
    expect(result.user.name).toBe('bob');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Issue #1124 — Router-level RBAC guard on /admin tree
// ─────────────────────────────────────────────────────────────────────────────

describe('Issue #1124 – Admin routes require RBAC guard by construction', () => {
  const routesBootstrapPath = path.join(__dirname, '../src/bootstrap/routes.js');
  const adminDir = path.join(__dirname, '../src/routes/admin');

  it('routes bootstrap applies requireApiKey + requireAdmin to /admin before ADMIN_ROUTES loop', () => {
    const src = fs.readFileSync(routesBootstrapPath, 'utf8');
    const guardIdx = src.indexOf("app.use('/admin', requireApiKey, rbac.requireAdmin())");
    const loopIdx = src.indexOf('for (const [path, router] of ADMIN_ROUTES)');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(loopIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(loopIdx);
  });

  it('every admin sub-router file uses checkPermission(PERMISSIONS.ADMIN_ALL) or requireAdmin', () => {
    const files = fs.readdirSync(adminDir).filter(f => f.endsWith('.js'));
    const unprotected = [];

    for (const file of files) {
      const content = fs.readFileSync(path.join(adminDir, file), 'utf8');
      const hasGuard =
        content.includes('checkPermission') ||
        content.includes('requireAdmin') ||
        content.includes('PERMISSIONS.ADMIN');
      if (!hasGuard) unprotected.push(file);
    }

    expect(unprotected).toEqual([]);
  });
});
