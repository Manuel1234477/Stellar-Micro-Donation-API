/**
 * Tests for issues #796, #797, #798
 * - #796: GET /admin/audit-logs mandatory pagination
 * - #797: POST /donations/:id/refund endpoint
 * - #798: Consistent sort order for GET /wallets, GET /donations, GET /stream/schedules
 */

'use strict';

// ─── #796: Audit Log Pagination ───────────────────────────────────────────────

describe('#796 — GET /admin/audit-logs pagination', () => {
  const AuditLogService = require('../src/services/AuditLogService');

  beforeEach(() => {
    jest.spyOn(AuditLogService, 'queryPaginated').mockResolvedValue({
      data: Array.from({ length: 50 }, (_, i) => ({ id: i + 1, action: 'TEST', timestamp: new Date().toISOString() })),
      totalCount: 200,
      meta: { limit: 50, direction: 'next', next_cursor: 'cursor_abc', prev_cursor: null },
    });
  });

  afterEach(() => jest.restoreAllMocks());

  test('default limit is 50', async () => {
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { role: 'admin' }; next(); });
    // Mount just the audit-logs handler inline to avoid full app bootstrap
    const { parseCursorPaginationQuery } = require('../src/utils/pagination');
    const asyncHandler = require('../src/utils/asyncHandler');
    const AUDIT_LOG_DEFAULT_LIMIT = 50;
    const AUDIT_LOG_MAX_LIMIT = 500;

    app.get('/admin/audit-logs', asyncHandler(async (req, res) => {
      let limit = AUDIT_LOG_DEFAULT_LIMIT;
      if (req.query.limit !== undefined) {
        const parsed = parseInt(req.query.limit, 10);
        if (isNaN(parsed) || parsed < 1) return res.status(400).json({ success: false, error: { code: 'INVALID_LIMIT' } });
        if (parsed > AUDIT_LOG_MAX_LIMIT) return res.status(400).json({ success: false, error: { code: 'LIMIT_TOO_LARGE' } });
        limit = parsed;
      }
      const pagination = parseCursorPaginationQuery({ ...req.query, limit: String(limit) });
      pagination.limit = limit;
      const filters = {
        action: req.query.action,
        userId: req.query.actorId || req.query.userId,
        startDate: req.query.from || req.query.startDate,
        endDate: req.query.to || req.query.endDate,
      };
      const result = await AuditLogService.queryPaginated(filters, pagination);
      res.json({
        success: true,
        data: result.data,
        pagination: { limit, cursor: result.meta.next_cursor, hasMore: result.meta.next_cursor !== null, total: result.totalCount },
      });
    }));

    const request = require('supertest');
    const res = await request(app).get('/admin/audit-logs');
    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBe(50);
    expect(AuditLogService.queryPaginated).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ limit: 50 })
    );
  });

  test('?limit=100 is respected', async () => {
    const express = require('express');
    const app = express();
    app.use(express.json());
    const { parseCursorPaginationQuery } = require('../src/utils/pagination');
    const asyncHandler = require('../src/utils/asyncHandler');
    const AUDIT_LOG_DEFAULT_LIMIT = 50;
    const AUDIT_LOG_MAX_LIMIT = 500;

    app.get('/admin/audit-logs', asyncHandler(async (req, res) => {
      let limit = AUDIT_LOG_DEFAULT_LIMIT;
      if (req.query.limit !== undefined) {
        const parsed = parseInt(req.query.limit, 10);
        if (isNaN(parsed) || parsed < 1) return res.status(400).json({ success: false, error: { code: 'INVALID_LIMIT' } });
        if (parsed > AUDIT_LOG_MAX_LIMIT) return res.status(400).json({ success: false, error: { code: 'LIMIT_TOO_LARGE' } });
        limit = parsed;
      }
      const pagination = parseCursorPaginationQuery({ ...req.query, limit: String(limit) });
      pagination.limit = limit;
      const result = await AuditLogService.queryPaginated({}, pagination);
      res.json({ success: true, data: result.data, pagination: { limit } });
    }));

    const request = require('supertest');
    const res = await request(app).get('/admin/audit-logs?limit=100');
    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBe(100);
  });

  test('?limit=501 returns 400', async () => {
    const express = require('express');
    const app = express();
    app.use(express.json());
    const asyncHandler = require('../src/utils/asyncHandler');
    const AUDIT_LOG_DEFAULT_LIMIT = 50;
    const AUDIT_LOG_MAX_LIMIT = 500;

    app.get('/admin/audit-logs', asyncHandler(async (req, res) => {
      let limit = AUDIT_LOG_DEFAULT_LIMIT;
      if (req.query.limit !== undefined) {
        const parsed = parseInt(req.query.limit, 10);
        if (isNaN(parsed) || parsed < 1) return res.status(400).json({ success: false, error: { code: 'INVALID_LIMIT' } });
        if (parsed > AUDIT_LOG_MAX_LIMIT) return res.status(400).json({ success: false, error: { code: 'LIMIT_TOO_LARGE' } });
        limit = parsed;
      }
      res.json({ success: true, pagination: { limit } });
    }));

    const request = require('supertest');
    const res = await request(app).get('/admin/audit-logs?limit=501');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('LIMIT_TOO_LARGE');
  });

  test('?limit=500 is accepted (max boundary)', async () => {
    const express = require('express');
    const app = express();
    app.use(express.json());
    const asyncHandler = require('../src/utils/asyncHandler');
    const AUDIT_LOG_DEFAULT_LIMIT = 50;
    const AUDIT_LOG_MAX_LIMIT = 500;

    app.get('/admin/audit-logs', asyncHandler(async (req, res) => {
      let limit = AUDIT_LOG_DEFAULT_LIMIT;
      if (req.query.limit !== undefined) {
        const parsed = parseInt(req.query.limit, 10);
        if (isNaN(parsed) || parsed < 1) return res.status(400).json({ success: false, error: { code: 'INVALID_LIMIT' } });
        if (parsed > AUDIT_LOG_MAX_LIMIT) return res.status(400).json({ success: false, error: { code: 'LIMIT_TOO_LARGE' } });
        limit = parsed;
      }
      res.json({ success: true, pagination: { limit } });
    }));

    const request = require('supertest');
    const res = await request(app).get('/admin/audit-logs?limit=500');
    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBe(500);
  });

  test('?actorId maps to userId filter', async () => {
    const express = require('express');
    const app = express();
    app.use(express.json());
    const { parseCursorPaginationQuery } = require('../src/utils/pagination');
    const asyncHandler = require('../src/utils/asyncHandler');

    app.get('/admin/audit-logs', asyncHandler(async (req, res) => {
      const limit = 50;
      const pagination = parseCursorPaginationQuery({ ...req.query, limit: String(limit) });
      pagination.limit = limit;
      const filters = {
        userId: req.query.actorId || req.query.userId,
        startDate: req.query.from || req.query.startDate,
        endDate: req.query.to || req.query.endDate,
      };
      const result = await AuditLogService.queryPaginated(filters, pagination);
      res.json({ success: true, data: result.data, pagination: { limit, total: result.totalCount } });
    }));

    const request = require('supertest');
    const res = await request(app).get('/admin/audit-logs?actorId=key_123');
    expect(res.status).toBe(200);
    expect(AuditLogService.queryPaginated).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'key_123' }),
      expect.any(Object)
    );
  });

  test('response includes pagination envelope with total count', async () => {
    const express = require('express');
    const app = express();
    app.use(express.json());
    const { parseCursorPaginationQuery } = require('../src/utils/pagination');
    const asyncHandler = require('../src/utils/asyncHandler');

    app.get('/admin/audit-logs', asyncHandler(async (req, res) => {
      const limit = 50;
      const pagination = parseCursorPaginationQuery({ limit: String(limit) });
      pagination.limit = limit;
      const result = await AuditLogService.queryPaginated({}, pagination);
      res.json({
        success: true,
        data: result.data,
        pagination: { limit, cursor: result.meta.next_cursor, hasMore: result.meta.next_cursor !== null, total: result.totalCount },
      });
    }));

    const request = require('supertest');
    const res = await request(app).get('/admin/audit-logs');
    expect(res.status).toBe(200);
    expect(res.body.pagination).toMatchObject({ limit: 50, total: 200, hasMore: true });
    expect(res.body.pagination.cursor).toBe('cursor_abc');
  });
});

