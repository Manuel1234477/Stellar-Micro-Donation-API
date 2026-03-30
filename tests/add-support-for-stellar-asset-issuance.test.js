/**
 * Stellar Asset Issuance Tests
 *
 * Covers: issueAsset, burnAsset on MockStellarService, all API endpoints,
 * metadata CRUD, holder listing, validation, and edge cases.
 * No live Stellar network required.
 */

'use strict';

jest.mock('../src/utils/log', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

jest.mock('../src/utils/database');
const Database = require('../src/utils/database');

jest.mock('../src/middleware/rbac', () => ({
  checkPermission: () => (req, res, next) => next(),
  requireAdmin: () => (req, res, next) => next(),
  attachUserRole: () => (req, res, next) => { req.user = { id: 'test-user', role: 'admin' }; next(); },
}));

jest.mock('../src/config/stellar', () => ({ getStellarService: jest.fn() }));

const request = require('supertest');
const express = require('express');
const MockStellarService = require('../src/services/MockStellarService');
const { getStellarService } = require('../src/config/stellar');

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeStellar() {
  return new MockStellarService({ strictValidation: false });
}

async function makeIssuancePair(stellar) {
  const issuer = await stellar.createWallet();
  const recipient = await stellar.createWallet();
  stellar.wallets.get(issuer.publicKey).balance = '1000.0000000';
  stellar.wallets.get(recipient.publicKey).balance = '10.0000000';
  return { issuer, recipient };
}

function makeApp(stellar) {
  getStellarService.mockReturnValue(stellar);
  const assetRoutes = require('../src/routes/assets');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 'test-user', role: 'admin' }; next(); });
  app.use('/assets', assetRoutes);
  app.use((err, req, res, _next) => {
    res.status(err.statusCode || err.status || 500).json({ success: false, error: err.message });
  });
  return app;
}


// ═════════════════════════════════════════════════════════════════════════════
// 1. MockStellarService.issueAsset – success
// ═════════════════════════════════════════════════════════════════════════════

