/**
 * Stellar Account Merge Support Tests
 *
 * Covers: mergeAccount on MockStellarService, POST /wallets/:id/merge endpoint,
 * confirmation requirement, soft-delete, audit logging, and all edge cases.
 * No live Stellar network required.
 */

'use strict';

jest.mock('../src/utils/log', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

jest.mock('../src/utils/database');
const Database = require('../../src/utils/database');

jest.mock('../src/middleware/rbac', () => ({
  checkPermission: () => (req, res, next) => next(),
  requireAdmin: () => (req, res, next) => next(),
  attachUserRole: () => (req, res, next) => { req.user = { id: 'test-user', role: 'admin' }; next(); },
}));

jest.mock('../src/config/stellar', () => ({
  getStellarService: jest.fn(),
}));

const request = require('supertest');
const express = require('express');
const MockStellarService = require('../../src/services/MockStellarService');
const { getStellarService } = require('../../src/config/stellar');

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeStellar() {
  return new MockStellarService({ strictValidation: false });
}

async function makeWalletPair(stellar) {
  const source = await stellar.createWallet();
  const dest = await stellar.createWallet();
  // Fund both
  stellar.wallets.get(source.publicKey).balance = '500.0000000';
  stellar.wallets.get(dest.publicKey).balance = '100.0000000';
  return { source, dest };
}

function makeApp(stellar) {
  getStellarService.mockReturnValue(stellar);
  const walletRouter = require('../../src/routes/wallet');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 'test-user', role: 'admin' }; next(); });
  app.use('/wallets', walletRouter);
  app.use((err, req, res, _next) => {
    res.status(err.statusCode || err.status || 500).json({ success: false, error: err.message });
  });
  return app;
}


// ═════════════════════════════════════════════════════════════════════════════
// 1. MockStellarService.mergeAccount – success
// ═════════════════════════════════════════════════════════════════════════════

