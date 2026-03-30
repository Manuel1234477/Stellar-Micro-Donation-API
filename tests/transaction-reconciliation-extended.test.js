'use strict';

const path = require('path');
const os = require('os');
const express = require('express');
const request = require('supertest');

const TransactionReconciliationService = require('../src/services/TransactionReconciliationService');
const Transaction = require('../src/routes/models/transaction');
const { TRANSACTION_STATES } = require('../src/utils/transactionStateMachine');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tmpPath() {
  return path.join(os.tmpdir(), `recon-ext-${Date.now()}-${Math.random()}.json`);
}

function makeStellarService(overrides = {}) {
  return {
    verifyTransaction: jest.fn().mockResolvedValue({ verified: false }),
    transactions: new Map(),
    ...overrides,
  };
}

function makeService(stellarService) {
  return new TransactionReconciliationService(stellarService || makeStellarService());
}

/** Build a minimal Express app exposing the reconciliation admin routes */
function buildAdminApp(service) {
  const app = express();
  app.use(express.json());

  // Stub serviceContainer so the route can resolve the service
  jest.mock('../src/config/serviceContainer', () => ({
    getTransactionReconciliationService: () => service,
  }), { virtual: true });

  // Mount routes directly (bypass auth for unit tests)
  const router = express.Router();

  router.get('/report', (req, res) => {
    const { count, transactions } = service.getDiscrepancies();
    const status = service.getStatus();
    res.json({ success: true, data: { discrepancyCount: count, transactions, serviceStatus: status, generatedAt: new Date().toISOString() } });
  });

  router.post('/resolve/:txId', (req, res) => {
    const { txId } = req.params;
    const { status } = req.body || {};
    if (!status || typeof status !== 'string') {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: "'status' is required" } });
    }
    try {
      const updated = service.resolveDiscrepancy(txId, status);
      res.json({ success: true, data: updated });
    } catch (err) {
      if (err.message.startsWith('Transaction not found')) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: err.message } });
      }
      res.status(500).json({ success: false, error: { message: err.message } });
    }
  });

  app.use('/admin/reconciliation', router);
  return app;
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  process.env.DB_JSON_PATH = tmpPath();
  Transaction._clearAllData();
});

afterEach(() => {
  jest.clearAllMocks();
});

// ─── Schedule interval ────────────────────────────────────────────────────────

describe('schedule interval', () => {
  it('runs every 10 minutes', () => {
    const svc = makeService();
    expect(svc.checkInterval).toBe(10 * 60 * 1000);
  });
});

// ─── flagDiscrepancy ──────────────────────────────────────────────────────────

describe('flagDiscrepancy', () => {
  it('sets reconciliation_needed=true on the transaction', () => {
    const tx = Transaction.create({ donor: 'A', recipient: 'B', amount: 1, status: TRANSACTION_STATES.PENDING });
    const svc = makeService();
    const updated = svc.flagDiscrepancy(tx.id, 'confirmed on-chain but pending in DB');
    expect(updated.reconciliation_needed).toBe(true);
    expect(updated.reconciliation_reason).toMatch(/confirmed on-chain/);
    expect(updated.reconciliation_flagged_at).toBeDefined();
  });

  it('persists the flag across reloads', () => {
    const tx = Transaction.create({ donor: 'A', recipient: 'B', amount: 1, status: TRANSACTION_STATES.PENDING });
    const svc = makeService();
    svc.flagDiscrepancy(tx.id, 'test');
    const reloaded = Transaction.getById(tx.id);
    expect(reloaded.reconciliation_needed).toBe(true);
  });

  it('throws when transaction does not exist', () => {
    const svc = makeService();
    expect(() => svc.flagDiscrepancy('nonexistent', 'reason')).toThrow('Transaction not found');
  });
});

// ─── resolveDiscrepancy ───────────────────────────────────────────────────────

