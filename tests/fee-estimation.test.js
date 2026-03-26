/**
 * Fee Estimation Tests
 * Tests for estimateFee() on MockStellarService and the GET /donations/fee-estimate endpoint.
 */

// Mock broken modules that have duplicate declarations (pre-existing issue)
jest.mock('../src/models/apiKeys', () => ({
  initializeApiKeysTable: jest.fn().mockResolvedValue(undefined),
  createApiKey: jest.fn(),
  listApiKeys: jest.fn(),
  getApiKeyByValue: jest.fn(),
  rotateApiKey: jest.fn(),
  deprecateApiKey: jest.fn(),
  revokeApiKey: jest.fn(),
  revokeExpiredDeprecatedKeys: jest.fn().mockResolvedValue(0),
}));

jest.mock('../src/services/RecurringDonationScheduler', () => {
  return class MockScheduler {
    start() {}
    stop() {}
  };
});

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-key-1';

const request = require('supertest');
const express = require('express');
const MockStellarService = require('../src/services/MockStellarService');
const { checkPermission } = require('../src/middleware/rbac');
const { PERMISSIONS } = require('../src/utils/permissions');
const { attachUserRole } = require('../src/middleware/rbac');

// Build a minimal Express app wired to a given stellarService instance
function buildApp(stellarService) {
  const app = express();
  app.use(express.json());
  app.use(attachUserRole());

  app.get('/donations/fee-estimate', checkPermission(PERMISSIONS.DONATIONS_READ), async (req, res, next) => {
    try {
      const operationCount = Math.max(1, parseInt(req.query.operations, 10) || 1);
      const estimate = await stellarService.estimateFee(operationCount);
      res.json({
        success: true,
        data: {
          estimatedFee: estimate.feeStroops,
          estimatedFeeXLM: estimate.feeXLM,
          baseFee: estimate.baseFee,
          operationCount,
          surgeProtection: estimate.surgeProtection,
          surgeMultiplier: estimate.surgeMultiplier,
          ...(estimate.surgeProtection && {
            warning: 'Network fees are elevated (surge pricing active). Fees are significantly above baseline.'
          }),
        }
      });
    } catch (error) {
      next(error);
    }
  });

  app.use((err, req, res, next) => {
    void next;
    res.status(err.status || 500).json({ success: false, error: { message: err.message } });
  });

  return app;
}

// ── MockStellarService.estimateFee() ──────────────────────────────────────────

describe('MockStellarService.estimateFee()', () => {
  let service;

  beforeEach(() => {
    service = new MockStellarService();
  });

  it('returns normal fee estimate for 1 operation', async () => {
    const result = await service.estimateFee(1);

    expect(result.feeStroops).toBe(100);
    expect(result.feeXLM).toBe('0.0000100');
    expect(result.baseFee).toBe(100);
    expect(result.surgeProtection).toBe(false);
    expect(result.surgeMultiplier).toBe(1);
  });

  it('scales fee by operation count', async () => {
    const result = await service.estimateFee(3);

    expect(result.feeStroops).toBe(300);
    expect(result.feeXLM).toBe('0.0000300');
    expect(result.baseFee).toBe(100);
  });

  it('defaults to 1 operation when called with no args', async () => {
    const result = await service.estimateFee();
    expect(result.feeStroops).toBe(100);
  });

  it('detects surge when feeMultiplier >= 5', async () => {
    service.config.feeMultiplier = 5;
    const result = await service.estimateFee(1);

    expect(result.feeStroops).toBe(500);
    expect(result.surgeProtection).toBe(true);
    expect(result.surgeMultiplier).toBe(5);
  });

  it('detects surge at 10x multiplier', async () => {
    service.config.feeMultiplier = 10;
    const result = await service.estimateFee(1);

    expect(result.feeStroops).toBe(1000);
    expect(result.surgeProtection).toBe(true);
  });

  it('does not flag surge when feeMultiplier < 5', async () => {
    service.config.feeMultiplier = 4;
    const result = await service.estimateFee(1);

    expect(result.surgeProtection).toBe(false);
    expect(result.surgeMultiplier).toBe(4);
  });

  it('surge fee scales with operation count', async () => {
    service.config.feeMultiplier = 5;
    const result = await service.estimateFee(2);

    expect(result.feeStroops).toBe(1000); // 100 * 5 * 2
    expect(result.surgeProtection).toBe(true);
  });
});

// ── GET /donations/fee-estimate (HTTP endpoint) ───────────────────────────────

describe('GET /donations/fee-estimate', () => {
  let app;
  let stellarService;

  beforeEach(() => {
    stellarService = new MockStellarService();
    app = buildApp(stellarService);
  });

  it('returns 200 with fee estimate for 1 operation', async () => {
    const res = await request(app).get('/donations/fee-estimate');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      estimatedFee: 100,
      estimatedFeeXLM: '0.0000100',
      baseFee: 100,
      operationCount: 1,
      surgeProtection: false,
      surgeMultiplier: 1,
    });
    expect(res.body.data.warning).toBeUndefined();
  });

  it('respects ?operations query param', async () => {
    const res = await request(app).get('/donations/fee-estimate?operations=2');

    expect(res.status).toBe(200);
    expect(res.body.data.estimatedFee).toBe(200);
    expect(res.body.data.estimatedFeeXLM).toBe('0.0000200');
    expect(res.body.data.operationCount).toBe(2);
  });

  it('defaults to 1 operation for invalid ?operations value', async () => {
    const res = await request(app).get('/donations/fee-estimate?operations=abc');

    expect(res.status).toBe(200);
    expect(res.body.data.operationCount).toBe(1);
    expect(res.body.data.estimatedFee).toBe(100);
  });

  it('includes surge warning when fees are elevated (5x)', async () => {
    stellarService.config.feeMultiplier = 5;

    const res = await request(app).get('/donations/fee-estimate');

    expect(res.status).toBe(200);
    expect(res.body.data.surgeProtection).toBe(true);
    expect(res.body.data.warning).toMatch(/surge/i);
    expect(res.body.data.estimatedFee).toBe(500);
  });

  it('does not include warning under normal fees', async () => {
    const res = await request(app).get('/donations/fee-estimate');

    expect(res.status).toBe(200);
    expect(res.body.data.surgeProtection).toBe(false);
    expect(res.body.data.warning).toBeUndefined();
  });

  it('returns feeStroops and feeXLM in correct units', async () => {
    const res = await request(app).get('/donations/fee-estimate');

    const { estimatedFee, estimatedFeeXLM } = res.body.data;
    expect(parseFloat(estimatedFeeXLM)).toBeCloseTo(estimatedFee / 1e7, 7);
  });
});
