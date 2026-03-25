const Transaction = require('../src/routes/models/transaction');
const path = require('path');

describe('Transaction Model Fee Bump Fields', () => {
  const TEST_DB = path.join(__dirname, '../data/test-fee-bump-model.json');

  beforeEach(() => {
    process.env.DB_JSON_PATH = TEST_DB;
    Transaction._clearAllData();
  });

  afterAll(() => {
    delete process.env.DB_JSON_PATH;
    const fs = require('fs');
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  test('create() stores fee bump fields', () => {
    const tx = Transaction.create({
      amount: 10,
      donor: 'GDONOR',
      recipient: 'GRECIP',
      status: 'pending',
      envelopeXdr: 'AAAA==',
      feeBumpCount: 0,
      originalFee: 100,
      currentFee: 100,
    });

    expect(tx.envelopeXdr).toBe('AAAA==');
    expect(tx.feeBumpCount).toBe(0);
    expect(tx.originalFee).toBe(100);
    expect(tx.currentFee).toBe(100);
    expect(tx.lastFeeBumpAt).toBeNull();
  });

  test('updateFeeBumpData() updates fee bump metadata', () => {
    const tx = Transaction.create({
      amount: 10,
      donor: 'GDONOR',
      recipient: 'GRECIP',
      status: 'submitted',
      envelopeXdr: 'AAAA==',
      feeBumpCount: 0,
      originalFee: 100,
      currentFee: 100,
    });

    const updated = Transaction.updateFeeBumpData(tx.id, {
      feeBumpCount: 1,
      currentFee: 200,
      lastFeeBumpAt: '2026-03-25T00:00:00.000Z',
      envelopeXdr: 'BBBB==',
      stellarTxId: 'new_hash_123',
    });

    expect(updated.feeBumpCount).toBe(1);
    expect(updated.currentFee).toBe(200);
    expect(updated.lastFeeBumpAt).toBe('2026-03-25T00:00:00.000Z');
    expect(updated.envelopeXdr).toBe('BBBB==');
    expect(updated.stellarTxId).toBe('new_hash_123');
  });
});

describe('StellarService.buildAndSubmitFeeBumpTransaction()', () => {
  test('method exists and is not the base interface stub', () => {
    const StellarService = require('../src/services/StellarService');
    const StellarServiceInterface = require('../src/services/interfaces/StellarServiceInterface');
    const service = new StellarService({ network: 'testnet' });
    const baseInterface = new StellarServiceInterface();

    expect(typeof service.buildAndSubmitFeeBumpTransaction).toBe('function');
    expect(service.buildAndSubmitFeeBumpTransaction).not.toBe(
      baseInterface.buildAndSubmitFeeBumpTransaction
    );
  });
});

describe('MockStellarService.buildAndSubmitFeeBumpTransaction()', () => {
  const MockStellarService = require('../src/services/MockStellarService');
  let mockService;

  beforeEach(() => {
    mockService = new MockStellarService({ network: 'testnet' });
  });

  test('returns hash, ledger, fee, and envelopeXdr on success', async () => {
    const result = await mockService.buildAndSubmitFeeBumpTransaction(
      'mock_envelope_xdr_base64',
      200,
      'SCZANGBA5YHTNYVVV3C7CAZMCLXPILHSE6PGYAY7URFI5NUFQMK3Q7OV'
    );

    expect(result).toHaveProperty('hash');
    expect(result).toHaveProperty('ledger');
    expect(result.fee).toBe(200);
    expect(result).toHaveProperty('envelopeXdr');
    expect(result.hash).toMatch(/^mock_/);
  });

  test('simulates fee_bump_failure when enabled', async () => {
    mockService.enableFailureSimulation('fee_bump_failure', 1.0);

    await expect(
      mockService.buildAndSubmitFeeBumpTransaction('xdr', 200, 'SCZANGBA5YHTNYVVV3C7CAZMCLXPILHSE6PGYAY7URFI5NUFQMK3Q7OV')
    ).rejects.toThrow(/fee bump/i);
  });
});

describe('FeeBumpService', () => {
  const FeeBumpService = require('../src/services/FeeBumpService');
  const Transaction = require('../src/routes/models/transaction');
  const path = require('path');
  const fs = require('fs');

  const TEST_DB = path.join(__dirname, '../data/test-fee-bump-service.json');
  let feeBumpService;
  let mockStellarService;
  let mockAuditLog;

  beforeEach(() => {
    process.env.DB_JSON_PATH = TEST_DB;
    Transaction._clearAllData();

    mockStellarService = {
      estimateFee: jest.fn().mockResolvedValue({ feeStroops: 200, surgeMultiplier: 1 }),
      buildAndSubmitFeeBumpTransaction: jest.fn().mockResolvedValue({
        hash: 'new_hash_123',
        ledger: 999,
        fee: 200,
        envelopeXdr: 'new_envelope_xdr',
      }),
    };

    mockAuditLog = {
      log: jest.fn().mockResolvedValue(undefined),
      CATEGORY: { ADMIN: 'ADMIN' },
      ACTION: { FEE_BUMP_APPLIED: 'FEE_BUMP_APPLIED', FEE_BUMP_FAILED: 'FEE_BUMP_FAILED' },
      SEVERITY: { MEDIUM: 'MEDIUM', HIGH: 'HIGH' },
    };

    feeBumpService = new FeeBumpService(mockStellarService, mockAuditLog);
  });

  afterAll(() => {
    delete process.env.DB_JSON_PATH;
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  describe('feeBump()', () => {
    test('successfully bumps fee with auto-calculated fee', async () => {
      const tx = Transaction.create({
        amount: 10, donor: 'GDONOR', recipient: 'GRECIP',
        status: 'submitted', envelopeXdr: 'original_xdr',
        feeBumpCount: 0, originalFee: 100, currentFee: 100,
      });

      const result = await feeBumpService.feeBump(tx.id);

      expect(result.success).toBe(true);
      expect(result.newFee).toBe(200);
      expect(result.feeBumpCount).toBe(1);
      expect(mockStellarService.estimateFee).toHaveBeenCalled();
      expect(mockStellarService.buildAndSubmitFeeBumpTransaction).toHaveBeenCalledWith(
        'original_xdr', 200, null
      );
    });

    test('successfully bumps fee with manual fee', async () => {
      const tx = Transaction.create({
        amount: 10, donor: 'GDONOR', recipient: 'GRECIP',
        status: 'submitted', envelopeXdr: 'original_xdr',
        feeBumpCount: 0, originalFee: 100, currentFee: 100,
      });

      const result = await feeBumpService.feeBump(tx.id, 500);

      expect(result.success).toBe(true);
      expect(result.newFee).toBe(500);
      expect(mockStellarService.estimateFee).not.toHaveBeenCalled();
    });

    test('rejects when transaction not found', async () => {
      await expect(feeBumpService.feeBump('nonexistent'))
        .rejects.toThrow(/not found/i);
    });

    test('rejects when transaction not in submitted state', async () => {
      const tx = Transaction.create({
        amount: 10, donor: 'GDONOR', recipient: 'GRECIP',
        status: 'pending', envelopeXdr: 'xdr',
        feeBumpCount: 0, originalFee: 100, currentFee: 100,
      });

      await expect(feeBumpService.feeBump(tx.id))
        .rejects.toThrow(/submitted/i);
    });

    test('rejects when no envelope XDR stored', async () => {
      const tx = Transaction.create({
        amount: 10, donor: 'GDONOR', recipient: 'GRECIP',
        status: 'submitted', feeBumpCount: 0,
      });

      await expect(feeBumpService.feeBump(tx.id))
        .rejects.toThrow(/envelope/i);
    });

    test('rejects when max attempts reached', async () => {
      const tx = Transaction.create({
        amount: 10, donor: 'GDONOR', recipient: 'GRECIP',
        status: 'submitted', envelopeXdr: 'xdr',
        feeBumpCount: 3, originalFee: 100, currentFee: 500,
      });

      await expect(feeBumpService.feeBump(tx.id))
        .rejects.toThrow(/maximum/i);
    });

    test('rejects when fee exceeds cap', async () => {
      const tx = Transaction.create({
        amount: 10, donor: 'GDONOR', recipient: 'GRECIP',
        status: 'submitted', envelopeXdr: 'xdr',
        feeBumpCount: 0, originalFee: 100, currentFee: 100,
      });

      await expect(feeBumpService.feeBump(tx.id, 2000000))
        .rejects.toThrow(/cap/i);
    });

    test('logs fee bump via audit service', async () => {
      const tx = Transaction.create({
        amount: 10, donor: 'GDONOR', recipient: 'GRECIP',
        status: 'submitted', envelopeXdr: 'xdr',
        feeBumpCount: 0, originalFee: 100, currentFee: 100,
      });

      await feeBumpService.feeBump(tx.id);

      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'FEE_BUMP_APPLIED',
          details: expect.objectContaining({
            transactionId: tx.id,
            originalFee: 100,
            newFee: 200,
          }),
        })
      );
    });

    test('wraps Stellar network errors as FEE_BUMP_FAILED', async () => {
      const tx = Transaction.create({
        amount: 10, donor: 'GDONOR', recipient: 'GRECIP',
        status: 'submitted', envelopeXdr: 'xdr',
        feeBumpCount: 0, originalFee: 100, currentFee: 100,
      });

      mockStellarService.buildAndSubmitFeeBumpTransaction
        .mockRejectedValueOnce(new Error('Horizon timeout'));

      await expect(feeBumpService.feeBump(tx.id))
        .rejects.toThrow(/fee bump failed/i);

      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'FEE_BUMP_FAILED' })
      );
    });

    test('handles estimateFee rejection during auto-fee calculation', async () => {
      const tx = Transaction.create({
        amount: 10, donor: 'GDONOR', recipient: 'GRECIP',
        status: 'submitted', envelopeXdr: 'xdr',
        feeBumpCount: 0, originalFee: 100, currentFee: 100,
      });

      mockStellarService.estimateFee.mockRejectedValueOnce(new Error('Horizon unavailable'));

      await expect(feeBumpService.feeBump(tx.id))
        .rejects.toThrow(/fee bump failed/i);
    });
  });

  describe('detectStuckTransactions()', () => {
    test('detects transactions stuck longer than threshold', () => {
      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      Transaction.create({
        amount: 10, donor: 'GDONOR', recipient: 'GRECIP',
        status: 'submitted', envelopeXdr: 'xdr',
        feeBumpCount: 0, originalFee: 100, currentFee: 100,
        statusUpdatedAt: sixMinutesAgo,
      });

      const stuck = feeBumpService.detectStuckTransactions();
      expect(stuck).toHaveLength(1);
    });

    test('ignores recently submitted transactions', () => {
      Transaction.create({
        amount: 10, donor: 'GDONOR', recipient: 'GRECIP',
        status: 'submitted', envelopeXdr: 'xdr',
        feeBumpCount: 0, originalFee: 100, currentFee: 100,
        statusUpdatedAt: new Date().toISOString(),
      });

      const stuck = feeBumpService.detectStuckTransactions();
      expect(stuck).toHaveLength(0);
    });

    test('ignores transactions at max attempts', () => {
      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      Transaction.create({
        amount: 10, donor: 'GDONOR', recipient: 'GRECIP',
        status: 'submitted', envelopeXdr: 'xdr',
        feeBumpCount: 3, originalFee: 100, currentFee: 500,
        statusUpdatedAt: sixMinutesAgo,
      });

      const stuck = feeBumpService.detectStuckTransactions();
      expect(stuck).toHaveLength(0);
    });

    test('ignores non-submitted transactions', () => {
      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      Transaction.create({
        amount: 10, donor: 'GDONOR', recipient: 'GRECIP',
        status: 'pending', envelopeXdr: 'xdr',
        feeBumpCount: 0, originalFee: 100, currentFee: 100,
        statusUpdatedAt: sixMinutesAgo,
      });

      const stuck = feeBumpService.detectStuckTransactions();
      expect(stuck).toHaveLength(0);
    });
  });

  describe('processStuckTransactions()', () => {
    test('processes all stuck transactions', async () => {
      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      Transaction.create({
        amount: 10, donor: 'GDONOR1', recipient: 'GRECIP',
        status: 'submitted', envelopeXdr: 'xdr1',
        feeBumpCount: 0, originalFee: 100, currentFee: 100,
        statusUpdatedAt: sixMinutesAgo,
      });
      Transaction.create({
        amount: 20, donor: 'GDONOR2', recipient: 'GRECIP',
        status: 'submitted', envelopeXdr: 'xdr2',
        feeBumpCount: 0, originalFee: 100, currentFee: 100,
        statusUpdatedAt: sixMinutesAgo,
      });

      const result = await feeBumpService.processStuckTransactions();

      expect(result.processed).toBe(2);
      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(0);
    });

    test('returns zeros when no stuck transactions', async () => {
      const result = await feeBumpService.processStuckTransactions();
      expect(result).toEqual({ processed: 0, succeeded: 0, failed: 0, skipped: 0 });
    });

    test('skips transactions without envelope XDR', async () => {
      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      Transaction.create({
        amount: 10, donor: 'GDONOR', recipient: 'GRECIP',
        status: 'submitted',
        feeBumpCount: 0, originalFee: 100, currentFee: 100,
        statusUpdatedAt: sixMinutesAgo,
      });

      const result = await feeBumpService.processStuckTransactions();
      expect(result.skipped).toBe(1);
      expect(result.succeeded).toBe(0);
    });

    test('continues processing after individual failures', async () => {
      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      Transaction.create({
        amount: 10, donor: 'GDONOR1', recipient: 'GRECIP',
        status: 'submitted', envelopeXdr: 'xdr1',
        feeBumpCount: 0, originalFee: 100, currentFee: 100,
        statusUpdatedAt: sixMinutesAgo,
      });
      Transaction.create({
        amount: 20, donor: 'GDONOR2', recipient: 'GRECIP',
        status: 'submitted', envelopeXdr: 'xdr2',
        feeBumpCount: 0, originalFee: 100, currentFee: 100,
        statusUpdatedAt: sixMinutesAgo,
      });

      // First call succeeds, second fails
      mockStellarService.buildAndSubmitFeeBumpTransaction
        .mockResolvedValueOnce({ hash: 'h1', ledger: 1, fee: 200, envelopeXdr: 'e1' })
        .mockRejectedValueOnce(new Error('network error'));

      const result = await feeBumpService.processStuckTransactions();
      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(1);
    });
  });
});