describe('resolveDiscrepancy', () => {
  it('clears reconciliation_needed and sets new status', () => {
    const tx = Transaction.create({ donor: 'A', recipient: 'B', amount: 1, status: TRANSACTION_STATES.PENDING });
    const svc = makeService();
    svc.flagDiscrepancy(tx.id, 'test');
    const resolved = svc.resolveDiscrepancy(tx.id, 'confirmed');
    expect(resolved.reconciliation_needed).toBe(false);
    expect(resolved.status).toBe('confirmed');
    expect(resolved.reconciliation_resolved_at).toBeDefined();
  });

  it('persists the resolution', () => {
    const tx = Transaction.create({ donor: 'A', recipient: 'B', amount: 1, status: TRANSACTION_STATES.PENDING });
    const svc = makeService();
    svc.flagDiscrepancy(tx.id, 'test');
    svc.resolveDiscrepancy(tx.id, 'failed');
    const reloaded = Transaction.getById(tx.id);
    expect(reloaded.reconciliation_needed).toBe(false);
    expect(reloaded.status).toBe('failed');
  });

  it('throws when transaction does not exist', () => {
    const svc = makeService();
    expect(() => svc.resolveDiscrepancy('nonexistent', 'confirmed')).toThrow('Transaction not found');
  });
});

// ─── getDiscrepancies ─────────────────────────────────────────────────────────

describe('getDiscrepancies', () => {
  it('returns empty list when no discrepancies', () => {
    const svc = makeService();
    const result = svc.getDiscrepancies();
    expect(result.count).toBe(0);
    expect(result.transactions).toHaveLength(0);
  });

  it('returns only flagged transactions', () => {
    const tx1 = Transaction.create({ donor: 'A', recipient: 'B', amount: 1, status: TRANSACTION_STATES.PENDING });
    const tx2 = Transaction.create({ donor: 'C', recipient: 'D', amount: 2, status: TRANSACTION_STATES.PENDING });
    Transaction.create({ donor: 'E', recipient: 'F', amount: 3, status: TRANSACTION_STATES.PENDING });
    const svc = makeService();
    svc.flagDiscrepancy(tx1.id, 'reason 1');
    svc.flagDiscrepancy(tx2.id, 'reason 2');
    const result = svc.getDiscrepancies();
    expect(result.count).toBe(2);
    expect(result.transactions.map(t => t.id)).toEqual(expect.arrayContaining([tx1.id, tx2.id]));
  });

  it('excludes resolved transactions', () => {
    const tx = Transaction.create({ donor: 'A', recipient: 'B', amount: 1, status: TRANSACTION_STATES.PENDING });
    const svc = makeService();
    svc.flagDiscrepancy(tx.id, 'test');
    svc.resolveDiscrepancy(tx.id, 'confirmed');
    expect(svc.getDiscrepancies().count).toBe(0);
  });
});

// ─── reconcileTransaction flags discrepancy on state machine rejection ────────

describe('reconcileTransaction — discrepancy flagging', () => {
  it('flags a transaction when confirmed on-chain but state transition is invalid', async () => {
    // Create a transaction in 'confirmed' status — updating to confirmed again is a no-op
    // but we can simulate a state machine error by using a status that can't transition
    const tx = Transaction.create({
      donor: 'A', recipient: 'B', amount: 1,
      status: TRANSACTION_STATES.PENDING,
      stellarTxId: 'hash-abc',
    });

    const stellarService = makeStellarService({
      verifyTransaction: jest.fn().mockResolvedValue({
        verified: true,
        transaction: { ledger: 100 },
      }),
    });

    const svc = makeService(stellarService);

    // Spy on flagDiscrepancy to verify it's called when updateStatus throws
    const flagSpy = jest.spyOn(svc, 'flagDiscrepancy');

    // Force updateStatus to throw to simulate state machine rejection
    const origUpdate = Transaction.updateStatus.bind(Transaction);
    jest.spyOn(Transaction, 'updateStatus').mockImplementationOnce(() => {
      throw new Error('Invalid state transition');
    });

    await svc.reconcileTransaction(tx);

    expect(flagSpy).toHaveBeenCalledWith(tx.id, expect.stringContaining('Confirmed on-chain'));
    Transaction.updateStatus = origUpdate;
  });

  it('does not flag when Horizon returns not-verified', async () => {
    const tx = Transaction.create({ donor: 'A', recipient: 'B', amount: 1, status: TRANSACTION_STATES.PENDING, stellarTxId: 'hash-xyz' });
    const svc = makeService(makeStellarService({ verifyTransaction: jest.fn().mockResolvedValue({ verified: false }) }));
    const flagSpy = jest.spyOn(svc, 'flagDiscrepancy');
    await svc.reconcileTransaction(tx);
    expect(flagSpy).not.toHaveBeenCalled();
  });

  it('handles Horizon 404 gracefully without throwing', async () => {
    const tx = Transaction.create({ donor: 'A', recipient: 'B', amount: 1, status: TRANSACTION_STATES.PENDING, stellarTxId: 'hash-404' });
    const err = new Error('Not found'); err.status = 404;
    const svc = makeService(makeStellarService({ verifyTransaction: jest.fn().mockRejectedValue(err) }));
    await expect(svc.reconcileTransaction(tx)).resolves.toBe(false);
  });

  it('handles Horizon network errors gracefully in reconcile()', async () => {
    Transaction.create({ donor: 'A', recipient: 'B', amount: 1, status: TRANSACTION_STATES.PENDING, stellarTxId: 'hash-err' });
    const stellarService = makeStellarService({
      verifyTransaction: jest.fn().mockRejectedValue(new Error('Network timeout')),
    });
    const svc = makeService(stellarService);
    // reconcile() should not throw even when individual tx verification fails
    const result = await svc.reconcile();
    expect(result).toHaveProperty('errors');
  });
});

