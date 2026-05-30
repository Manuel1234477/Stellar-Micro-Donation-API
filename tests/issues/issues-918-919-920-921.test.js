'use strict';
/**
 * Tests: Issues #918, #919, #920, #921
 */

// ─── Shared mocks (set up before any require) ─────────────────────────────────
const mockDbGet = jest.fn();
const mockDbRun = jest.fn().mockResolvedValue({ changes: 1 });
const mockDbAll = jest.fn().mockResolvedValue([]);
const mockDbQuery = jest.fn().mockResolvedValue([]);
const mockAuditLog = jest.fn().mockResolvedValue(undefined);

jest.mock('../../src/utils/database', () => ({
  get: (...a) => mockDbGet(...a),
  run: (...a) => mockDbRun(...a),
  all: (...a) => mockDbAll(...a),
  query: (...a) => mockDbQuery(...a),
}));

jest.mock('../../src/services/AuditLogService', () => ({
  log: (...a) => mockAuditLog(...a),
  CATEGORY: { FINANCIAL_OPERATION: 'FINANCIAL_OPERATION', DATA_ACCESS: 'DATA_ACCESS' },
  ACTION: {},
  SEVERITY: { MEDIUM: 'MEDIUM', LOW: 'LOW' },
}));

jest.mock('../../src/middleware/rbac', () => ({
  checkPermission: () => (req, res, next) => next(),
  requireAdmin: () => (req, res, next) => next(),
  attachUserRole: (req, res, next) => next(),
}));

jest.mock('../../src/middleware/apiKey', () => (req, res, next) => {
  req.apiKey = { id: 1, role: 'admin' };
  next();
});

// ─── Issue #920: CSP ──────────────────────────────────────────────────────────
describe('Issue #920 — Path-based CSP', () => {
  const { createPathBasedCspMiddleware, buildSwaggerCspValue, buildCspValue } = require('../../src/middleware/csp');

  test('Swagger CSP includes unsafe-eval', () => {
    const csp = buildSwaggerCspValue('/csp-report');
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("'unsafe-inline'");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("img-src 'self' data:");
    expect(csp).toContain("connect-src 'self'");
  });

  test('Strict CSP does not include unsafe-eval or unsafe-inline', () => {
    const csp = buildCspValue('testnonce', '/csp-report');
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).toContain("default-src 'none'");
  });

  test('/docs path gets Swagger CSP with unsafe-eval', () => {
    const middleware = createPathBasedCspMiddleware();
    const req = { path: '/docs', headers: {} };
    const res = { setHeader: jest.fn() };
    middleware(req, res, () => {});
    const cspHeader = res.setHeader.mock.calls.find(c => c[0] === 'Content-Security-Policy');
    expect(cspHeader).toBeDefined();
    expect(cspHeader[1]).toContain("'unsafe-eval'");
  });

  test('/donations path gets strict CSP', () => {
    const middleware = createPathBasedCspMiddleware();
    const req = { path: '/donations', headers: {} };
    const res = { locals: {}, setHeader: jest.fn() };
    middleware(req, res, () => {});
    const cspHeader = res.setHeader.mock.calls.find(c => c[0] === 'Content-Security-Policy');
    expect(cspHeader[1]).toContain("default-src 'none'");
  });

  test('/health path gets strict CSP', () => {
    const middleware = createPathBasedCspMiddleware();
    const req = { path: '/health', headers: {} };
    const res = { locals: {}, setHeader: jest.fn() };
    middleware(req, res, () => {});
    const cspHeader = res.setHeader.mock.calls.find(c => c[0] === 'Content-Security-Policy');
    expect(cspHeader[1]).toContain("default-src 'none'");
  });
});