describe('MockStellarService.issueAsset – success', () => {
  let stellar;
  beforeEach(() => { stellar = makeStellar(); });

  test('returns hash, ledger, assetCode, issuerPublic, amount', async () => {
    const { issuer, recipient } = await makeIssuancePair(stellar);
    const result = await stellar.issueAsset(issuer.secretKey, 'DONATE', '100', recipient.publicKey);

    expect(result.hash).toMatch(/^mock_issue_/);
    expect(typeof result.ledger).toBe('number');
    expect(result.assetCode).toBe('DONATE');
    expect(result.issuerPublic).toBe(issuer.publicKey);
    expect(result.amount).toBe('100.0000000');
  });

  test('credits recipient asset balance', async () => {
    const { issuer, recipient } = await makeIssuancePair(stellar);
    await stellar.issueAsset(issuer.secretKey, 'CERT', '50', recipient.publicKey);

    const holders = stellar.getAssetHolders('CERT', issuer.publicKey);
    const h = holders.find(x => x.holderPublicKey === recipient.publicKey);
    expect(parseFloat(h.balance)).toBeCloseTo(50, 4);
  });

  test('multiple issuances accumulate balance', async () => {
    const { issuer, recipient } = await makeIssuancePair(stellar);
    await stellar.issueAsset(issuer.secretKey, 'IMPACT', '30', recipient.publicKey);
    await stellar.issueAsset(issuer.secretKey, 'IMPACT', '20', recipient.publicKey);

    const holders = stellar.getAssetHolders('IMPACT', issuer.publicKey);
    const h = holders.find(x => x.holderPublicKey === recipient.publicKey);
    expect(parseFloat(h.balance)).toBeCloseTo(50, 4);
  });

  test('records issuance transaction for both accounts', async () => {
    const { issuer, recipient } = await makeIssuancePair(stellar);
    await stellar.issueAsset(issuer.secretKey, 'TOKEN', '10', recipient.publicKey);

    const issuerTxs = stellar.transactions.get(issuer.publicKey);
    const recipTxs = stellar.transactions.get(recipient.publicKey);
    expect(issuerTxs.some(t => t.type === 'asset_issuance')).toBe(true);
    expect(recipTxs.some(t => t.type === 'asset_issuance')).toBe(true);
  });

  test('supports different asset codes independently', async () => {
    const { issuer, recipient } = await makeIssuancePair(stellar);
    await stellar.issueAsset(issuer.secretKey, 'AAA', '10', recipient.publicKey);
    await stellar.issueAsset(issuer.secretKey, 'BBB', '20', recipient.publicKey);

    const holdersA = stellar.getAssetHolders('AAA', issuer.publicKey);
    const holdersB = stellar.getAssetHolders('BBB', issuer.publicKey);
    expect(parseFloat(holdersA[0].balance)).toBeCloseTo(10, 4);
    expect(parseFloat(holdersB[0].balance)).toBeCloseTo(20, 4);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. MockStellarService.issueAsset – validation errors
// ═════════════════════════════════════════════════════════════════════════════

describe('MockStellarService.issueAsset – validation', () => {
  let stellar;
  beforeEach(() => { stellar = makeStellar(); });

  test('throws for invalid asset code (too long)', async () => {
    const { issuer, recipient } = await makeIssuancePair(stellar);
    await expect(
      stellar.issueAsset(issuer.secretKey, 'TOOLONGCODE123', '10', recipient.publicKey)
    ).rejects.toThrow(/asset code/i);
  });

  test('throws for empty asset code', async () => {
    const { issuer, recipient } = await makeIssuancePair(stellar);
    await expect(
      stellar.issueAsset(issuer.secretKey, '', '10', recipient.publicKey)
    ).rejects.toThrow(/asset code/i);
  });

  test('throws for zero amount', async () => {
    const { issuer, recipient } = await makeIssuancePair(stellar);
    await expect(
      stellar.issueAsset(issuer.secretKey, 'TOKEN', '0', recipient.publicKey)
    ).rejects.toThrow(/positive/i);
  });

  test('throws for negative amount', async () => {
    const { issuer, recipient } = await makeIssuancePair(stellar);
    await expect(
      stellar.issueAsset(issuer.secretKey, 'TOKEN', '-5', recipient.publicKey)
    ).rejects.toThrow(/positive/i);
  });

  test('throws when issuer and recipient are the same', async () => {
    const { issuer } = await makeIssuancePair(stellar);
    await expect(
      stellar.issueAsset(issuer.secretKey, 'TOKEN', '10', issuer.publicKey)
    ).rejects.toThrow(/same/i);
  });

  test('throws when recipient does not exist', async () => {
    const { issuer } = await makeIssuancePair(stellar);
    await expect(
      stellar.issueAsset(issuer.secretKey, 'TOKEN', '10', 'GNONEXISTENT12345678901234567890123456789012345678')
    ).rejects.toThrow(/not found/i);
  });

  test('throws for invalid issuer secret', async () => {
    const { recipient } = await makeIssuancePair(stellar);
    await expect(
      stellar.issueAsset('SFAKEKEY_NOT_IN_MAP_12345678901234567890123456789', 'TOKEN', '10', recipient.publicKey)
    ).rejects.toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. MockStellarService.burnAsset – success
// ═════════════════════════════════════════════════════════════════════════════

describe('MockStellarService.burnAsset – success', () => {
  let stellar;
  beforeEach(() => { stellar = makeStellar(); });

  test('returns hash, ledger, assetCode, amount', async () => {
    const { issuer, recipient } = await makeIssuancePair(stellar);
    await stellar.issueAsset(issuer.secretKey, 'BURN', '100', recipient.publicKey);
    const result = await stellar.burnAsset(recipient.secretKey, 'BURN', issuer.publicKey, '40');

    expect(result.hash).toMatch(/^mock_burn_/);
    expect(result.assetCode).toBe('BURN');
    expect(result.amount).toBe('40.0000000');
  });

  test('deducts burned amount from holder balance', async () => {
    const { issuer, recipient } = await makeIssuancePair(stellar);
    await stellar.issueAsset(issuer.secretKey, 'BURN', '100', recipient.publicKey);
    await stellar.burnAsset(recipient.secretKey, 'BURN', issuer.publicKey, '40');

    const holders = stellar.getAssetHolders('BURN', issuer.publicKey);
    const h = holders.find(x => x.holderPublicKey === recipient.publicKey);
    expect(parseFloat(h.balance)).toBeCloseTo(60, 4);
  });

  test('full burn zeroes holder balance', async () => {
    const { issuer, recipient } = await makeIssuancePair(stellar);
    await stellar.issueAsset(issuer.secretKey, 'BURN', '50', recipient.publicKey);
    await stellar.burnAsset(recipient.secretKey, 'BURN', issuer.publicKey, '50');

    const holders = stellar.getAssetHolders('BURN', issuer.publicKey);
    expect(holders.length).toBe(0); // filtered out (balance = 0)
  });

  test('records burn transaction', async () => {
    const { issuer, recipient } = await makeIssuancePair(stellar);
    await stellar.issueAsset(issuer.secretKey, 'BURN', '100', recipient.publicKey);
    await stellar.burnAsset(recipient.secretKey, 'BURN', issuer.publicKey, '10');

    const txs = stellar.transactions.get(recipient.publicKey);
    expect(txs.some(t => t.type === 'asset_burn')).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. MockStellarService.burnAsset – validation errors
// ═════════════════════════════════════════════════════════════════════════════

describe('MockStellarService.burnAsset – validation', () => {
  let stellar;
  beforeEach(() => { stellar = makeStellar(); });

  test('throws when burning more than balance', async () => {
    const { issuer, recipient } = await makeIssuancePair(stellar);
    await stellar.issueAsset(issuer.secretKey, 'BURN', '10', recipient.publicKey);
    await expect(
      stellar.burnAsset(recipient.secretKey, 'BURN', issuer.publicKey, '100')
    ).rejects.toThrow(/insufficient/i);
  });

  test('throws for invalid asset code', async () => {
    const { issuer, recipient } = await makeIssuancePair(stellar);
    await expect(
      stellar.burnAsset(recipient.secretKey, 'TOOLONGCODE123', issuer.publicKey, '10')
    ).rejects.toThrow(/asset code/i);
  });

  test('throws when holder and issuer are the same', async () => {
    const { issuer } = await makeIssuancePair(stellar);
    await expect(
      stellar.burnAsset(issuer.secretKey, 'TOKEN', issuer.publicKey, '10')
    ).rejects.toThrow(/same/i);
  });

  test('throws for zero burn amount', async () => {
    const { issuer, recipient } = await makeIssuancePair(stellar);
    await expect(
      stellar.burnAsset(recipient.secretKey, 'TOKEN', issuer.publicKey, '0')
    ).rejects.toThrow(/positive/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. MockStellarService – failure simulation
// ═════════════════════════════════════════════════════════════════════════════

describe('MockStellarService – failure simulation', () => {
  let stellar;
  beforeEach(() => { stellar = makeStellar(); });

  test('issueAsset throws on timeout simulation', async () => {
    const { issuer, recipient } = await makeIssuancePair(stellar);
    stellar.enableFailureSimulation('timeout', 1.0);
    await expect(
      stellar.issueAsset(issuer.secretKey, 'TOKEN', '10', recipient.publicKey)
    ).rejects.toThrow(/timeout/i);
  });

  test('burnAsset throws on network_error simulation', async () => {
    const { issuer, recipient } = await makeIssuancePair(stellar);
    await stellar.issueAsset(issuer.secretKey, 'TOKEN', '50', recipient.publicKey);
    stellar.enableFailureSimulation('network_error', 1.0);
    await expect(
      stellar.burnAsset(recipient.secretKey, 'TOKEN', issuer.publicKey, '10')
    ).rejects.toThrow(/network/i);
  });
});


// ═════════════════════════════════════════════════════════════════════════════
// 6. POST /assets/issue – API route
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /assets/issue', () => {
  let app, stellar;

  beforeEach(() => {
    stellar = makeStellar();
    app = makeApp(stellar);
    Database.get.mockResolvedValue(null);
    Database.run.mockResolvedValue({ id: 1, changes: 1 });
    Database.query.mockResolvedValue([]);
  });

  afterEach(() => jest.clearAllMocks());

  test('201 on valid issuance', async () => {
    const { issuer, recipient } = await makeIssuancePair(stellar);
    const res = await request(app).post('/assets/issue').send({
      issuerSecret: issuer.secretKey,
      assetCode: 'DONATE',
      amount: '100',
      recipientPublic: recipient.publicKey,
    });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.assetCode).toBe('DONATE');
    expect(res.body.data.transactionHash).toMatch(/^mock_issue_/);
  });

  test('400 when assetCode is missing', async () => {
    const { issuer, recipient } = await makeIssuancePair(stellar);
    const res = await request(app).post('/assets/issue').send({
      issuerSecret: issuer.secretKey, amount: '10', recipientPublic: recipient.publicKey,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/assetCode/i);
  });

  test('400 when amount is missing', async () => {
    const { issuer, recipient } = await makeIssuancePair(stellar);
    const res = await request(app).post('/assets/issue').send({
      issuerSecret: issuer.secretKey, assetCode: 'TOKEN', recipientPublic: recipient.publicKey,
    });
    expect(res.status).toBe(400);
  });

  test('400 for invalid asset code', async () => {
    const { issuer, recipient } = await makeIssuancePair(stellar);
    const res = await request(app).post('/assets/issue').send({
      issuerSecret: issuer.secretKey, assetCode: 'TOOLONGCODE123',
      amount: '10', recipientPublic: recipient.publicKey,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/assetCode/i);
  });

  test('400 for negative amount', async () => {
    const { issuer, recipient } = await makeIssuancePair(stellar);
    const res = await request(app).post('/assets/issue').send({
      issuerSecret: issuer.secretKey, assetCode: 'TOKEN',
      amount: '-5', recipientPublic: recipient.publicKey,
    });
    expect(res.status).toBe(400);
  });

  test('writes asset record and holding to DB', async () => {
    const { issuer, recipient } = await makeIssuancePair(stellar);
    await request(app).post('/assets/issue').send({
      issuerSecret: issuer.secretKey, assetCode: 'CERT',
      amount: '50', recipientPublic: recipient.publicKey,
    });
    expect(Database.run).toHaveBeenCalled();
  });

  test('propagates Stellar error as 500', async () => {
    stellar.issueAsset = jest.fn().mockRejectedValue(new Error('Horizon down'));
    getStellarService.mockReturnValue(stellar);
    const res = await request(app).post('/assets/issue').send({
      issuerSecret: 'SFAKE', assetCode: 'TOKEN', amount: '10', recipientPublic: 'GFAKE',
    });
    expect(res.status).toBe(500);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. POST /assets/burn – API route
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /assets/burn', () => {
  let app, stellar;

  beforeEach(() => {
    stellar = makeStellar();
    app = makeApp(stellar);
    Database.get.mockResolvedValue(null);
    Database.run.mockResolvedValue({ id: 1, changes: 1 });
    Database.query.mockResolvedValue([]);
  });

  afterEach(() => jest.clearAllMocks());

  test('200 on valid burn', async () => {
    const { issuer, recipient } = await makeIssuancePair(stellar);
    await stellar.issueAsset(issuer.secretKey, 'BURN', '100', recipient.publicKey);

    const res = await request(app).post('/assets/burn').send({
      holderSecret: recipient.secretKey,
      assetCode: 'BURN',
      issuerPublic: issuer.publicKey,
      amount: '30',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.transactionHash).toMatch(/^mock_burn_/);
  });

  test('400 when holderSecret is missing', async () => {
    const res = await request(app).post('/assets/burn').send({
      assetCode: 'BURN', issuerPublic: 'GISSUER', amount: '10',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/holderSecret/i);
  });

  test('400 for invalid asset code', async () => {
    const res = await request(app).post('/assets/burn').send({
      holderSecret: 'SHOLDER', assetCode: 'TOOLONGCODE123', issuerPublic: 'GISSUER', amount: '10',
    });
    expect(res.status).toBe(400);
  });

  test('propagates insufficient balance error', async () => {
    const { issuer, recipient } = await makeIssuancePair(stellar);
    await stellar.issueAsset(issuer.secretKey, 'BURN', '10', recipient.publicKey);

    const res = await request(app).post('/assets/burn').send({
      holderSecret: recipient.secretKey,
      assetCode: 'BURN',
      issuerPublic: issuer.publicKey,
      amount: '999',
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. GET /assets/:code/holders
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /assets/:code/holders', () => {
  let app, stellar;

  beforeEach(() => {
    stellar = makeStellar();
    app = makeApp(stellar);
    Database.query.mockResolvedValue([
      { holderPublicKey: 'GHOLDER1', balance: '100.0000000', updatedAt: new Date().toISOString() },
      { holderPublicKey: 'GHOLDER2', balance: '50.0000000', updatedAt: new Date().toISOString() },
    ]);
  });

  afterEach(() => jest.clearAllMocks());

  test('200 returns holder list', async () => {
    const res = await request(app).get('/assets/DONATE/holders?issuer=GISSUER');
    expect(res.status).toBe(200);
    expect(res.body.data.holders).toHaveLength(2);
    expect(res.body.data.assetCode).toBe('DONATE');
    expect(res.body.data.count).toBe(2);
  });

  test('400 when issuer query param is missing', async () => {
    const res = await request(app).get('/assets/DONATE/holders');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/issuer/i);
  });

  test('400 for invalid asset code', async () => {
    const res = await request(app).get('/assets/TOOLONGCODE123/holders?issuer=GISSUER');
    expect(res.status).toBe(400);
  });

  test('200 with empty holders list', async () => {
    Database.query.mockResolvedValue([]);
    const res = await request(app).get('/assets/EMPTY/holders?issuer=GISSUER');
    expect(res.status).toBe(200);
    expect(res.body.data.holders).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. GET /assets/:code/metadata
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /assets/:code/metadata', () => {
  let app, stellar;

  beforeEach(() => {
    stellar = makeStellar();
    app = makeApp(stellar);
  });

  afterEach(() => jest.clearAllMocks());

  test('200 returns asset metadata', async () => {
    Database.get.mockResolvedValue({
      id: 1, assetCode: 'CERT', issuerPublicKey: 'GISSUER',
      name: 'Impact Certificate', description: 'Proof of donation',
      iconUrl: 'https://example.com/icon.png',
      totalIssued: '1000.0000000', totalBurned: '0.0000000',
    });
    const res = await request(app).get('/assets/CERT/metadata?issuer=GISSUER');
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Impact Certificate');
    expect(res.body.data.totalIssued).toBe('1000.0000000');
  });

  test('404 when asset not found', async () => {
    Database.get.mockResolvedValue(null);
    const res = await request(app).get('/assets/UNKNOWN/metadata?issuer=GISSUER');
    expect(res.status).toBe(404);
  });

  test('400 when issuer is missing', async () => {
    const res = await request(app).get('/assets/CERT/metadata');
    expect(res.status).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 10. PUT /assets/:code/metadata
// ═════════════════════════════════════════════════════════════════════════════

describe('PUT /assets/:code/metadata', () => {
  let app, stellar;

  beforeEach(() => {
    stellar = makeStellar();
    app = makeApp(stellar);
    Database.run.mockResolvedValue({ id: 1, changes: 1 });
  });

  afterEach(() => jest.clearAllMocks());

  test('200 creates new metadata', async () => {
    Database.get.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 1, assetCode: 'CERT', issuerPublicKey: 'GISSUER',
      name: 'Impact Cert', description: 'Proof', iconUrl: null,
      totalIssued: '0.0000000', totalBurned: '0.0000000',
    });
    const res = await request(app).put('/assets/CERT/metadata').send({
      issuerPublic: 'GISSUER', name: 'Impact Cert', description: 'Proof',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Impact Cert');
  });

  test('200 updates existing metadata', async () => {
    Database.get.mockResolvedValueOnce({ id: 1 }).mockResolvedValueOnce({
      id: 1, assetCode: 'CERT', issuerPublicKey: 'GISSUER',
      name: 'Updated', description: 'New desc', iconUrl: 'https://icon.url',
      totalIssued: '500.0000000', totalBurned: '0.0000000',
    });
    const res = await request(app).put('/assets/CERT/metadata').send({
      issuerPublic: 'GISSUER', name: 'Updated', description: 'New desc',
      iconUrl: 'https://icon.url',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Updated');
  });

  test('400 when issuerPublic is missing', async () => {
    const res = await request(app).put('/assets/CERT/metadata').send({ name: 'Test' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/issuerPublic/i);
  });

  test('400 for invalid asset code', async () => {
    const res = await request(app).put('/assets/TOOLONGCODE123/metadata').send({
      issuerPublic: 'GISSUER', name: 'Test',
    });
    expect(res.status).toBe(400);
  });
});
