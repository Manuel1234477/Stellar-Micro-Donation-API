/**
 * Transaction Simulation Tests
 *
 * Verifies the POST /transactions/simulate endpoint and the underlying
 * simulateTransaction() service method.
 *
 * No live Stellar network required — uses MockStellarService.
 * Critical invariant: StellarService.submitTransaction is NEVER called.
 */

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-key-sim';

const request = require('supertest');
const express = require('express');
const transactionRouter = require('../../src/routes/transaction');
const { getStellarService } = require('../../src/config/stellar');
const { attachUserRole } = require('../../src/middleware/rbac');

// ─── Test App ─────────────────────────────────────────────────────────────────

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(attachUserRole());
  app.use('/transactions', transactionRouter);
  app.use((err, req, res, next) => {
    void next;
    res.status(err.status || 500).json({
      success: false,
      error: { code: err.code || 'INTERNAL_ERROR', message: err.message },
    });
  });
  return app;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** A minimal valid-looking Base64 XDR string (mock service doesn't parse it). */
const VALID_ENVELOPE = Buffer.from('mock-xdr-envelope').toString('base64');

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /transactions/simulate', () => {
  let app;
  let stellarService;

  beforeAll(() => {
    app = createTestApp();
    stellarService = getStellarService();
  });

  afterEach(() => {
    // Reset simulation outcome after each test
    if (typeof stellarService.setSimulationOutcome === 'function') {
      stellarService.setSimulationOutcome('success');
    }
    delete process.env.SIMULATION_ENABLED;
  });

  // ── Happy path ──────────────────────────────────────────────────────────────

  test('valid XDR returns successful simulation with fee estimate', async () => {
    const res = await request(app)
      .post('/transactions/simulate')
      .set('X-API-Key', 'test-key-sim')
      .send({ tx_envelope: VALID_ENVELOPE });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const data = res.body.data;
    expect(data).toHaveProperty('estimated_fee');
    expect(data).toHaveProperty('sequence_validity');
    expect(data).toHaveProperty('source_account_balance_status');
    expect(data).toHaveProperty('operation_validity');
    expect(data).toHaveProperty('simulation_note');

    // Fee should be a numeric string
    expect(parseFloat(data.estimated_fee)).toBeGreaterThanOrEqual(0);
    expect(data.sequence_validity).toBe(true);
    expect(data.source_account_balance_status).toBe('sufficient');
    expect(data.operation_validity).toBe(true);
  });

  // ── Insufficient balance ────────────────────────────────────────────────────

  test('insufficient balance returns descriptive error code in response', async () => {
    stellarService.setSimulationOutcome('insufficient_balance');

    const res = await request(app)
      .post('/transactions/simulate')
      .set('X-API-Key', 'test-key-sim')
      .send({ tx_envelope: VALID_ENVELOPE });

    expect(res.status).toBe(200);
    expect(res.body.data.source_account_balance_status).toBe('insufficient');
  });

  // ── Bad sequence ────────────────────────────────────────────────────────────

  test('bad sequence number returns sequence_validity false', async () => {
    stellarService.setSimulationOutcome('bad_sequence');

    const res = await request(app)
      .post('/transactions/simulate')
      .set('X-API-Key', 'test-key-sim')
      .send({ tx_envelope: VALID_ENVELOPE });

    expect(res.status).toBe(200);
    expect(res.body.data.sequence_validity).toBe(false);
  });

  // ── Missing envelope ────────────────────────────────────────────────────────

  test('missing tx_envelope returns 400', async () => {
    const res = await request(app)
      .post('/transactions/simulate')
      .set('X-API-Key', 'test-key-sim')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_TX_ENVELOPE');
  });

  test('non-string tx_envelope returns 400', async () => {
    const res = await request(app)
      .post('/transactions/simulate')
      .set('X-API-Key', 'test-key-sim')
      .send({ tx_envelope: 12345 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_TX_ENVELOPE');
  });

  // ── Simulation disabled ─────────────────────────────────────────────────────

  test('SIMULATION_ENABLED=false returns 403 SIMULATION_DISABLED', async () => {
    process.env.SIMULATION_ENABLED = 'false';

    const res = await request(app)
      .post('/transactions/simulate')
      .set('X-API-Key', 'test-key-sim')
      .send({ tx_envelope: VALID_ENVELOPE });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SIMULATION_DISABLED');
  });

  // ── CRITICAL: submitTransaction is never called ─────────────────────────────

  test('submitTransaction is NEVER called during simulation', async () => {
    const submitSpy = jest.spyOn(stellarService, 'submitTransaction');

    await request(app)
      .post('/transactions/simulate')
      .set('X-API-Key', 'test-key-sim')
      .send({ tx_envelope: VALID_ENVELOPE });

    expect(submitSpy).not.toHaveBeenCalled();
    submitSpy.mockRestore();
  });

  test('submitTransaction is NEVER called even when simulation returns insufficient_balance', async () => {
    stellarService.setSimulationOutcome('insufficient_balance');
    const submitSpy = jest.spyOn(stellarService, 'submitTransaction');

    await request(app)
      .post('/transactions/simulate')
      .set('X-API-Key', 'test-key-sim')
      .send({ tx_envelope: VALID_ENVELOPE });

    expect(submitSpy).not.toHaveBeenCalled();
    submitSpy.mockRestore();
  });

  test('submitTransaction is NEVER called even when simulation is disabled', async () => {
    process.env.SIMULATION_ENABLED = 'false';
    const submitSpy = jest.spyOn(stellarService, 'submitTransaction');

    await request(app)
      .post('/transactions/simulate')
      .set('X-API-Key', 'test-key-sim')
      .send({ tx_envelope: VALID_ENVELOPE });

    expect(submitSpy).not.toHaveBeenCalled();
    submitSpy.mockRestore();
  });
});

// ─── MockStellarService.simulateTransaction unit tests ────────────────────────

describe('MockStellarService.simulateTransaction', () => {
  let service;

  beforeEach(() => {
    service = getStellarService();
    service.setSimulationOutcome('success');
    delete process.env.SIMULATION_ENABLED;
  });

  afterEach(() => {
    delete process.env.SIMULATION_ENABLED;
  });

  test('returns all required fields on success', async () => {
    const result = await service.simulateTransaction(VALID_ENVELOPE);
    expect(result).toMatchObject({
      estimated_fee: expect.any(String),
      sequence_validity: true,
      source_account_balance_status: 'sufficient',
      operation_validity: true,
      simulation_note: expect.stringContaining('Dry-run'),
    });
  });

  test('throws SIMULATION_DISABLED when flag is false', async () => {
    process.env.SIMULATION_ENABLED = 'false';
    await expect(service.simulateTransaction(VALID_ENVELOPE)).rejects.toMatchObject({
      code: 'SIMULATION_DISABLED',
    });
  });

  test('throws INVALID_XDR for missing envelope', async () => {
    await expect(service.simulateTransaction('')).rejects.toMatchObject({
      code: 'INVALID_XDR',
    });
  });

  test('insufficient_balance outcome sets balance status correctly', async () => {
    service.setSimulationOutcome('insufficient_balance');
    const result = await service.simulateTransaction(VALID_ENVELOPE);
    expect(result.source_account_balance_status).toBe('insufficient');
  });

  test('bad_sequence outcome sets sequence_validity to false', async () => {
    service.setSimulationOutcome('bad_sequence');
    const result = await service.simulateTransaction(VALID_ENVELOPE);
    expect(result.sequence_validity).toBe(false);
  });

  test('error outcome throws', async () => {
    service.setSimulationOutcome('error');
    await expect(service.simulateTransaction(VALID_ENVELOPE)).rejects.toMatchObject({
      code: 'SIMULATION_ERROR',
    });
  });
});
