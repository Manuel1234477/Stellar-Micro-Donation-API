/**
 * Tests: Two-Factor Authentication (TOTP) for Admin Operations
 */
'use strict';

const crypto = require('crypto');

// ─── In-memory DB shim ────────────────────────────────────────────────────────
const _rows = new Map();
let _nextId = 1;

function _resetDb() { _rows.clear(); _nextId = 1; }

function _insertRow(data = {}) {
  const id = _nextId++;
  _rows.set(id, { id, name: 'test-key', totp_enabled: 0, totp_secret: null, totp_backup_codes: null, ...data });
  return id;
}

const mockDb = {
  async run(sql, params = []) {
    const s = sql.trim().toUpperCase();
    if (s.startsWith('ALTER TABLE')) return { changes: 0 };
    if (s.startsWith('UPDATE')) {
      const setMatch = sql.match(/SET\s+(.+?)\s+WHERE\s+id\s*=\s*\?/is);
      if (setMatch) {
        const id = params[params.length - 1];
        const row = _rows.get(id);
        if (!row) return { changes: 0 };
        const setClause = setMatch[1];
        const setParts = setClause.split(/\s*,\s*/);
        let pi = 0;
        for (const part of setParts) {
          const eqIdx = part.indexOf('=');
          const col = part.slice(0, eqIdx).trim();
          const valRaw = part.slice(eqIdx + 1).trim();
          if (valRaw === '?') {
            row[col] = params[pi++];
          } else if (valRaw.toUpperCase() === 'NULL') {
            row[col] = null;
          } else if (!isNaN(valRaw)) {
            row[col] = Number(valRaw);
          } else {
            row[col] = valRaw;
          }
        }
        return { changes: 1 };
      }
      return { changes: 0 };
    }
    return { changes: 0 };
  },
  async get(sql, params = []) { return _rows.get(params[0]) || null; },
  async all() { return Array.from(_rows.values()); },
  async query() { return []; },
};

jest.mock('../src/utils/database', () => mockDb);

const TOTPService = require('../../src/services/TOTPService');
const {
  generateSecret, verify, enable, disable, verifyBackupCode,
  isTotpEnabled, remainingBackupCodes,
  generateCode, base32Encode, base32Decode,
  TOTP_STEP, TOTP_DIGITS, BACKUP_CODE_COUNT,
} = TOTPService;

beforeEach(() => _resetDb());

// ─── 1. Base32 helpers ────────────────────────────────────────────────────────
describe('base32Encode / base32Decode', () => {
  test('round-trip preserves bytes', () => {
    const buf = crypto.randomBytes(20);
    expect(base32Decode(base32Encode(buf))).toEqual(buf);
  });
  test('decode is case-insensitive', () => {
    const buf = crypto.randomBytes(10);
    const enc = base32Encode(buf);
    expect(base32Decode(enc.toLowerCase())).toEqual(base32Decode(enc));
  });
  test('encode produces only valid base32 characters', () => {
    expect(base32Encode(crypto.randomBytes(20))).toMatch(/^[A-Z2-7]+$/);
  });
  test('decode ignores padding characters', () => {
    const buf = crypto.randomBytes(5);
    const enc = base32Encode(buf) + '====';
    expect(base32Decode(enc)).toEqual(base32Decode(base32Encode(buf)));
  });
});

// ─── 2. generateCode ─────────────────────────────────────────────────────────
describe('generateCode', () => {
  test('returns a 6-digit string', () => {
    expect(generateCode(base32Encode(crypto.randomBytes(20)))).toMatch(/^\d{6}$/);
  });
  test('same secret + same timestamp → same code', () => {
    const secret = base32Encode(crypto.randomBytes(20));
    const ts = Date.now();
    expect(generateCode(secret, ts)).toBe(generateCode(secret, ts));
  });
  test('different windows → different codes (statistically)', () => {
    const secret = base32Encode(crypto.randomBytes(20));
    expect(generateCode(secret, 0)).not.toBe(generateCode(secret, TOTP_STEP * 1000 * 100));
  });
  test('codes within same 30-second window are identical', () => {
    const secret = base32Encode(crypto.randomBytes(20));
    const base = Math.floor(Date.now() / (TOTP_STEP * 1000)) * TOTP_STEP * 1000;
    expect(generateCode(secret, base)).toBe(generateCode(secret, base + 15000));
  });
  test('always produces zero-padded 6-digit output', () => {
    const secret = base32Encode(Buffer.alloc(20, 0));
    for (let i = 0; i < 10; i++) {
      expect(generateCode(secret, i * TOTP_STEP * 1000)).toMatch(/^\d{6}$/);
    }
  });
});