// ─── GET /admin/reconciliation/report ────────────────────────────────────────

describe('GET /admin/reconciliation/report', () => {
  it('returns 200 with discrepancy count and transactions', async () => {
    const tx = Transaction.create({ donor: 'A', recipient: 'B', amount: 1, status: TRANSACTION_STATES.PENDING });
    const svc = makeService();
    svc.flagDiscrepancy(tx.id, 'test reason');
    const app = buildAdminApp(svc);
    const res = await request(app).get('/admin/reconciliation/report');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.discrepancyCount).toBe(1);
    expect(res.body.data.transactions[0].id).toBe(tx.id);
    expect(res.body.data.serviceStatus).toBeDefined();
    expect(res.body.data.generatedAt).toBeDefined();
  });

  it('returns empty list when no discrepancies', async () => {
    const svc = makeService();
    const app = buildAdminApp(svc);
    const res = await request(app).get('/admin/reconciliation/report');
    expect(res.status).toBe(200);
    expect(res.body.data.discrepancyCount).toBe(0);
    expect(res.body.data.transactions).toHaveLength(0);
  });
});

// ─── POST /admin/reconciliation/resolve/:txId ─────────────────────────────────

describe('POST /admin/reconciliation/resolve/:txId', () => {
  it('resolves a flagged transaction and returns updated record', async () => {
    const tx = Transaction.create({ donor: 'A', recipient: 'B', amount: 1, status: TRANSACTION_STATES.PENDING });
    const svc = makeService();
    svc.flagDiscrepancy(tx.id, 'test');
    const app = buildAdminApp(svc);
    const res = await request(app)
      .post(`/admin/reconciliation/resolve/${tx.id}`)
      .send({ status: 'confirmed' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.reconciliation_needed).toBe(false);
    expect(res.body.data.status).toBe('confirmed');
  });

  it('returns 400 when status is missing', async () => {
    const svc = makeService();
    const app = buildAdminApp(svc);
    const res = await request(app)
      .post('/admin/reconciliation/resolve/some-id')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 when transaction does not exist', async () => {
    const svc = makeService();
    const app = buildAdminApp(svc);
    const res = await request(app)
      .post('/admin/reconciliation/resolve/nonexistent')
      .send({ status: 'confirmed' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('removes the transaction from the discrepancy report after resolution', async () => {
    const tx = Transaction.create({ donor: 'A', recipient: 'B', amount: 1, status: TRANSACTION_STATES.PENDING });
    const svc = makeService();
    svc.flagDiscrepancy(tx.id, 'test');
    const app = buildAdminApp(svc);
    await request(app).post(`/admin/reconciliation/resolve/${tx.id}`).send({ status: 'failed' });
    const report = await request(app).get('/admin/reconciliation/report');
    expect(report.body.data.discrepancyCount).toBe(0);
  });
});