// ─── Issue #918: Admin 2FA middleware ─────────────────────────────────────────
describe('Issue #918 — Admin TOTP 2FA middleware', () => {
  const mockVerify = jest.fn();

  jest.mock('../../src/services/TOTPService', () => ({
    verify: (...a) => mockVerify(...a),
    generateSecret: jest.fn(),
    enable: jest.fn(),
  }));

  // Import after mock is set up
  const { requireAdminTOTP } = require('../../src/middleware/adminTOTP');

  function makeReqRes(headers = {}, keyId = 1) {
    const req = { apiKey: { id: keyId }, get: (h) => headers[h] };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    return { req, res };
  }

  beforeEach(() => {
    mockVerify.mockReset();
    delete process.env.REQUIRE_ADMIN_2FA;
  });

  afterAll(() => { delete process.env.REQUIRE_ADMIN_2FA; });

  test('passes through when REQUIRE_ADMIN_2FA is not set', async () => {
    const { req, res } = makeReqRes();
    const next = jest.fn();
    await requireAdminTOTP()(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(mockVerify).not.toHaveBeenCalled();
  });

  test('passes through when REQUIRE_ADMIN_2FA=false', async () => {
    process.env.REQUIRE_ADMIN_2FA = 'false';
    const { req, res } = makeReqRes();
    const next = jest.fn();
    await requireAdminTOTP()(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('returns 403 when TOTP header missing', async () => {
    process.env.REQUIRE_ADMIN_2FA = 'true';
    const { req, res } = makeReqRes({});
    const next = jest.fn();
    await requireAdminTOTP()(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: 'TOTP_REQUIRED' }),
    }));
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 403 when TOTP code is invalid', async () => {
    process.env.REQUIRE_ADMIN_2FA = 'true';
    mockVerify.mockResolvedValue(false);
    const { req, res } = makeReqRes({ 'X-TOTP-Code': '000000' });
    const next = jest.fn();
    await requireAdminTOTP()(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('passes through when TOTP code is valid', async () => {
    process.env.REQUIRE_ADMIN_2FA = 'true';
    mockVerify.mockResolvedValue(true);
    const { req, res } = makeReqRes({ 'X-TOTP-Code': '123456' });
    const next = jest.fn();
    await requireAdminTOTP()(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('returns 403 on replayed code within same window', async () => {
    process.env.REQUIRE_ADMIN_2FA = 'true';
    mockVerify.mockResolvedValue(true);
    const middleware = requireAdminTOTP();
    const next = jest.fn();

    // First use — should pass
    const { req: req1, res: res1 } = makeReqRes({ 'X-TOTP-Code': '999888' }, 77);
    await middleware(req1, res1, next);
    expect(next).toHaveBeenCalledTimes(1);

    // Replay — same code, same key, same window
    const { req: req2, res: res2 } = makeReqRes({ 'X-TOTP-Code': '999888' }, 77);
    await middleware(req2, res2, next);
    expect(res2.status).toHaveBeenCalledWith(403);
    expect(next).toHaveBeenCalledTimes(1); // not called again
  });
});

// ─── Issue #919: Donations export endpoint ───────────────────────────────────
describe('Issue #919 — GET /donations/export', () => {
  const express = require('express');
  const request = require('supertest');
  const donationRoutes = require('../../src/routes/donation');

  const app = express();
  app.use(express.json());
  app.use('/donations', donationRoutes);

  beforeEach(() => {
    mockDbAll.mockReset();
    mockDbGet.mockReset();
  });

  test('returns CSV with correct Content-Type and header row', async () => {
    mockDbAll.mockResolvedValue([
      { id: 1, amount: '10.0', senderPublicKey: 'GABC', recipientPublicKey: 'GDEF', memo: 'test', status: 'completed', timestamp: '2024-01-01', transactionHash: 'abc123' },
    ]);
    const res = await request(app).get('/donations/export?format=csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toContain('id,amount,senderPublicKey');
    expect(res.text).toContain('GABC');
  });

  test('returns JSON array with correct Content-Type', async () => {
    mockDbAll.mockResolvedValue([
      { id: 1, amount: '5.0', senderPublicKey: 'GXYZ', recipientPublicKey: 'GAAA', memo: null, status: 'pending', timestamp: '2024-01-02', transactionHash: null },
    ]);
    const res = await request(app).get('/donations/export?format=json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    const parsed = JSON.parse(res.text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].senderPublicKey).toBe('GXYZ');
  });

  test('returns 400 for invalid format', async () => {
    const res = await request(app).get('/donations/export?format=xml');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_FORMAT');
  });

  test('CSV Content-Disposition includes filename', async () => {
    mockDbAll.mockResolvedValue([]);
    const res = await request(app).get('/donations/export?format=csv');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="donations-/);
  });

  test('empty export returns valid empty JSON array', async () => {
    mockDbAll.mockResolvedValue([]);
    const res = await request(app).get('/donations/export?format=json');
    expect(res.text).toBe('[]');
  });
});

// ─── Issue #921: PATCH /stream/schedules/:id ─────────────────────────────────
describe('Issue #921 — PATCH /stream/schedules/:id', () => {
  const express = require('express');
  const request = require('supertest');
  const streamRoutes = require('../../src/routes/stream');

  const app = express();
  app.use(express.json());
  app.use('/stream', streamRoutes);

  beforeEach(() => {
    mockDbGet.mockReset();
    mockDbRun.mockReset().mockResolvedValue({ changes: 1 });
    mockDbAll.mockReset().mockResolvedValue([]);
    mockDbQuery.mockReset().mockResolvedValue([]);
    mockAuditLog.mockReset().mockResolvedValue(undefined);
  });

  test('updates amount only', async () => {
    mockDbGet
      .mockResolvedValueOnce({ id: 1, status: 'active', amount: 10, frequency: 'monthly' })
      .mockResolvedValueOnce({ id: 1, amount: 20, frequency: 'monthly', nextExecutionDate: '2024-02-01', status: 'active' });
    const res = await request(app).patch('/stream/schedules/1').send({ amount: 20 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('updates frequency only and recalculates nextExecutionDate', async () => {
    mockDbGet
      .mockResolvedValueOnce({ id: 1, status: 'active', amount: 10, frequency: 'monthly' })
      .mockResolvedValueOnce({ id: 1, amount: 10, frequency: 'weekly', nextExecutionDate: '2024-01-27', status: 'active' });
    const res = await request(app).patch('/stream/schedules/1').send({ frequency: 'weekly' });
    expect(res.status).toBe(200);
    const runCall = mockDbRun.mock.calls.find(c => c[0].includes('nextExecutionDate'));
    expect(runCall).toBeDefined();
  });

  test('updates both amount and frequency', async () => {
    mockDbGet
      .mockResolvedValueOnce({ id: 1, status: 'active', amount: 10, frequency: 'monthly' })
      .mockResolvedValueOnce({ id: 1, amount: 25, frequency: 'weekly', nextExecutionDate: '2024-01-27', status: 'active' });
    const res = await request(app).patch('/stream/schedules/1').send({ amount: 25, frequency: 'weekly' });
    expect(res.status).toBe(200);
  });

  test('rejects update on cancelled schedule with 409', async () => {
    mockDbGet.mockResolvedValueOnce({ id: 1, status: 'cancelled', amount: 10, frequency: 'monthly' });
    const res = await request(app).patch('/stream/schedules/1').send({ amount: 20 });
    expect(res.status).toBe(409);
  });

  test('returns 400 when no fields provided', async () => {
    const res = await request(app).patch('/stream/schedules/1').send({});
    expect(res.status).toBe(400);
  });

  test('creates audit log entry with SCHEDULE_UPDATED action', async () => {
    mockDbGet
      .mockResolvedValueOnce({ id: 1, status: 'active', amount: 10, frequency: 'monthly' })
      .mockResolvedValueOnce({ id: 1, amount: 15, frequency: 'monthly', nextExecutionDate: null, status: 'active' });
    await request(app).patch('/stream/schedules/1').send({ amount: 15 });
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'SCHEDULE_UPDATED',
    }));
  });
});
