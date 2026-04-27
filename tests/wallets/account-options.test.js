'use strict';

/**
 * Tests for PATCH /wallets/:id/options (Stellar account setOptions)
 * Covers: each option type, invalid combinations, AUTH_IMMUTABLE, audit trail
 */

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-key-options';

const request = require('supertest');
const express = require('express');
const walletRouter = require('../../src/routes/wallet');
const { getStellarService } = require('../../src/config/stellar');
const { attachUserRole } = require('../../src/middleware/rbac');
const Database = require('../../src/utils/database');
const AuditLogService = require('../../src/services/AuditLogService');

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(attachUserRole());
  app.use('/wallets', walletRouter);
  app.use((err, req, res, _next) => {
    res.status(err.statusCode || err.status || 500).json({
      success: false,
      error: { code: err.code || err.errorCode || 'INTERNAL_ERROR', message: err.message },
    });
  });
  return app;
}

describe('PATCH /wallets/:id/options — Stellar Account Set Options', () => {
  let app;
  let stellarService;
  let wallet;
  let walletId;

  beforeAll(async () => {
    app = createTestApp();
    stellarService = getStellarService();
    wallet = await stellarService.createWallet();
    // Insert into the users (wallets) table used by the route
    await Database.run(
      'INSERT INTO users (publicKey) VALUES (?)',
      [wallet.publicKey]
    );
    const row = await Database.get('SELECT id FROM users WHERE publicKey = ?', [wallet.publicKey]);
    walletId = row.id;
  });

  afterAll(async () => {
    await Database.run('DELETE FROM users WHERE publicKey = ?', [wallet.publicKey]);
  });

  // ── homeDomain ──────────────────────────────────────────────────────────────

  it('sets homeDomain successfully', async () => {
    const res = await request(app)
      .patch(`/wallets/${walletId}/options`)
      .set('Authorization', 'Bearer test-key-options')
      .send({ secret: wallet.secretKey, homeDomain: 'example.com' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('transactionHash');
  });

  // ── masterWeight ────────────────────────────────────────────────────────────

  it('sets masterWeight successfully', async () => {
    const res = await request(app)
      .patch(`/wallets/${walletId}/options`)
      .set('Authorization', 'Bearer test-key-options')
      .send({ secret: wallet.secretKey, masterWeight: 1 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // ── thresholds ──────────────────────────────────────────────────────────────

  it('sets low/med/high thresholds successfully', async () => {
    const res = await request(app)
      .patch(`/wallets/${walletId}/options`)
      .set('Authorization', 'Bearer test-key-options')
      .send({ secret: wallet.secretKey, lowThreshold: 1, medThreshold: 2, highThreshold: 3 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // ── setFlags ────────────────────────────────────────────────────────────────

  it('sets account flags successfully', async () => {
    const res = await request(app)
      .patch(`/wallets/${walletId}/options`)
      .set('Authorization', 'Bearer test-key-options')
      .send({ secret: wallet.secretKey, setFlags: 1 }); // AUTH_REQUIRED = 1

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // ── AUTH_IMMUTABLE cannot be cleared ────────────────────────────────────────

  it('returns 400 when attempting to clear AUTH_IMMUTABLE flag', async () => {
    const res = await request(app)
      .patch(`/wallets/${walletId}/options`)
      .set('Authorization', 'Bearer test-key-options')
      .send({ secret: wallet.secretKey, clearFlags: 8 }); // AUTH_IMMUTABLE = 8

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toMatch(/AUTH_IMMUTABLE/i);
  });

  // ── Wallet not found ────────────────────────────────────────────────────────

  it('returns 404 for non-existent wallet', async () => {
    const res = await request(app)
      .patch('/wallets/999999/options')
      .set('Authorization', 'Bearer test-key-options')
      .send({ secret: wallet.secretKey, homeDomain: 'test.com' });

    expect(res.status).toBe(404);
  });

  // ── Missing secret ──────────────────────────────────────────────────────────

  it('returns 400 when secret is missing', async () => {
    const res = await request(app)
      .patch(`/wallets/${walletId}/options`)
      .set('Authorization', 'Bearer test-key-options')
      .send({ homeDomain: 'test.com' });

    expect(res.status).toBe(400);
  });

  // ── Audit trail ─────────────────────────────────────────────────────────────

  it('creates an audit log entry on successful options change', async () => {
    const logSpy = jest.spyOn(AuditLogService, 'log').mockResolvedValue(undefined);

    await request(app)
      .patch(`/wallets/${walletId}/options`)
      .set('Authorization', 'Bearer test-key-options')
      .send({ secret: wallet.secretKey, homeDomain: 'audit-test.com' });

    const auditCall = logSpy.mock.calls.find(
      ([args]) => args && args.action === 'WALLET_OPTIONS_SET'
    );
    expect(auditCall).toBeDefined();
    logSpy.mockRestore();
  });
});