describe('MockStellarService.mergeAccount – success', () => {
  let stellar;

  beforeEach(() => { stellar = makeStellar(); });

  test('returns hash, ledger, and mergedAmount', async () => {
    const { source, dest } = await makeWalletPair(stellar);
    const result = await stellar.mergeAccount(source.secretKey, dest.publicKey);

    expect(result.hash).toMatch(/^mock_merge_/);
    expect(typeof result.ledger).toBe('number');
    expect(result.mergedAmount).toBe('500.0000000');
  });

  test('transfers entire source balance to destination', async () => {
    const { source, dest } = await makeWalletPair(stellar);
    await stellar.mergeAccount(source.secretKey, dest.publicKey);

    const destWallet = stellar.wallets.get(dest.publicKey);
    expect(parseFloat(destWallet.balance)).toBeCloseTo(600, 4);
  });

  test('zeroes out source account balance', async () => {
    const { source, dest } = await makeWalletPair(stellar);
    await stellar.mergeAccount(source.secretKey, dest.publicKey);

    const srcWallet = stellar.wallets.get(source.publicKey);
    expect(srcWallet.balance).toBe('0');
  });

  test('marks source wallet as merged', async () => {
    const { source, dest } = await makeWalletPair(stellar);
    await stellar.mergeAccount(source.secretKey, dest.publicKey);

    const srcWallet = stellar.wallets.get(source.publicKey);
    expect(srcWallet.merged).toBe(true);
    expect(srcWallet.mergedInto).toBe(dest.publicKey);
    expect(srcWallet.mergedAt).toBeDefined();
  });

  test('records merge transaction for both accounts', async () => {
    const { source, dest } = await makeWalletPair(stellar);
    await stellar.mergeAccount(source.secretKey, dest.publicKey);

    const srcTxs = stellar.transactions.get(source.publicKey);
    const dstTxs = stellar.transactions.get(dest.publicKey);

    expect(srcTxs.some(t => t.type === 'account_merge')).toBe(true);
    expect(dstTxs.some(t => t.type === 'account_merge')).toBe(true);
  });

  test('merge transaction has correct fields', async () => {
    const { source, dest } = await makeWalletPair(stellar);
    const result = await stellar.mergeAccount(source.secretKey, dest.publicKey);

    const tx = stellar.transactions.get(source.publicKey).find(t => t.type === 'account_merge');
    expect(tx.hash).toBe(result.hash);
    expect(tx.source).toBe(source.publicKey);
    expect(tx.destination).toBe(dest.publicKey);
    expect(tx.status).toBe('confirmed');
  });

  test('works when source has zero balance', async () => {
    const { source, dest } = await makeWalletPair(stellar);
    stellar.wallets.get(source.publicKey).balance = '0';

    const result = await stellar.mergeAccount(source.secretKey, dest.publicKey);
    expect(result.mergedAmount).toBe('0');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. MockStellarService.mergeAccount – validation errors
// ═════════════════════════════════════════════════════════════════════════════

describe('MockStellarService.mergeAccount – validation', () => {
  let stellar;

  beforeEach(() => { stellar = makeStellar(); });

  test('throws when source secret is invalid', async () => {
    const { dest } = await makeWalletPair(stellar);
    // strictValidation is off, but secret not found in wallets map
    await expect(
      stellar.mergeAccount('SINVALID_SECRET_KEY_NOT_IN_MAP', dest.publicKey)
    ).rejects.toThrow();
  });

  test('throws when source and destination are the same', async () => {
    const { source } = await makeWalletPair(stellar);
    await expect(
      stellar.mergeAccount(source.secretKey, source.publicKey)
    ).rejects.toThrow(/same/i);
  });

  test('throws when destination account does not exist', async () => {
    const { source } = await makeWalletPair(stellar);
    const nonExistent = 'GNON_EXISTENT_ACCOUNT_12345678901234567890123456789012';
    await expect(
      stellar.mergeAccount(source.secretKey, nonExistent)
    ).rejects.toThrow(/not found/i);
  });

  test('throws when secret key does not match any wallet', async () => {
    const { dest } = await makeWalletPair(stellar);
    const fakeSecret = 'SFAKE_SECRET_KEY_THAT_DOES_NOT_MATCH_ANY_WALLET_12345';
    await expect(
      stellar.mergeAccount(fakeSecret, dest.publicKey)
    ).rejects.toThrow(/secret key/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. MockStellarService.mergeAccount – failure simulation
// ═════════════════════════════════════════════════════════════════════════════

describe('MockStellarService.mergeAccount – failure simulation', () => {
  let stellar;

  beforeEach(() => { stellar = makeStellar(); });

  test('throws on timeout simulation', async () => {
    const { source, dest } = await makeWalletPair(stellar);
    stellar.enableFailureSimulation('timeout', 1.0);
    await expect(stellar.mergeAccount(source.secretKey, dest.publicKey)).rejects.toThrow(/timeout/i);
  });

  test('throws on network_error simulation', async () => {
    const { source, dest } = await makeWalletPair(stellar);
    stellar.enableFailureSimulation('network_error', 1.0);
    await expect(stellar.mergeAccount(source.secretKey, dest.publicKey)).rejects.toThrow(/network/i);
  });

  test('succeeds after disabling failure simulation', async () => {
    const { source, dest } = await makeWalletPair(stellar);
    stellar.enableFailureSimulation('timeout', 1.0);
    stellar.disableFailureSimulation();
    await expect(stellar.mergeAccount(source.secretKey, dest.publicKey)).resolves.toBeDefined();
  });
});


// ═════════════════════════════════════════════════════════════════════════════
// 4. POST /wallets/:id/merge – success
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /wallets/:id/merge – success', () => {
  let app, stellar;

  beforeEach(() => {
    stellar = makeStellar();
    app = makeApp(stellar);

    Database.get.mockImplementation(async (sql, params) => {
      if (sql.includes('users') && (params[0] === 1 || params[0] === '1')) {
        return { id: 1, publicKey: 'GSOURCE_PUB_KEY_12345678901234567890123456789012345', mergedAt: null };
      }
      return null;
    });
    Database.run.mockResolvedValue({ id: 99, changes: 1 });

    stellar.mergeAccount = jest.fn().mockResolvedValue({
      hash: 'mock_merge_abc123',
      ledger: 1234567,
      mergedAmount: '500.0000000',
    });
  });

  afterEach(() => jest.clearAllMocks());

  test('200 with full merge result', async () => {
    const res = await request(app)
      .post('/wallets/1/merge')
      .send({
        destinationPublicKey: 'GDEST_PUB_KEY_123456789012345678901234567890123456789',
        sourceSecret: 'SSOURCE_SECRET_KEY_12345678901234567890123456789012345',
        confirm: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.transactionHash).toBe('mock_merge_abc123');
    expect(res.body.data.mergedAmount).toBe('500.0000000');
    expect(res.body.data.sourcePublicKey).toBeDefined();
    expect(res.body.data.mergedAt).toBeDefined();
  });

  test('soft-deletes the source wallet', async () => {
    await request(app)
      .post('/wallets/1/merge')
      .send({
        destinationPublicKey: 'GDEST_PUB_KEY_123456789012345678901234567890123456789',
        sourceSecret: 'SSOURCE_SECRET_KEY_12345678901234567890123456789012345',
        confirm: true,
      });

    const updateCall = Database.run.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('UPDATE users')
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[1][1]).toBe('GDEST_PUB_KEY_123456789012345678901234567890123456789');
  });

  test('writes audit log entry', async () => {
    await request(app)
      .post('/wallets/1/merge')
      .send({
        destinationPublicKey: 'GDEST_PUB_KEY_123456789012345678901234567890123456789',
        sourceSecret: 'SSOURCE_SECRET_KEY_12345678901234567890123456789012345',
        confirm: true,
      });

    const auditCall = Database.run.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('wallet_merge_audit')
    );
    expect(auditCall).toBeDefined();
    expect(auditCall[1]).toContain('mock_merge_abc123');
  });

  test('audit log includes performedBy from req.user', async () => {
    await request(app)
      .post('/wallets/1/merge')
      .send({
        destinationPublicKey: 'GDEST_PUB_KEY_123456789012345678901234567890123456789',
        sourceSecret: 'SSOURCE_SECRET_KEY_12345678901234567890123456789012345',
        confirm: true,
      });

    const auditCall = Database.run.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('wallet_merge_audit')
    );
    expect(auditCall[1]).toContain('test-user');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. POST /wallets/:id/merge – confirmation requirement
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /wallets/:id/merge – confirmation requirement', () => {
  let app, stellar;

  beforeEach(() => {
    stellar = makeStellar();
    app = makeApp(stellar);
    Database.get.mockResolvedValue({ id: 1, publicKey: 'GSOURCE', mergedAt: null });
    Database.run.mockResolvedValue({ id: 1, changes: 1 });
  });

  afterEach(() => jest.clearAllMocks());

  test('400 when confirm is missing', async () => {
    const res = await request(app)
      .post('/wallets/1/merge')
      .send({ destinationPublicKey: 'GDEST', sourceSecret: 'SSECRET' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/confirm/i);
  });

  test('400 when confirm is false', async () => {
    const res = await request(app)
      .post('/wallets/1/merge')
      .send({ destinationPublicKey: 'GDEST', sourceSecret: 'SSECRET', confirm: false });
    expect(res.status).toBe(400);
  });

  test('400 when confirm is string "true"', async () => {
    const res = await request(app)
      .post('/wallets/1/merge')
      .send({ destinationPublicKey: 'GDEST', sourceSecret: 'SSECRET', confirm: 'true' });
    expect(res.status).toBe(400);
  });

  test('400 when confirm is 1 (number)', async () => {
    const res = await request(app)
      .post('/wallets/1/merge')
      .send({ destinationPublicKey: 'GDEST', sourceSecret: 'SSECRET', confirm: 1 });
    expect(res.status).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. POST /wallets/:id/merge – validation errors
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /wallets/:id/merge – validation errors', () => {
  let app, stellar;

  beforeEach(() => {
    stellar = makeStellar();
    app = makeApp(stellar);
    Database.get.mockResolvedValue({ id: 1, publicKey: 'GSOURCE', mergedAt: null });
    Database.run.mockResolvedValue({ id: 1, changes: 1 });
  });

  afterEach(() => jest.clearAllMocks());

  test('400 when destinationPublicKey is missing', async () => {
    const res = await request(app)
      .post('/wallets/1/merge')
      .send({ sourceSecret: 'SSECRET', confirm: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/destinationPublicKey/i);
  });

  test('400 when sourceSecret is missing', async () => {
    const res = await request(app)
      .post('/wallets/1/merge')
      .send({ destinationPublicKey: 'GDEST', confirm: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sourceSecret/i);
  });

  test('404 when wallet not found', async () => {
    Database.get.mockResolvedValue(null);
    const res = await request(app)
      .post('/wallets/999/merge')
      .send({ destinationPublicKey: 'GDEST', sourceSecret: 'SSECRET', confirm: true });
    expect(res.status).toBe(404);
  });

  test('409 when wallet already merged', async () => {
    Database.get.mockResolvedValue({
      id: 1, publicKey: 'GSOURCE', mergedAt: '2026-01-01T00:00:00.000Z',
    });
    const res = await request(app)
      .post('/wallets/1/merge')
      .send({ destinationPublicKey: 'GDEST', sourceSecret: 'SSECRET', confirm: true });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already been merged/i);
  });

  test('400 when source and destination are the same', async () => {
    Database.get.mockResolvedValue({ id: 1, publicKey: 'GSAME', mergedAt: null });
    const res = await request(app)
      .post('/wallets/1/merge')
      .send({ destinationPublicKey: 'GSAME', sourceSecret: 'SSECRET', confirm: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/same/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. POST /wallets/:id/merge – Stellar errors propagate correctly
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /wallets/:id/merge – Stellar errors', () => {
  let app, stellar;

  beforeEach(() => {
    stellar = makeStellar();
    app = makeApp(stellar);
    Database.get.mockResolvedValue({ id: 1, publicKey: 'GSOURCE', mergedAt: null });
    Database.run.mockResolvedValue({ id: 1, changes: 1 });
  });

  afterEach(() => jest.clearAllMocks());

  test('propagates Stellar service error as 500', async () => {
    stellar.mergeAccount = jest.fn().mockRejectedValue(new Error('Horizon unavailable'));
    getStellarService.mockReturnValue(stellar);

    const res = await request(app)
      .post('/wallets/1/merge')
      .send({ destinationPublicKey: 'GDEST', sourceSecret: 'SSECRET', confirm: true });

    expect(res.status).toBe(500);
  });

  test('does NOT soft-delete wallet when Stellar merge fails', async () => {
    stellar.mergeAccount = jest.fn().mockRejectedValue(new Error('tx_failed'));
    getStellarService.mockReturnValue(stellar);

    await request(app)
      .post('/wallets/1/merge')
      .send({ destinationPublicKey: 'GDEST', sourceSecret: 'SSECRET', confirm: true });

    const updateCall = Database.run.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('UPDATE users')
    );
    expect(updateCall).toBeUndefined();
  });

  test('does NOT write audit log when Stellar merge fails', async () => {
    stellar.mergeAccount = jest.fn().mockRejectedValue(new Error('tx_failed'));
    getStellarService.mockReturnValue(stellar);

    await request(app)
      .post('/wallets/1/merge')
      .send({ destinationPublicKey: 'GDEST', sourceSecret: 'SSECRET', confirm: true });

    const auditCall = Database.run.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('wallet_merge_audit')
    );
    expect(auditCall).toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. Full integration: MockStellarService + route
// ═════════════════════════════════════════════════════════════════════════════

describe('Full integration – MockStellarService + route', () => {
  let app, stellar, source, dest;

  beforeEach(async () => {
    stellar = makeStellar();
    app = makeApp(stellar);

    const pair = await makeWalletPair(stellar);
    source = pair.source;
    dest = pair.dest;

    Database.get.mockResolvedValue({
      id: 1,
      publicKey: source.publicKey,
      mergedAt: null,
    });
    Database.run.mockResolvedValue({ id: 99, changes: 1 });
  });

  afterEach(() => jest.clearAllMocks());

  test('end-to-end merge transfers balance and closes source', async () => {
    const res = await request(app)
      .post('/wallets/1/merge')
      .send({
        destinationPublicKey: dest.publicKey,
        sourceSecret: source.secretKey,
        confirm: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.data.mergedAmount).toBe('500.0000000');

    // Source wallet closed on mock network
    const srcWallet = stellar.wallets.get(source.publicKey);
    expect(srcWallet.balance).toBe('0');
    expect(srcWallet.merged).toBe(true);

    // Destination received funds
    const dstWallet = stellar.wallets.get(dest.publicKey);
    expect(parseFloat(dstWallet.balance)).toBeCloseTo(600, 4);
  });

  test('audit log is written with correct data', async () => {
    await request(app)
      .post('/wallets/1/merge')
      .send({
        destinationPublicKey: dest.publicKey,
        sourceSecret: source.secretKey,
        confirm: true,
      });

    const auditCall = Database.run.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('wallet_merge_audit')
    );
    expect(auditCall).toBeDefined();
    const params = auditCall[1];
    expect(params[1]).toBe(source.publicKey);   // sourcePublicKey
    expect(params[2]).toBe(dest.publicKey);     // destinationPublicKey
    expect(params[3]).toBe('500.0000000');       // mergedAmount
  });
});
