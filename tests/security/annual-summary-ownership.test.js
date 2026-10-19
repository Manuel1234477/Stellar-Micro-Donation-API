/**
 * Tests for annual tax summary ownership (Issue #1882)
 *
 * GET /donations/annual-summary must only return data for the wallet owned by
 * the authenticated principal. Admins may bypass with an audited permission.
 */

const request = require('supertest');
const express = require('express');

const OWNER_WALLET = 'GOWNERWALLETAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const OTHER_WALLET = 'GOTHERWALLETBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

// Stand-in auth: the x-test-user header carries a JSON principal
jest.mock('../../src/middleware/apiKey', () => (req, res, next) => {
  req.user = JSON.parse(req.headers['x-test-user'] || 'null');
  if (!req.user) {
    return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED' } });
  }
  next();
});

jest.mock('../../src/middleware/rbac', () => ({
  checkPermission: () => (req, res, next) => next(),
  attachUserRole: (req, res, next) => next(),
}));

jest.mock('../../src/services/TaxReceiptService', () => ({
  getAnnualSummaryData: jest.fn(async ({ walletAddress }) => ({ walletAddress, totalDonated: 100 })),
  generateAnnualSummaryPDF: jest.fn(async () => Buffer.from('%PDF-1.4')),
}));

jest.mock('../../src/services/AuditLogService', () => ({
  log: jest.fn(async () => {}),
  CATEGORY: { DATA_ACCESS: 'DATA_ACCESS', AUTHORIZATION: 'AUTHORIZATION' },
  ACTION: { DATA_EXPORTED: 'DATA_EXPORTED', ACCESS_DENIED: 'ACCESS_DENIED' },
  SEVERITY: { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH' },
}));

const TaxReceiptService = require('../../src/services/TaxReceiptService');
const AuditLogService = require('../../src/services/AuditLogService');

describe('Annual summary ownership (#1882)', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/donations', require('../../src/routes/receipt'));
  });

  const ownerPrincipal = { id: 'key-a', role: 'user', sub: OWNER_WALLET };
  const adminPrincipal = { id: 'key-admin', role: 'admin', sub: null };

  const fetchSummary = (principal, walletAddress) =>
    request(app)
      .get('/donations/annual-summary')
      .query({ walletAddress, year: 2025, format: 'json' })
      .set('x-test-user', JSON.stringify(principal));

  test('owner can fetch their own summary', async () => {
    const res = await fetchSummary(ownerPrincipal, OWNER_WALLET);

    expect(res.status).toBe(200);
    expect(TaxReceiptService.getAnnualSummaryData).toHaveBeenCalledTimes(1);
  });

  test('non-owner receives 403 and the summary is not generated', async () => {
    const res = await fetchSummary(ownerPrincipal, OTHER_WALLET);

    expect(res.status).toBe(403);
    expect(TaxReceiptService.getAnnualSummaryData).not.toHaveBeenCalled();
  });

  test('non-owner PDF request receives 403 and no PDF is generated', async () => {
    const res = await request(app)
      .get('/donations/annual-summary')
      .query({ walletAddress: OTHER_WALLET, year: 2025 })
      .set('x-test-user', JSON.stringify(ownerPrincipal));

    expect(res.status).toBe(403);
    expect(TaxReceiptService.generateAnnualSummaryPDF).not.toHaveBeenCalled();
  });

  test('admin can fetch another wallet and the access is audit-logged with the target wallet', async () => {
    const res = await fetchSummary(adminPrincipal, OTHER_WALLET);

    expect(res.status).toBe(200);
    expect(AuditLogService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: adminPrincipal.id,
        details: expect.objectContaining({ targetWallet: OTHER_WALLET }),
      })
    );
  });
});
