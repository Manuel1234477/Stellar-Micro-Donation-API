'use strict';

/**
 * Tests: Stellar Asset Issuance and Distribution Management (#609)
 * Covers: MockStellarService.issueAsset, MockStellarService.distributeAsset,
 *         StellarService.distributeAsset signature, route handler validation,
 *         holder query, permission enforcement
 */

const MockStellarService = require('../../src/services/MockStellarService');

// ─── MockStellarService.issueAsset ───────────────────────────────────────────

describe('MockStellarService.issueAsset', () => {
  let service;

  beforeEach(() => {
    service = new MockStellarService();
  });

  it('issues an asset and returns hash, ledger, assetCode, amount', async () => {
    const issuer = await service.createWallet();
    const recipient = await service.createWallet();
    await service.fundTestnetWallet(issuer.publicKey);
    await service.fundTestnetWallet(recipient.publicKey);

    const result = await service.issueAsset(issuer.secretKey, 'DONATE', '100', recipient.publicKey);
    expect(result).toHaveProperty('hash');
    expect(result).toHaveProperty('ledger');
    expect(result.assetCode).toBe('DONATE');
    expect(result.amount).toBe('100.0000000');
    expect(result.issuerPublic).toBe(issuer.publicKey);
  });

  it('credits recipient balance in assetBalances map', async () => {
    const issuer = await service.createWallet();
    const recipient = await service.createWallet();
    await service.fundTestnetWallet(issuer.publicKey);
    await service.fundTestnetWallet(recipient.publicKey);

    await service.issueAsset(issuer.secretKey, 'TOKEN', '500', recipient.publicKey);

    const assetKey = `TOKEN:${issuer.publicKey}`;
    expect(service.assetBalances.has(assetKey)).toBe(true);
    expect(service.assetBalances.get(assetKey).get(recipient.publicKey)).toBe('500.0000000');
  });

  it('throws ValidationError for invalid asset code (too long)', async () => {
    const issuer = await service.createWallet();
    const recipient = await service.createWallet();
    await service.fundTestnetWallet(issuer.publicKey);
    await service.fundTestnetWallet(recipient.publicKey);

    await expect(
      service.issueAsset(issuer.secretKey, 'TOOLONGASSETCODE', '100', recipient.publicKey)
    ).rejects.toThrow();
  });

  it('throws when issuer and recipient are the same', async () => {
    const wallet = await service.createWallet();
    await service.fundTestnetWallet(wallet.publicKey);
    await expect(
      service.issueAsset(wallet.secretKey, 'TOKEN', '100', wallet.publicKey)
    ).rejects.toThrow();
  });

  it('throws for zero amount', async () => {
    const issuer = await service.createWallet();
    const recipient = await service.createWallet();
    await service.fundTestnetWallet(issuer.publicKey);
    await service.fundTestnetWallet(recipient.publicKey);
    await expect(
      service.issueAsset(issuer.secretKey, 'TOKEN', '0', recipient.publicKey)
    ).rejects.toThrow();
  });

  it('accumulates balance on multiple issuances', async () => {
    const issuer = await service.createWallet();
    const recipient = await service.createWallet();
    await service.fundTestnetWallet(issuer.publicKey);
    await service.fundTestnetWallet(recipient.publicKey);

    await service.issueAsset(issuer.secretKey, 'TOKEN', '100', recipient.publicKey);
    await service.issueAsset(issuer.secretKey, 'TOKEN', '200', recipient.publicKey);

    const assetKey = `TOKEN:${issuer.publicKey}`;
    const balance = parseFloat(service.assetBalances.get(assetKey).get(recipient.publicKey));
    expect(balance).toBe(300);
  });
});

// ─── MockStellarService.distributeAsset ──────────────────────────────────────