// ─── 3. generateSecret ───────────────────────────────────────────────────────
describe('generateSecret', () => {
  test('returns secret, qrCodeDataUrl, backupCodes, otpauthUrl', async () => {
    const id = _insertRow({ name: 'my-admin-key' });
    const result = await generateSecret(id, 'my-admin-key');
    expect(result.secret).toMatch(/^[A-Z2-7]+$/);
    expect(result.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(result.otpauthUrl).toContain('otpauth://totp/');
    expect(result.backupCodes).toHaveLength(BACKUP_CODE_COUNT);
  });
  test('backup codes are 10-character hex strings', async () => {
    const id = _insertRow();
    const { backupCodes } = await generateSecret(id, 'k');
    for (const code of backupCodes) expect(code).toMatch(/^[0-9a-f]{10}$/);
  });
  test('stores hashed backup codes in DB (not plain-text)', async () => {
    const id = _insertRow();
    const { backupCodes } = await generateSecret(id, 'k');
    const stored = JSON.parse(_rows.get(id).totp_backup_codes);
    for (const code of backupCodes) expect(stored).not.toContain(code);
    expect(stored).toHaveLength(BACKUP_CODE_COUNT);
  });
  test('totp_enabled remains 0 after setup', async () => {
    const id = _insertRow();
    await generateSecret(id, 'k');
    expect(_rows.get(id).totp_enabled).toBe(0);
  });
  test('otpauthUrl contains the secret', async () => {
    const id = _insertRow();
    const { secret, otpauthUrl } = await generateSecret(id, 'k');
    expect(otpauthUrl).toContain(secret);
  });
  test('multiple calls overwrite the previous secret', async () => {
    const id = _insertRow();
    const first = await generateSecret(id, 'k');
    const second = await generateSecret(id, 'k');
    expect(second.secret).not.toBe(first.secret);
    expect(await verify(id, generateCode(first.secret))).toBe(false);
  });
});

// ─── 4. verify ───────────────────────────────────────────────────────────────
describe('verify', () => {
  test('returns true for a valid current code', async () => {
    const id = _insertRow();
    const { secret } = await generateSecret(id, 'k');
    expect(await verify(id, generateCode(secret))).toBe(true);
  });
  test('returns false for a wrong code', async () => {
    const id = _insertRow();
    await generateSecret(id, 'k');
    expect(await verify(id, '000000')).toBe(false);
  });
  test('returns false for non-numeric input', async () => {
    const id = _insertRow();
    await generateSecret(id, 'k');
    expect(await verify(id, 'abcdef')).toBe(false);
  });
  test('returns false for null/undefined code', async () => {
    const id = _insertRow();
    await generateSecret(id, 'k');
    expect(await verify(id, null)).toBe(false);
    expect(await verify(id, undefined)).toBe(false);
  });
  test('returns false when no secret is stored', async () => {
    const id = _insertRow();
    expect(await verify(id, '123456')).toBe(false);
  });
  test('returns false for unknown keyId', async () => {
    expect(await verify(9999, '123456')).toBe(false);
  });
  test('accepts code from previous window (±1 tolerance)', async () => {
    const id = _insertRow();
    const { secret } = await generateSecret(id, 'k');
    const pastCode = generateCode(secret, Date.now() - TOTP_STEP * 1000);
    expect(await verify(id, pastCode)).toBe(true);
  });
  test('accepts code from next window (±1 tolerance)', async () => {
    const id = _insertRow();
    const { secret } = await generateSecret(id, 'k');
    const futureCode = generateCode(secret, Date.now() + TOTP_STEP * 1000);
    expect(await verify(id, futureCode)).toBe(true);
  });
  test('rejects code from 3 windows ago', async () => {
    const id = _insertRow();
    const { secret } = await generateSecret(id, 'k');
    const oldCode = generateCode(secret, Date.now() - TOTP_STEP * 1000 * 3);
    expect(await verify(id, oldCode)).toBe(false);
  });
  test('returns false for 5-digit code (too short)', async () => {
    const id = _insertRow();
    const { secret } = await generateSecret(id, 'k');
    expect(await verify(id, generateCode(secret).slice(1))).toBe(false);
  });
  test('returns false for 7-digit code (too long)', async () => {
    const id = _insertRow();
    const { secret } = await generateSecret(id, 'k');
    expect(await verify(id, generateCode(secret) + '0')).toBe(false);
  });
});

// ─── 5. enable ───────────────────────────────────────────────────────────────
describe('enable', () => {
  test('enables TOTP when a valid code is provided', async () => {
    const id = _insertRow();
    const { secret } = await generateSecret(id, 'k');
    const result = await enable(id, generateCode(secret));
    expect(result.enabled).toBe(true);
    expect(_rows.get(id).totp_enabled).toBe(1);
  });
  test('returns enabled:false for invalid code', async () => {
    const id = _insertRow();
    await generateSecret(id, 'k');
    const result = await enable(id, '000000');
    expect(result.enabled).toBe(false);
    expect(result.reason).toBeDefined();
  });
  test('returns enabled:false when no secret is set', async () => {
    const id = _insertRow();
    expect((await enable(id, '123456')).enabled).toBe(false);
  });
  test('returns enabled:false for unknown keyId', async () => {
    expect((await enable(9999, '123456')).enabled).toBe(false);
  });
  test('returns enabled:false when already enabled', async () => {
    const id = _insertRow();
    const { secret } = await generateSecret(id, 'k');
    await enable(id, generateCode(secret));
    const second = await enable(id, generateCode(secret));
    expect(second.enabled).toBe(false);
    expect(second.reason).toMatch(/already/i);
  });
});

// ─── 6. disable ──────────────────────────────────────────────────────────────
describe('disable', () => {
  async function setupEnabled() {
    const id = _insertRow();
    const { secret, backupCodes } = await generateSecret(id, 'k');
    await enable(id, generateCode(secret));
    return { id, secret, backupCodes };
  }
  test('disables TOTP with a valid TOTP code', async () => {
    const { id, secret } = await setupEnabled();
    const result = await disable(id, generateCode(secret));
    expect(result.disabled).toBe(true);
    expect(_rows.get(id).totp_enabled).toBe(0);
    expect(_rows.get(id).totp_secret).toBeNull();
  });
  test('disables TOTP with a valid backup code', async () => {
    const { id, backupCodes } = await setupEnabled();
    expect((await disable(id, backupCodes[0])).disabled).toBe(true);
  });
  test('returns disabled:false for invalid code', async () => {
    const { id } = await setupEnabled();
    expect((await disable(id, '000000')).disabled).toBe(false);
  });
  test('returns disabled:false when TOTP is not enabled', async () => {
    const id = _insertRow();
    const result = await disable(id, '123456');
    expect(result.disabled).toBe(false);
    expect(result.reason).toMatch(/not enabled/i);
  });
  test('returns disabled:false for unknown keyId', async () => {
    expect((await disable(9999, '123456')).disabled).toBe(false);
  });
  test('clears secret and backup codes after disable', async () => {
    const { id, secret } = await setupEnabled();
    await disable(id, generateCode(secret));
    expect(_rows.get(id).totp_secret).toBeNull();
    expect(_rows.get(id).totp_backup_codes).toBeNull();
  });
});

// ─── 7. verifyBackupCode ─────────────────────────────────────────────────────
describe('verifyBackupCode', () => {
  async function setupWithBackups() {
    const id = _insertRow();
    const { secret, backupCodes } = await generateSecret(id, 'k');
    await enable(id, generateCode(secret));
    return { id, backupCodes };
  }
  test('returns true for a valid backup code', async () => {
    const { id, backupCodes } = await setupWithBackups();
    expect(await verifyBackupCode(id, backupCodes[0])).toBe(true);
  });
  test('backup code is single-use — second use returns false', async () => {
    const { id, backupCodes } = await setupWithBackups();
    await verifyBackupCode(id, backupCodes[0]);
    expect(await verifyBackupCode(id, backupCodes[0])).toBe(false);
  });
  test('consuming one code does not affect others', async () => {
    const { id, backupCodes } = await setupWithBackups();
    await verifyBackupCode(id, backupCodes[0]);
    expect(await verifyBackupCode(id, backupCodes[1])).toBe(true);
  });
  test('remaining count decrements after use', async () => {
    const { id, backupCodes } = await setupWithBackups();
    const before = await remainingBackupCodes(id);
    await verifyBackupCode(id, backupCodes[0]);
    expect(await remainingBackupCodes(id)).toBe(before - 1);
  });
  test('returns false for unknown code', async () => {
    const { id } = await setupWithBackups();
    expect(await verifyBackupCode(id, 'deadbeefff')).toBe(false);
  });
  test('returns false for null/undefined', async () => {
    const { id } = await setupWithBackups();
    expect(await verifyBackupCode(id, null)).toBe(false);
    expect(await verifyBackupCode(id, undefined)).toBe(false);
  });
  test('returns false when no backup codes stored', async () => {
    expect(await verifyBackupCode(_insertRow(), 'abc')).toBe(false);
  });
  test('all 10 backup codes are independently valid', async () => {
    const { id, backupCodes } = await setupWithBackups();
    for (const code of backupCodes) expect(await verifyBackupCode(id, code)).toBe(true);
    expect(await remainingBackupCodes(id)).toBe(0);
  });
});

// ─── 8. isTotpEnabled / remainingBackupCodes ─────────────────────────────────
describe('isTotpEnabled', () => {
  test('returns false before setup', async () => {
    expect(await isTotpEnabled(_insertRow())).toBe(false);
  });
  test('returns false after setup but before enable', async () => {
    const id = _insertRow();
    await generateSecret(id, 'k');
    expect(await isTotpEnabled(id)).toBe(false);
  });
  test('returns true after enable', async () => {
    const id = _insertRow();
    const { secret } = await generateSecret(id, 'k');
    await enable(id, generateCode(secret));
    expect(await isTotpEnabled(id)).toBe(true);
  });
  test('returns false after disable', async () => {
    const id = _insertRow();
    const { secret } = await generateSecret(id, 'k');
    await enable(id, generateCode(secret));
    await disable(id, generateCode(secret));
    expect(await isTotpEnabled(id)).toBe(false);
  });
  test('returns false for unknown keyId', async () => {
    expect(await isTotpEnabled(9999)).toBe(false);
  });
});

describe('remainingBackupCodes', () => {
  test('returns 0 when no codes stored', async () => {
    expect(await remainingBackupCodes(_insertRow())).toBe(0);
  });
  test('returns BACKUP_CODE_COUNT after setup', async () => {
    const id = _insertRow();
    await generateSecret(id, 'k');
    expect(await remainingBackupCodes(id)).toBe(BACKUP_CODE_COUNT);
  });
});

// ─── 9. requireAdmin TOTP middleware ─────────────────────────────────────────
describe('requireAdmin middleware with TOTP', () => {
  function makeReq(overrides = {}) {
    return {
      user: { id: 'apikey-1', role: 'admin' },
      apiKey: { id: 1, isLegacy: false },
      body: {},
      get: jest.fn((h) => (overrides.headers || {})[h] || undefined),
      id: 'req-1', ip: '127.0.0.1', path: '/api-keys', method: 'POST',
      ...overrides,
    };
  }
  function makeRes() {
    const res = {
      _status: null, _body: null, headers: {},
      setHeader: jest.fn(function(k, v) { this.headers[k] = v; }),
      status: jest.fn(function(s) { this._status = s; return this; }),
      json: jest.fn(function(b) { this._body = b; return this; }),
    };
    return res;
  }

  beforeEach(() => jest.resetModules());

  test('passes through when TOTP is not enabled', async () => {
    jest.mock('../src/services/TOTPService', () => ({
      isTotpEnabled: jest.fn().mockResolvedValue(false),
      verify: jest.fn(), verifyBackupCode: jest.fn(),
    }));
    const { requireAdmin: ra } = require('../../src/middleware/rbac');
    const next = jest.fn();
    await ra()(makeReq(), makeRes(), next);
    expect(next).toHaveBeenCalled();
  });

  test('returns 401 + X-TOTP-Required when TOTP enabled but no code supplied', async () => {
    jest.mock('../src/services/TOTPService', () => ({
      isTotpEnabled: jest.fn().mockResolvedValue(true),
      verify: jest.fn(), verifyBackupCode: jest.fn(),
    }));
    const { requireAdmin: ra } = require('../../src/middleware/rbac');
    const res = makeRes(); const next = jest.fn();
    await ra()(makeReq(), res, next);
    expect(res._status).toBe(401);
    expect(res.setHeader).toHaveBeenCalledWith('X-TOTP-Required', 'true');
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 401 + X-TOTP-Required for invalid TOTP code', async () => {
    jest.mock('../src/services/TOTPService', () => ({
      isTotpEnabled: jest.fn().mockResolvedValue(true),
      verify: jest.fn().mockResolvedValue(false),
      verifyBackupCode: jest.fn().mockResolvedValue(false),
    }));
    const { requireAdmin: ra } = require('../../src/middleware/rbac');
    const req = makeReq();
    req.get = jest.fn((h) => h === 'X-TOTP-Code' ? '000000' : undefined);
    const res = makeRes(); const next = jest.fn();
    await ra()(req, res, next);
    expect(res._status).toBe(401);
    expect(res.setHeader).toHaveBeenCalledWith('X-TOTP-Required', 'true');
  });

  test('passes through with valid TOTP code in X-TOTP-Code header', async () => {
    jest.mock('../src/services/TOTPService', () => ({
      isTotpEnabled: jest.fn().mockResolvedValue(true),
      verify: jest.fn().mockResolvedValue(true),
      verifyBackupCode: jest.fn().mockResolvedValue(false),
    }));
    const { requireAdmin: ra } = require('../../src/middleware/rbac');
    const req = makeReq();
    req.get = jest.fn((h) => h === 'X-TOTP-Code' ? '123456' : undefined);
    const next = jest.fn();
    await ra()(req, makeRes(), next);
    expect(next).toHaveBeenCalled();
  });

  test('passes through with valid backup code in header', async () => {
    jest.mock('../src/services/TOTPService', () => ({
      isTotpEnabled: jest.fn().mockResolvedValue(true),
      verify: jest.fn().mockResolvedValue(false),
      verifyBackupCode: jest.fn().mockResolvedValue(true),
    }));
    const { requireAdmin: ra } = require('../../src/middleware/rbac');
    const req = makeReq();
    req.get = jest.fn((h) => h === 'X-TOTP-Code' ? 'deadbeefff' : undefined);
    const next = jest.fn();
    await ra()(req, makeRes(), next);
    expect(next).toHaveBeenCalled();
  });

  test('accepts TOTP code from request body totpCode field', async () => {
    jest.mock('../src/services/TOTPService', () => ({
      isTotpEnabled: jest.fn().mockResolvedValue(true),
      verify: jest.fn().mockResolvedValue(true),
      verifyBackupCode: jest.fn().mockResolvedValue(false),
    }));
    const { requireAdmin: ra } = require('../../src/middleware/rbac');
    const req = makeReq();
    req.get = jest.fn(() => undefined);
    req.body = { totpCode: '654321' };
    const next = jest.fn();
    await ra()(req, makeRes(), next);
    expect(next).toHaveBeenCalled();
  });

  test('skips TOTP check for legacy keys', async () => {
    jest.mock('../src/services/TOTPService', () => ({
      isTotpEnabled: jest.fn(), verify: jest.fn(), verifyBackupCode: jest.fn(),
    }));
    const { requireAdmin: ra } = require('../../src/middleware/rbac');
    const req = makeReq();
    req.apiKey = { isLegacy: true };
    const next = jest.fn();
    await ra()(req, makeRes(), next);
    expect(next).toHaveBeenCalled();
    expect(require('../../src/services/TOTPService').isTotpEnabled).not.toHaveBeenCalled();
  });

  test('returns 403 for non-admin role', async () => {
    jest.mock('../src/services/TOTPService', () => ({
      isTotpEnabled: jest.fn().mockResolvedValue(false),
      verify: jest.fn(), verifyBackupCode: jest.fn(),
    }));
    const { requireAdmin: ra } = require('../../src/middleware/rbac');
    const req = makeReq();
    req.user = { id: 'apikey-2', role: 'user' };
    const next = jest.fn();
    await ra()(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });
});

// ─── 10. Constants ────────────────────────────────────────────────────────────
describe('Constants', () => {
  test('BACKUP_CODE_COUNT is 10', () => { expect(BACKUP_CODE_COUNT).toBe(10); });
  test('TOTP_DIGITS is 6', () => { expect(TOTP_DIGITS).toBe(6); });
  test('TOTP_STEP is 30', () => { expect(TOTP_STEP).toBe(30); });
});
