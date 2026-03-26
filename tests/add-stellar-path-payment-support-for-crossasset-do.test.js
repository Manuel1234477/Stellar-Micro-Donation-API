process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-key-1';
process.env.DB_JSON_PATH = require('path').join(__dirname, 'tmp-cross-asset-donations.json');

const fs = require('fs');
const express = require('express');
const request = require('supertest');
const StellarSdk = require('stellar-sdk');

const donationRouter = require('../src/routes/donation');
const Transaction = require('../src/routes/models/transaction');
const { attachUserRole } = require('../src/middleware/rbac');
const { getStellarService } = require('../src/config/stellar');
const { resetMockStellarService } = require('./helpers/testIsolation');

function createUsdAsset(issuer) {
  return {
    type: 'credit_alphanum',
    code: 'USD',
    issuer,
  };
}

function createIssuerPublicKey() {
  return StellarSdk.Keypair.random().publicKey();
}

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(attachUserRole());
  app.use('/donations', donationRouter);
  app.use((err, req, res, next) => {
    void next;
    res.status(err.statusCode || err.status || 500).json(
      err.toJSON ? err.toJSON() : {
        success: false,
        error: {
          code: err.code || 'INTERNAL_ERROR',
          message: err.message || 'Internal server error',
        },
      }
    );
  });
  return app;
}

function uniqueKey(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe('Cross-asset Stellar donation support', () => {
  let app;
  let stellarService;
  let donor;
  let recipient;

  beforeAll(async () => {
    app = createTestApp();
    stellarService = getStellarService();
  });

  beforeEach(async () => {
    Transaction._clearAllData();
    resetMockStellarService(stellarService);
    donor = await stellarService.createWallet();
    recipient = await stellarService.createWallet();
    await stellarService.fundTestnetWallet(donor.publicKey);
    await stellarService.fundTestnetWallet(recipient.publicKey);
  });

  afterEach(() => {
    Transaction._clearAllData();
    resetMockStellarService(stellarService);
    if (fs.existsSync(process.env.DB_JSON_PATH)) {
      fs.unlinkSync(process.env.DB_JSON_PATH);
    }
  });

  afterAll(() => {
    resetMockStellarService(stellarService);
    if (fs.existsSync(process.env.DB_JSON_PATH)) {
      fs.unlinkSync(process.env.DB_JSON_PATH);
    }
  });

  test('GET /donations/path-estimate returns a deterministic path quote', async () => {
    const usdAsset = createUsdAsset(createIssuerPublicKey());
    const response = await request(app)
      .get('/donations/path-estimate')
      .set('X-API-Key', 'test-key-1')
      .query({
        sourceAsset: JSON.stringify(usdAsset),
        sourceAmount: '50',
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.sourceAmount).toBe('50');
    expect(response.body.data.destAsset.code).toBe('XLM');
    expect(response.body.data.path).toEqual([]);
    expect(response.body.data.conversionRate).toBe('0.8000000');
  });

  test('GET /donations/path-estimate rejects malformed asset input', async () => {
    const response = await request(app)
      .get('/donations/path-estimate')
      .set('X-API-Key', 'test-key-1')
      .query({
        sourceAsset: '{"code":"usd"}',
        sourceAmount: '10',
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  test('GET /donations/path-estimate fails safely when no path exists', async () => {
    stellarService.enableFailureSimulation('no_path');
    const usdAsset = createUsdAsset(createIssuerPublicKey());

    const response = await request(app)
      .get('/donations/path-estimate')
      .set('X-API-Key', 'test-key-1')
      .query({
        sourceAsset: JSON.stringify(usdAsset),
        sourceAmount: '10',
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  test('POST /donations executes a cross-asset path payment', async () => {
    const usdAsset = createUsdAsset(createIssuerPublicKey());
    stellarService.setAssetBalance(donor.publicKey, usdAsset, '250');

    const response = await request(app)
      .post('/donations')
      .set('X-API-Key', 'test-key-1')
      .set('X-Idempotency-Key', uniqueKey('cross-asset'))
      .send({
        donor: donor.publicKey,
        recipient: recipient.publicKey,
        amount: '40',
        sourceAsset: usdAsset,
        sourceAmount: '50',
        memo: 'Cross asset donation',
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.transactionHash).toMatch(/^mock_/);

    const [transaction] = Transaction.getAll();
    expect(transaction.paymentMethod).toBe('path');
    expect(transaction.stellarTxId).toMatch(/^mock_/);
    expect(transaction.sourceAsset.code).toBe('USD');
    expect(transaction.destinationAsset.code).toBe('XLM');
    expect(transaction.path).toEqual([]);
  });

  test('POST /donations keeps the standard XLM donation flow working', async () => {
    const response = await request(app)
      .post('/donations')
      .set('X-API-Key', 'test-key-1')
      .set('X-Idempotency-Key', uniqueKey('direct-asset'))
      .send({
        donor: donor.publicKey,
        recipient: recipient.publicKey,
        amount: '15',
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);

    const [transaction] = Transaction.getAll();
    expect(transaction.paymentMethod).toBe('direct');
    expect(transaction.sourceAsset.code).toBe('XLM');
  });

  test('POST /donations falls back to direct payment when explicit same-asset path flow fails', async () => {
    stellarService.enableFailureSimulation('path_payment_failed');

    const response = await request(app)
      .post('/donations')
      .set('X-API-Key', 'test-key-1')
      .set('X-Idempotency-Key', uniqueKey('fallback-direct'))
      .send({
        donor: donor.publicKey,
        recipient: recipient.publicKey,
        amount: '12',
        sourceAsset: 'native',
        sourceAmount: '12',
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);

    const [transaction] = Transaction.getAll();
    expect(transaction.paymentMethod).toBe('direct');
    expect(transaction.fallbackUsed).toBe(true);
  });

  test('POST /donations fails safely when no cross-asset route exists', async () => {
    stellarService.enableFailureSimulation('no_path');
    const usdAsset = createUsdAsset(createIssuerPublicKey());
    stellarService.setAssetBalance(donor.publicKey, usdAsset, '100');

    const response = await request(app)
      .post('/donations')
      .set('X-API-Key', 'test-key-1')
      .set('X-Idempotency-Key', uniqueKey('cross-asset-no-path'))
      .send({
        donor: donor.publicKey,
        recipient: recipient.publicKey,
        amount: '10',
        sourceAsset: usdAsset,
        sourceAmount: '12',
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(Transaction.getAll()).toHaveLength(0);
  });
});