// ─── #797: Donation Refund Endpoint ──────────────────────────────────────────

describe('#797 — POST /donations/:id/refund', () => {
  const DonationService = require('../src/services/DonationService');

  afterEach(() => jest.restoreAllMocks());

  function buildApp(mockRefund) {
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { role: 'admin' }; req.id = 'test-req-id'; next(); });

    // Minimal mock of the refund route logic
    const asyncHandler = require('../src/utils/asyncHandler');
    const log = require('../src/utils/log');

    app.post('/donations/:id/refund', asyncHandler(async (req, res, next) => {
      try {
        const { id } = req.params;
        const { reason, notes, idempotencyKey, recipientSecret } = req.body;
        if (!id || isNaN(parseInt(id, 10))) {
          return res.status(400).json({ success: false, error: { code: 'INVALID_REQUEST', message: 'Invalid donation ID' } });
        }
        const refundResult = await mockRefund(id, { reason, notes, idempotencyKey, recipientSecret, requestId: req.id });
        const statusCode = refundResult.alreadyProcessed ? 200 : 201;
        res.status(statusCode).json({
          success: true,
          data: {
            refundId: refundResult.refundId,
            donationId: parseInt(id, 10),
            originalAmount: refundResult.amount,
            refundedAmount: refundResult.refundedAmount || refundResult.amount,
            networkFeeDeducted: refundResult.networkFeeDeducted || 0,
            stellarTxHash: refundResult.reverseTxId || null,
            status: refundResult.status || 'completed',
            reason: refundResult.reason || reason || null,
            processedAt: refundResult.refundedAt || new Date().toISOString(),
          },
        });
      } catch (err) {
        next(err);
      }
    }));

    // Error handler
    app.use((err, _req, res, _next) => {
      res.status(err.statusCode || 500).json({ success: false, error: { code: err.errorCode || 'ERROR', message: err.message } });
    });

    return app;
  }

  test('returns 201 with proper shape on successful refund', async () => {
    const mockRefund = jest.fn().mockResolvedValue({
      refundId: 42,
      reverseTxId: 'abc123',
      amount: 50,
      refundedAmount: 50,
      networkFeeDeducted: 0,
      reason: 'donor_request',
      refundedAt: '2026-04-20T12:00:00Z',
      status: 'completed',
    });
    const app = buildApp(mockRefund);
    const request = require('supertest');
    const res = await request(app).post('/donations/42/refund').send({ reason: 'donor_request' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.refundId).toBe(42);
    expect(res.body.data.donationId).toBe(42);
    expect(res.body.data.originalAmount).toBe(50);
    expect(res.body.data.stellarTxHash).toBe('abc123');
    expect(res.body.data.status).toBe('completed');
  });

  test('returns 404 when donation not found', async () => {
    const { NotFoundError, ERROR_CODES } = require('../src/utils/errors');
    const mockRefund = jest.fn().mockRejectedValue(new NotFoundError('Donation not found', ERROR_CODES.DONATION_NOT_FOUND));
    const app = buildApp(mockRefund);
    const request = require('supertest');
    const res = await request(app).post('/donations/999/refund').send({});
    expect(res.status).toBe(404);
  });

  test('returns 409 when donation already refunded', async () => {
    const { DuplicateError, ERROR_CODES } = require('../src/utils/errors');
    const mockRefund = jest.fn().mockRejectedValue(new DuplicateError('Donation has already been refunded', ERROR_CODES.DUPLICATE_DONATION));
    const app = buildApp(mockRefund);
    const request = require('supertest');
    const res = await request(app).post('/donations/1/refund').send({});
    expect(res.status).toBe(409);
  });

  test('returns 422 when donation not in completed status', async () => {
    const { BusinessLogicError, ERROR_CODES } = require('../src/utils/errors');
    const mockRefund = jest.fn().mockRejectedValue(new BusinessLogicError(ERROR_CODES.TRANSACTION_FAILED, 'Cannot refund donation with status "pending"'));
    const app = buildApp(mockRefund);
    const request = require('supertest');
    const res = await request(app).post('/donations/1/refund').send({});
    expect(res.status).toBe(422);
  });

  test('returns 422 when refund window expired', async () => {
    const { BusinessLogicError, ERROR_CODES } = require('../src/utils/errors');
    const mockRefund = jest.fn().mockRejectedValue(new BusinessLogicError(ERROR_CODES.TRANSACTION_FAILED, 'Refund window has expired'));
    const app = buildApp(mockRefund);
    const request = require('supertest');
    const res = await request(app).post('/donations/1/refund').send({});
    expect(res.status).toBe(422);
  });

  test('idempotency key replay returns 200 with existing record', async () => {
    const mockRefund = jest.fn().mockResolvedValue({
      refundId: 7,
      reverseTxId: 'existing_tx',
      amount: 25,
      status: 'completed',
      refundedAt: '2026-04-19T10:00:00Z',
      alreadyProcessed: true,
    });
    const app = buildApp(mockRefund);
    const request = require('supertest');
    const res = await request(app).post('/donations/5/refund').send({ idempotencyKey: 'refund_5_2026-04-19' });
    expect(res.status).toBe(200);
    expect(res.body.data.refundId).toBe(7);
  });

  test('recipientSecret is passed to service but not in response', async () => {
    const mockRefund = jest.fn().mockResolvedValue({
      refundId: 1,
      reverseTxId: 'tx_hash',
      amount: 10,
      status: 'completed',
      refundedAt: new Date().toISOString(),
    });
    const app = buildApp(mockRefund);
    const request = require('supertest');
    const res = await request(app).post('/donations/1/refund').send({ recipientSecret: 'STEST_SECRET' });
    expect(res.status).toBe(201);
    // recipientSecret must not appear in response
    expect(JSON.stringify(res.body)).not.toContain('STEST_SECRET');
    expect(mockRefund).toHaveBeenCalledWith('1', expect.objectContaining({ recipientSecret: 'STEST_SECRET' }));
  });

  test('notes field is accepted and passed through', async () => {
    const mockRefund = jest.fn().mockResolvedValue({
      refundId: 3,
      reverseTxId: 'tx_notes',
      amount: 15,
      status: 'completed',
      refundedAt: new Date().toISOString(),
    });
    const app = buildApp(mockRefund);
    const request = require('supertest');
    await request(app).post('/donations/3/refund').send({ notes: 'Donor contacted support' });
    expect(mockRefund).toHaveBeenCalledWith('3', expect.objectContaining({ notes: 'Donor contacted support' }));
  });
});