describe('POST /admin/transactions/:id/fee-bump', () => {
  const express = require('express');
  const request = require('supertest');
  const Transaction = require('../src/routes/models/transaction');
  const path = require('path');
  const fs = require('fs');

  const TEST_DB = path.join(__dirname, '../data/test-fee-bump-admin.json');
  let app;
  let mockStellarService;
  let mockAuditLog;

  beforeEach(() => {
    process.env.DB_JSON_PATH = TEST_DB;
    Transaction._clearAllData();

    mockStellarService = {
      estimateFee: jest.fn().mockResolvedValue({ feeStroops: 200, surgeMultiplier: 1 }),
      buildAndSubmitFeeBumpTransaction: jest.fn().mockResolvedValue({
        hash: 'bump_hash_123', ledger: 999, fee: 200, envelopeXdr: 'bumped_xdr',
      }),
    };

    mockAuditLog = {
      log: jest.fn().mockResolvedValue(undefined),
      CATEGORY: { ADMIN: 'ADMIN' },
      ACTION: { FEE_BUMP_APPLIED: 'FEE_BUMP_APPLIED', FEE_BUMP_FAILED: 'FEE_BUMP_FAILED' },
      SEVERITY: { MEDIUM: 'MEDIUM', HIGH: 'HIGH' },
    };

    const FeeBumpService = require('../src/services/FeeBumpService');
    const feeBumpService = new FeeBumpService(mockStellarService, mockAuditLog);

    const feeBumpRouter = require('../src/routes/admin/feeBump');

    app = express();
    app.use(express.json());
    // Simulate admin auth — attach user and skip RBAC for test
    app.use((req, res, next) => {
      req.user = { id: 'admin-1', role: 'admin' };
      req.apiKey = { id: 'key-1' };
      req.id = 'req-1';
      next();
    });
    app.use('/admin/transactions', feeBumpRouter(feeBumpService));
    // Error handler must be registered to map AppError.statusCode to HTTP responses
    const { errorHandler } = require('../src/middleware/errorHandler');
    app.use(errorHandler);
  });

  afterAll(() => {
    delete process.env.DB_JSON_PATH;
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  test('successfully bumps fee with auto fee', async () => {
    const tx = Transaction.create({
      amount: 10, donor: 'GDONOR', recipient: 'GRECIP',
      status: 'submitted', envelopeXdr: 'xdr',
      feeBumpCount: 0, originalFee: 100, currentFee: 100,
    });

    const res = await request(app)
      .post(`/admin/transactions/${tx.id}/fee-bump`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.newFee).toBe(200);
    expect(res.body.data.hash).toBe('bump_hash_123');
  });

  test('successfully bumps fee with manual fee', async () => {
    const tx = Transaction.create({
      amount: 10, donor: 'GDONOR', recipient: 'GRECIP',
      status: 'submitted', envelopeXdr: 'xdr',
      feeBumpCount: 0, originalFee: 100, currentFee: 100,
    });

    const res = await request(app)
      .post(`/admin/transactions/${tx.id}/fee-bump`)
      .send({ fee: 500 });

    expect(res.status).toBe(200);
    expect(res.body.data.newFee).toBe(500);
  });

  test('returns 404 for nonexistent transaction', async () => {
    const res = await request(app)
      .post('/admin/transactions/nonexistent/fee-bump')
      .send({});

    expect(res.status).toBe(404);
  });

  test('returns 422 for non-submitted transaction', async () => {
    const tx = Transaction.create({
      amount: 10, donor: 'GDONOR', recipient: 'GRECIP',
      status: 'pending', envelopeXdr: 'xdr',
    });

    const res = await request(app)
      .post(`/admin/transactions/${tx.id}/fee-bump`)
      .send({});

    expect(res.status).toBe(422);
  });

  test('returns 422 when fee exceeds cap', async () => {
    const tx = Transaction.create({
      amount: 10, donor: 'GDONOR', recipient: 'GRECIP',
      status: 'submitted', envelopeXdr: 'xdr',
      feeBumpCount: 0, originalFee: 100, currentFee: 100,
    });

    const res = await request(app)
      .post(`/admin/transactions/${tx.id}/fee-bump`)
      .send({ fee: 2000000 });

    expect(res.status).toBe(422);
  });
});