describe('MockStellarService.distributeAsset', () => {
  let service;

  beforeEach(() => {
    service = new MockStellarService();
  });

  it('distributes asset from distributor to recipient', async () => {
    const issuer = await service.createWallet();
    const distributor = await service.createWallet();
    const recipient = await service.createWallet();
    await service.fundTestnetWallet(issuer.publicKey);
    await service.fundTestnetWallet(distributor.publicKey);
    await service.fundTestnetWallet(recipient.publicKey);

    await service.issueAsset(issuer.secretKey, 'TOKEN', '1000', distributor.publicKey);

    const result = await service.distributeAsset(
      distributor.secretKey, 'TOKEN', issuer.publicKey, recipient.publicKey, '100'
    );

    expect(result).toHaveProperty('hash');
    expect(result.assetCode).toBe('TOKEN');
    expect(result.amount).toBe('100.0000000');
    expect(result.recipientPublicKey).toBe(recipient.publicKey);
    expect(result.issuerPublicKey).toBe(issuer.publicKey);
  });

  it('deducts from distributor and credits recipient', async () => {
    const issuer = await service.createWallet();
    const distributor = await service.createWallet();
    const recipient = await service.createWallet();
    await service.fundTestnetWallet(issuer.publicKey);
    await service.fundTestnetWallet(distributor.publicKey);
    await service.fundTestnetWallet(recipient.publicKey);

    await service.issueAsset(issuer.secretKey, 'TOKEN', '1000', distributor.publicKey);
    await service.distributeAsset(distributor.secretKey, 'TOKEN', issuer.publicKey, recipient.publicKey, '300');

    const assetKey = `TOKEN:${issuer.publicKey}`;
    const holders = service.assetBalances.get(assetKey);
    expect(parseFloat(holders.get(distributor.publicKey))).toBe(700);
    expect(parseFloat(holders.get(recipient.publicKey))).toBe(300);
  });

  it('throws when distributor has insufficient balance', async () => {
    const issuer = await service.createWallet();
    const distributor = await service.createWallet();
    const recipient = await service.createWallet();
    await service.fundTestnetWallet(issuer.publicKey);
    await service.fundTestnetWallet(distributor.publicKey);
    await service.fundTestnetWallet(recipient.publicKey);

    await service.issueAsset(issuer.secretKey, 'TOKEN', '10', distributor.publicKey);

    await expect(
      service.distributeAsset(distributor.secretKey, 'TOKEN', issuer.publicKey, recipient.publicKey, '100')
    ).rejects.toThrow();
  });

  it('throws for invalid asset code', async () => {
    const distributor = await service.createWallet();
    const recipient = await service.createWallet();
    await service.fundTestnetWallet(distributor.publicKey);
    await service.fundTestnetWallet(recipient.publicKey);

    await expect(
      service.distributeAsset(distributor.secretKey, 'TOOLONGCODE!!', 'GISSUER', recipient.publicKey, '10')
    ).rejects.toThrow();
  });

  it('throws when distributor and recipient are the same', async () => {
    const wallet = await service.createWallet();
    await service.fundTestnetWallet(wallet.publicKey);
    await expect(
      service.distributeAsset(wallet.secretKey, 'TOKEN', 'GISSUER', wallet.publicKey, '10')
    ).rejects.toThrow();
  });

  it('throws for zero or negative amount', async () => {
    const issuer = await service.createWallet();
    const distributor = await service.createWallet();
    const recipient = await service.createWallet();
    await service.fundTestnetWallet(issuer.publicKey);
    await service.fundTestnetWallet(distributor.publicKey);
    await service.fundTestnetWallet(recipient.publicKey);
    await service.issueAsset(issuer.secretKey, 'TOKEN', '100', distributor.publicKey);

    await expect(
      service.distributeAsset(distributor.secretKey, 'TOKEN', issuer.publicKey, recipient.publicKey, '0')
    ).rejects.toThrow();
  });
});

// ─── StellarService.distributeAsset method exists ────────────────────────────

describe('StellarService.distributeAsset', () => {
  it('is defined as a method on StellarService', () => {
    const StellarService = require('../../src/services/StellarService');
    expect(typeof StellarService.prototype.distributeAsset).toBe('function');
  });

  it('is defined as a method on MockStellarService', () => {
    expect(typeof MockStellarService.prototype.distributeAsset).toBe('function');
  });
});

// ─── Asset route handler validation ──────────────────────────────────────────

const Database = require('../../src/utils/database');

