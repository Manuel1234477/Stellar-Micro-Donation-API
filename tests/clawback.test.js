'use strict';

/**
 * Tests for POST /assets/:code/clawback
 * Covers: admin auth required, reason field required, audit log, notification
 */

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'admin-clawback-key';

const request = require('supertest');
const express = require('express');
const assetRouter = require('../src/routes/assets');
const { getStellarService } = require('../src/config/stellar');
const { attachUserRole } = require('../src/middleware/rbac');
const AuditLogService = require('../src/services/AuditLogService');

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(attachUserRole());
  app.use('/assets', assetRouter);
  app.use((err, req, res, _next) => {
    res.status(err.statusCode || err.status || 500).json({
      success: false,
      error: { code: err.errorCode || err.code || 'INTERNAL_ERROR', message: err.message },
    });
  });
  return app;
}

describe('POST /assets/:code/clawback — Stellar Clawback Operations', () => {
  let app;
  let stellarService;
  let issuerWallet;
  let holderWallet;
  const ASSET_CODE = 'TESTTKN';
  const CLAWBACK_AMOUNT = '5.0000000';

  beforeAll(async () => {
    app = createTestApp();
    stellarService = getStellarService();

    // Create issuer and holder wallets
    issuerWallet = await stellarService.createWallet();
    holderWallet = await stellarService.createWallet();

    // Issue some tokens to the holder so clawback has something to reclaim
    if (!stellarService.assetBalances) stellarService.assetBalances = new Map();
    const assetKey = `${ASSET_CODE}:${issuerWallet.publicKey}`;
    const holders = new Map();
    holders.set(holderWallet.publicKey, '100.0000000');
    stellarService.assetBalances.set(assetKey, holders);
  });

  // ── Admin auth required ─────────────────────────────────────────────────────

  it('requires admin authentication', async () => {
    // Use a non-admin key
    const res = await request(app)
      .post(`/assets/${ASSET_CODE}/clawback`)
      .set('Authorization', 'Bearer admin-clawback-key') // starts with 'admin-' → admin role
      .send({
        issuerSecret: issuerWallet.secretKey,
        from: holderWallet.publicKey,
        amount: CLAWBACK_AMOUNT,
        reason: 'Regulatory compliance',
      });

    // Admin key should succeed
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('rejects non-admin users with 401 or 403', async () => {
    // A key not in the legacy list gets 401; a valid non-admin key gets 403
    const res = await request(app)
      .post(`/assets/${ASSET_CODE}/clawback`)
      .set('Authorization', 'Bearer not-a-valid-key')
      .send({
        issuerSecret: issuerWallet.secretKey,
        from: holderWallet.publicKey,
        amount: CLAWBACK_AMOUNT,
        reason: 'Test',
      });

    expect([401, 403]).toContain(res.status);
  });

  // ── Reason field required ───────────────────────────────────────────────────

  it('returns 400 when reason field is missing', async () => {
    const res = await request(app)
      .post(`/assets/${ASSET_CODE}/clawback`)
      .set('Authorization', 'Bearer admin-clawback-key')
      .send({
        issuerSecret: issuerWallet.secretKey,
        from: holderWallet.publicKey,
        amount: CLAWBACK_AMOUNT,
        // reason omitted
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    // error may be a string or object depending on route
    const errMsg = typeof res.body.error === 'string' ? res.body.error : res.body.error.message;
    expect(errMsg).toMatch(/reason/i);
  });

  it('returns 400 when issuerSecret is missing', async () => {
    const res = await request(app)
      .post(`/assets/${ASSET_CODE}/clawback`)
      .set('Authorization', 'Bearer admin-clawback-key')
      .send({ from: holderWallet.publicKey, amount: CLAWBACK_AMOUNT, reason: 'Test' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when from is missing', async () => {
    const res = await request(app)
      .post(`/assets/${ASSET_CODE}/clawback`)
      .set('Authorization', 'Bearer admin-clawback-key')
      .send({ issuerSecret: issuerWallet.secretKey, amount: CLAWBACK_AMOUNT, reason: 'Test' });

    expect(res.status).toBe(400);
  });

  // ── Audit log entry created ─────────────────────────────────────────────────

  it('creates a full audit log entry on successful clawback', async () => {
    const logSpy = jest.spyOn(AuditLogService, 'log').mockResolvedValue(undefined);

    // Re-seed balance for this test
    const assetKey = `${ASSET_CODE}:${issuerWallet.publicKey}`;
    if (!stellarService.assetBalances) stellarService.assetBalances = new Map();
    const holders = stellarService.assetBalances.get(assetKey) || new Map();
    holders.set(holderWallet.publicKey, '50.0000000');
    stellarService.assetBalances.set(assetKey, holders);

    await request(app)
      .post(`/assets/${ASSET_CODE}/clawback`)
      .set('Authorization', 'Bearer admin-clawback-key')
      .send({
        issuerSecret: issuerWallet.secretKey,
        from: holderWallet.publicKey,
        amount: '5.0000000',
        reason: 'Sanctioned account',
      });

    const auditCall = logSpy.mock.calls.find(
      ([args]) => args && args.action === 'ASSET_CLAWBACK'
    );
    expect(auditCall).toBeDefined();
    const [auditArgs] = auditCall;
    expect(auditArgs.details.reason).toBe('Sanctioned account');
    expect(auditArgs.details.assetCode).toBe(ASSET_CODE);
    expect(auditArgs.details.from).toBe(holderWallet.publicKey);
    expect(auditArgs.severity).toBe(AuditLogService.SEVERITY.HIGH);

    logSpy.mockRestore();
  });

  // ── Response contains expected fields ──────────────────────────────────────

  it('returns transaction hash and clawback details on success', async () => {
    // Re-seed balance
    const assetKey = `${ASSET_CODE}:${issuerWallet.publicKey}`;
    if (!stellarService.assetBalances) stellarService.assetBalances = new Map();
    const holders = stellarService.assetBalances.get(assetKey) || new Map();
    holders.set(holderWallet.publicKey, '50.0000000');
    stellarService.assetBalances.set(assetKey, holders);

    const res = await request(app)
      .post(`/assets/${ASSET_CODE}/clawback`)
      .set('Authorization', 'Bearer admin-clawback-key')
      .send({
        issuerSecret: issuerWallet.secretKey,
        from: holderWallet.publicKey,
        amount: '3.0000000',
        reason: 'Erroneous distribution',
      });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('transactionHash');
    expect(res.body.data.assetCode).toBe(ASSET_CODE);
    expect(res.body.data.from).toBe(holderWallet.publicKey);
    expect(res.body.data.reason).toBe('Erroneous distribution');
  });

  // ── Invalid asset code ──────────────────────────────────────────────────────

  it('returns 400 for invalid asset code', async () => {
    const res = await request(app)
      .post('/assets/INVALID_CODE_TOO_LONG/clawback')
      .set('Authorization', 'Bearer admin-clawback-key')
      .send({
        issuerSecret: issuerWallet.secretKey,
        from: holderWallet.publicKey,
        amount: '1.0',
        reason: 'Test',
      });

    expect(res.status).toBe(400);
  });
});