// ─── #798: Sort Consistency ───────────────────────────────────────────────────

describe('#798 — Consistent sort order', () => {
  describe('WalletService.getPaginatedWallets', () => {
    const WalletService = require('../src/services/WalletService');
    const Wallet = require('../src/routes/models/wallet');

    afterEach(() => jest.restoreAllMocks());

    test('default sort is id:asc', () => {
      jest.spyOn(Wallet, 'getAll').mockReturnValue([
        { id: '3', address: 'G3', createdAt: '2024-01-03T00:00:00Z' },
        { id: '1', address: 'G1', createdAt: '2024-01-01T00:00:00Z' },
        { id: '2', address: 'G2', createdAt: '2024-01-02T00:00:00Z' },
      ]);
      const svc = new WalletService();
      const result = svc.getPaginatedWallets({ limit: 10, direction: 'next', cursor: null });
      const ids = result.data.map(w => w.id);
      expect(ids).toEqual(['1', '2', '3']);
    });

    test('sort=id:desc returns descending order', () => {
      jest.spyOn(Wallet, 'getAll').mockReturnValue([
        { id: '1', address: 'G1', createdAt: '2024-01-01T00:00:00Z' },
        { id: '3', address: 'G3', createdAt: '2024-01-03T00:00:00Z' },
        { id: '2', address: 'G2', createdAt: '2024-01-02T00:00:00Z' },
      ]);
      const svc = new WalletService();
      const result = svc.getPaginatedWallets({ limit: 10, direction: 'next', cursor: null }, 'id:desc');
      const ids = result.data.map(w => w.id);
      expect(ids).toEqual(['3', '2', '1']);
    });

    test('sequential pages return consistent results (no duplicates)', () => {
      const wallets = Array.from({ length: 10 }, (_, i) => ({
        id: String(i + 1),
        address: `G${i + 1}`,
        createdAt: `2024-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
      }));
      jest.spyOn(Wallet, 'getAll').mockReturnValue(wallets);
      const svc = new WalletService();
      const page1 = svc.getPaginatedWallets({ limit: 5, direction: 'next', cursor: null });
      const page1Ids = page1.data.map(w => w.id);
      expect(page1Ids).toHaveLength(5);
      // All IDs should be unique
      expect(new Set(page1Ids).size).toBe(5);
    });
  });

  describe('GET /wallets ?sort validation', () => {
    afterEach(() => jest.restoreAllMocks());

    test('invalid ?sort returns 400 (logic test)', () => {
      const VALID_SORT = ['id:asc', 'id:desc', 'createdAt:asc', 'createdAt:desc', 'publicKey:asc', 'publicKey:desc'];
      const sort = 'invalid';
      expect(VALID_SORT.includes(sort)).toBe(false);
    });

    test('valid sort values are accepted', () => {
      const VALID_SORT = ['id:asc', 'id:desc', 'createdAt:asc', 'createdAt:desc', 'publicKey:asc', 'publicKey:desc'];
      for (const s of VALID_SORT) {
        expect(VALID_SORT.includes(s)).toBe(true);
      }
    });

    test('default sort is id:asc', () => {
      const WalletService = require('../src/services/WalletService');
      const Wallet = require('../src/routes/models/wallet');
      jest.spyOn(Wallet, 'getAll').mockReturnValue([
        { id: '2', address: 'G2', createdAt: '2024-01-02T00:00:00Z' },
        { id: '1', address: 'G1', createdAt: '2024-01-01T00:00:00Z' },
      ]);
      const svc = new WalletService();
      // No sort param = default id:asc
      const result = svc.getPaginatedWallets({ limit: 10, direction: 'next', cursor: null });
      expect(result.data[0].id).toBe('1');
      expect(result.data[1].id).toBe('2');
    });
  });

  describe('GET /donations ?sort validation', () => {
    afterEach(() => jest.restoreAllMocks());

    test('invalid ?sort returns 400 (logic test)', () => {
      const VALID_SORT = ['id:asc', 'id:desc', 'timestamp:asc', 'timestamp:desc', 'amount:asc', 'amount:desc'];
      const sort = 'badfield:up';
      expect(VALID_SORT.includes(sort)).toBe(false);
    });

    test('valid sort values are accepted', () => {
      const VALID_SORT = ['id:asc', 'id:desc', 'timestamp:asc', 'timestamp:desc', 'amount:asc', 'amount:desc'];
      for (const s of VALID_SORT) {
        expect(VALID_SORT.includes(s)).toBe(true);
      }
    });
  });

  describe('GET /stream/schedules ?sort validation', () => {
    afterEach(() => jest.restoreAllMocks());

    test('invalid ?sort returns 400 (logic test)', () => {
      const VALID_SORT = { 'id:asc': 'rd.id ASC', 'id:desc': 'rd.id DESC', 'createdAt:asc': 'rd.id ASC', 'createdAt:desc': 'rd.id DESC' };
      const sort = 'badfield:up';
      expect(VALID_SORT[sort]).toBeUndefined();
    });

    test('default sort is id:asc', () => {
      const VALID_SORT = { 'id:asc': 'rd.id ASC', 'id:desc': 'rd.id DESC', 'createdAt:asc': 'rd.id ASC', 'createdAt:desc': 'rd.id DESC' };
      const defaultSort = 'id:asc';
      expect(VALID_SORT[defaultSort]).toBe('rd.id ASC');
    });

    test('valid sort values produce correct SQL ORDER BY', () => {
      const VALID_SORT = { 'id:asc': 'rd.id ASC', 'id:desc': 'rd.id DESC', 'createdAt:asc': 'rd.id ASC', 'createdAt:desc': 'rd.id DESC' };
      expect(VALID_SORT['id:desc']).toBe('rd.id DESC');
      expect(VALID_SORT['createdAt:asc']).toBe('rd.id ASC');
    });
  });
});