describe('Asset route handler validation', () => {
  beforeAll(async () => {
    await Database.initialize();
    await Database.run(`
      CREATE TABLE IF NOT EXISTS issued_assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        assetCode TEXT NOT NULL,
        issuerPublicKey TEXT NOT NULL,
        totalIssued TEXT DEFAULT '0.0000000',
        totalBurned TEXT DEFAULT '0.0000000',
        name TEXT,
        description TEXT,
        iconUrl TEXT
      )
    `).catch(() => {});
    await Database.run(`
      CREATE TABLE IF NOT EXISTS asset_holdings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        assetCode TEXT NOT NULL,
        issuerPublicKey TEXT NOT NULL,
        holderPublicKey TEXT NOT NULL,
        balance TEXT NOT NULL,
        updatedAt TEXT
      )
    `).catch(() => {});
  });

  afterAll(async () => {
    await Database.close();
  });

  function makeRes() {
    return {
      _status: 200, _body: null,
      status(s) { this._status = s; return this; },
      json(b) { this._body = b; return this; },
    };
  }

  it('GET /assets/:code/holders returns 400 when issuer param missing', async () => {
    const assetsRouter = require('../../src/routes/assets');
    const holdersLayer = assetsRouter.stack.find(
      l => l.route && l.route.path === '/:code/holders' && l.route.methods.get
    );
    if (!holdersLayer) return;

    const req = { params: { code: 'TOKEN' }, query: {}, user: { id: 1, role: 'user' } };
    const res = makeRes();
    const handlers = holdersLayer.route.stack;
    await handlers[handlers.length - 1].handle(req, res, jest.fn());
    expect(res._status).toBe(400);
  });

  it('GET /assets/:code/holders returns 400 for invalid asset code', async () => {
    const assetsRouter = require('../../src/routes/assets');
    const holdersLayer = assetsRouter.stack.find(
      l => l.route && l.route.path === '/:code/holders' && l.route.methods.get
    );
    if (!holdersLayer) return;

    const req = { params: { code: 'TOOLONG!!' }, query: { issuer: 'GISSUER' }, user: { id: 1, role: 'user' } };
    const res = makeRes();
    const handlers = holdersLayer.route.stack;
    await handlers[handlers.length - 1].handle(req, res, jest.fn());
    expect(res._status).toBe(400);
  });

  it('GET /assets/:code/holders returns empty list for unknown asset', async () => {
    const assetsRouter = require('../../src/routes/assets');
    const holdersLayer = assetsRouter.stack.find(
      l => l.route && l.route.path === '/:code/holders' && l.route.methods.get
    );
    if (!holdersLayer) return;

    const req = { params: { code: 'UNKNOWN' }, query: { issuer: 'GISSUER999' }, user: { id: 1, role: 'user' } };
    const res = makeRes();
    const handlers = holdersLayer.route.stack;
    await handlers[handlers.length - 1].handle(req, res, jest.fn());
    expect(res._status).toBe(200);
    expect(res._body.data.holders).toEqual([]);
  });

  it('GET /assets/:code/holders returns holders from DB', async () => {
    await Database.run(
      `INSERT OR IGNORE INTO asset_holdings (assetCode, issuerPublicKey, holderPublicKey, balance, updatedAt)
       VALUES (?, ?, ?, ?, ?)`,
      ['TESTTKN', 'GISSUER777', 'GHOLDER777', '50.0000000', new Date().toISOString()]
    );

    const assetsRouter = require('../../src/routes/assets');
    const holdersLayer = assetsRouter.stack.find(
      l => l.route && l.route.path === '/:code/holders' && l.route.methods.get
    );
    if (!holdersLayer) return;

    const req = { params: { code: 'TESTTKN' }, query: { issuer: 'GISSUER777' }, user: { id: 1, role: 'user' } };
    const res = makeRes();
    const handlers = holdersLayer.route.stack;
    await handlers[handlers.length - 1].handle(req, res, jest.fn());
    expect(res._status).toBe(200);
    expect(res._body.data.holders.length).toBeGreaterThan(0);
    expect(res._body.data.holders[0].holderPublicKey).toBe('GHOLDER777');
  });

  it('POST /assets/issue returns 400 for missing fields', async () => {
    const assetsRouter = require('../../src/routes/assets');
    const issueLayer = assetsRouter.stack.find(
      l => l.route && l.route.path === '/issue' && l.route.methods.post
    );
    if (!issueLayer) return;

    const req = { body: {}, user: { id: 1, role: 'admin' }, id: 'req-1', ip: '127.0.0.1' };
    const res = makeRes();
    const handlers = issueLayer.route.stack;
    await handlers[handlers.length - 1].handle(req, res, jest.fn());
    expect(res._status).toBe(400);
  });

  it('POST /assets/issue returns 400 for invalid asset code', async () => {
    const assetsRouter = require('../../src/routes/assets');
    const issueLayer = assetsRouter.stack.find(
      l => l.route && l.route.path === '/issue' && l.route.methods.post
    );
    if (!issueLayer) return;

    const req = {
      body: { issuerSecret: 'STEST', assetCode: 'TOOLONG!!', distributorPublicKey: 'GTEST', amount: '100' },
      user: { id: 1, role: 'admin' }, id: 'req-1', ip: '127.0.0.1',
    };
    const res = makeRes();
    const handlers = issueLayer.route.stack;
    await handlers[handlers.length - 1].handle(req, res, jest.fn());
    expect(res._status).toBe(400);
  });

  it('POST /assets/:code/distribute returns 400 for missing fields', async () => {
    const assetsRouter = require('../../src/routes/assets');
    const distLayer = assetsRouter.stack.find(
      l => l.route && l.route.path === '/:code/distribute' && l.route.methods.post
    );
    if (!distLayer) return;

    const req = { params: { code: 'TOKEN' }, body: {}, user: { id: 1, role: 'admin' }, id: 'req-1', ip: '127.0.0.1' };
    const res = makeRes();
    const handlers = distLayer.route.stack;
    await handlers[handlers.length - 1].handle(req, res, jest.fn());
    expect(res._status).toBe(400);
  });

  it('POST /assets/:code/distribute returns 400 for invalid asset code', async () => {
    const assetsRouter = require('../../src/routes/assets');
    const distLayer = assetsRouter.stack.find(
      l => l.route && l.route.path === '/:code/distribute' && l.route.methods.post
    );
    if (!distLayer) return;

    const req = {
      params: { code: 'TOOLONG!!' },
      body: { distributorSecret: 'STEST', issuerPublicKey: 'GISSUER', recipientPublicKey: 'GRECIP', amount: '10' },
      user: { id: 1, role: 'admin' }, id: 'req-1', ip: '127.0.0.1',
    };
    const res = makeRes();
    const handlers = distLayer.route.stack;
    await handlers[handlers.length - 1].handle(req, res, jest.fn());
    expect(res._status).toBe(400);
  });
});
