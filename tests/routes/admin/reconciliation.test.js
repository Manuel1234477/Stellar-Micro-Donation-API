'use strict';

/**
 * Tests for the admin reconciliation job endpoint.
 *
 * Extracted from the legacy bundle `tests/issues-65-66-67-68.test.js`
 * (issue #67) and renamed to follow the module-based test naming
 * convention (docs/TEST_NAMING_CONVENTION.md).
 */

const request = require('supertest');

// Mock the reconciliation service before requiring the app so the route
// picks up the mocked implementation.
jest.mock('../../../src/services/ReconciliationService', () => ({
  runReconciliation: jest.fn(),
  getReconciliationStatus: jest.fn(),
}));

const ReconciliationService = require('../../../src/services/ReconciliationService');

describe('Admin reconciliation job endpoint (issue #67)', () => {
  let app;

  beforeAll(() => {
    app = require('../../../src/app');
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /admin/reconciliation/run', () => {
    it('runs the reconciliation job and returns a summary', async () => {
      const summary = {
        processed: 12,
        matched: 10,
        mismatched: 2,
        startedAt: '2024-01-01T00:00:00.000Z',
        finishedAt: '2024-01-01T00:00:05.000Z',
      };
      ReconciliationService.runReconciliation.mockResolvedValue(summary);

      const res = await request(app)
        .post('/admin/reconciliation/run')
        .set('x-admin-key', process.env.ADMIN_API_KEY || 'test-admin-key')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body).toEqual(expect.objectContaining({ summary }));
      expect(ReconciliationService.runReconciliation).toHaveBeenCalledTimes(1);
    });

    it('returns 500 when the reconciliation job fails', async () => {
      ReconciliationService.runReconciliation.mockRejectedValue(
        new Error('reconciliation failed')
      );

      const res = await request(app)
        .post('/admin/reconciliation/run')
        .set('x-admin-key', process.env.ADMIN_API_KEY || 'test-admin-key')
        .send({});

      expect(res.status).toBe(500);
      expect(res.body).toEqual(
        expect.objectContaining({ error: expect.any(String) })
      );
    });

    it('rejects requests without admin credentials', async () => {
      const res = await request(app)
        .post('/admin/reconciliation/run')
        .send({});

      expect(res.status).toBe(401);
      expect(ReconciliationService.runReconciliation).not.toHaveBeenCalled();
    });
  });

  describe('GET /admin/reconciliation/status', () => {
    it('returns the current reconciliation status', async () => {
      const status = {
        running: false,
        lastRunAt: '2024-01-01T00:00:05.000Z',
        lastResult: 'success',
      };
      ReconciliationService.getReconciliationStatus.mockResolvedValue(status);

      const res = await request(app)
        .get('/admin/reconciliation/status')
        .set('x-admin-key', process.env.ADMIN_API_KEY || 'test-admin-key');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(expect.objectContaining({ status }));
      expect(ReconciliationService.getReconciliationStatus).toHaveBeenCalledTimes(1);
    });

    it('returns 500 when status lookup fails', async () => {
      ReconciliationService.getReconciliationStatus.mockRejectedValue(
        new Error('status unavailable')
      );

      const res = await request(app)
        .get('/admin/reconciliation/status')
        .set('x-admin-key', process.env.ADMIN_API_KEY || 'test-admin-key');

      expect(res.status).toBe(500);
      expect(res.body).toEqual(
        expect.objectContaining({ error: expect.any(String) })
      );
    });
  });
});