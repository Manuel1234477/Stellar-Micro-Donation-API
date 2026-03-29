/**
 * Cross-Asset Donations Tests
 * Tests for pathPaymentStrictSend, pathPaymentStrictReceive, findPaymentPaths,
 * POST /donations/cross-asset, and GET /donations/cross-asset/paths.
 */

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-key-1';

const request = require('supertest');
const express = require('express');
const donationRouter = require('../../src/routes/donation');
const Transaction = require('../../src/routes/models/transaction');
const { getStellarService } = require('../../src/config/stellar');
const { attachUserRole } = require('../../src/middleware/rbac');
const { resetMockStellarService } = require('../helpers/testIsolation');

// ─── Test App ─────────────────────────────────────────────────────────────────

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(attachUserRole());
  app.use('/donations', donationRouter);
  app.use((err, req, res, next) => {
    void next;
    res.status(err.status || err.statusCode || 500).json({
      success: false,
      error: { code: err.code || 'INTERNAL_ERROR', message: err.message || 'Internal server error' },
    });
  });
  return app;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const USDC_ASSET = { code: 'USDC', issuer: USDC_ISSUER };
const NATIVE_ASSET = 'native';

let idempotencyCounter = 0;
function nextKey() {
  return `cross-asset-idem-${++idempotencyCounter}-${Date.now()}`;
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('Cross-Asset Donations', () => {
  let app;
  let stellarService;
  let donor;
  let recipient;

  beforeAll(async () => {
    app = createTestApp();
    stellarService = getStellarService();

    donor = await stellarService.createWallet();
    recipient = await stellarService.createWallet();

    await stellarService.fundTestnetWallet(donor.publicKey);
    await stellarService.fundTestnetWallet(recipient.publicKey);

    // Give donor some USDC balance so strict-receive tests can debit it
    const donorWallet = stellarService.wallets.get(donor.publicKey);
    if (donorWallet) {
      if (!donorWallet.assetBalances) donorWallet.assetBalances = { native: donorWallet.balance || '10000.0000000' };
      donorWallet.assetBalances[`USDC:${USDC_ISSUER}`] = '5000.0000000';
    }
  });

  beforeEach(() => {
    Transaction._clearAllData();
    stellarService.disableFailureSimulation();
  });

  afterEach(() => {
    Transaction._clearAllData();
    stellarService.disableFailureSimulation();
  });

  afterAll(() => {
    resetMockStellarService(stellarService);
  });

  // ─── MockStellarService unit tests ──────────────────────────────────────────

  describe('MockStellarService.pathPaymentStrictSend()', () => {
    test('sends XLM and receives USDC (cross-asset)', async () => {
      const result = await stellarService.pathPaymentStrictSend(
        donor.secretKey,
        { type: 'native', code: 'XLM', issuer: null },
        '100',
        recipient.publicKey,
        { type: 'credit_alphanum', code: 'USDC', issuer: USDC_ISSUER },
        '1',   // very low floor — should always pass
      );

      expect(result.transactionId).toBeDefined();
      expect(result.ledger).toBeGreaterThan(0);
      expect(result.sourceAmount).toBe('100');
      expect(parseFloat(result.destAmount)).toBeGreaterThan(0);
    });

    test('returns destAmount >= minDestAmount', async () => {
      const result = await stellarService.pathPaymentStrictSend(
        donor.secretKey,
        { type: 'native', code: 'XLM', issuer: null },
        '50',
        recipient.publicKey,
        { type: 'credit_alphanum', code: 'USDC', issuer: USDC_ISSUER },
        '1',
      );
      expect(parseFloat(result.destAmount)).toBeGreaterThanOrEqual(1);
    });

    test('throws when slippage floor cannot be met', async () => {
      await expect(
        stellarService.pathPaymentStrictSend(
          donor.secretKey,
          { type: 'native', code: 'XLM', issuer: null },
          '10',
          recipient.publicKey,
          { type: 'credit_alphanum', code: 'USDC', issuer: USDC_ISSUER },
          '999999', // impossibly high floor
        )
      ).rejects.toThrow(/slippage tolerance exceeded/i);
    });

    test('throws when no path exists (no_path simulation)', async () => {
      stellarService.enableFailureSimulation('no_path', 1.0);
      await expect(
        stellarService.pathPaymentStrictSend(
          donor.secretKey,
          { type: 'native', code: 'XLM', issuer: null },
          '10',
          recipient.publicKey,
          { type: 'credit_alphanum', code: 'USDC', issuer: USDC_ISSUER },
          '1',
        )
      ).rejects.toThrow(/no payment path/i);
    });

    test('accepts optional memo', async () => {
      const result = await stellarService.pathPaymentStrictSend(
        donor.secretKey,
        { type: 'native', code: 'XLM', issuer: null },
        '10',
        recipient.publicKey,
        { type: 'credit_alphanum', code: 'USDC', issuer: USDC_ISSUER },
        '1',
        { memo: 'test memo' },
      );
      expect(result.transactionId).toBeDefined();
    });
  });

  describe('MockStellarService.pathPaymentStrictReceive()', () => {
    test('delivers exact destAmount of USDC from XLM', async () => {
      const result = await stellarService.pathPaymentStrictReceive(
        donor.secretKey,
        { type: 'native', code: 'XLM', issuer: null },
        '999',  // generous ceiling
        recipient.publicKey,
        { type: 'credit_alphanum', code: 'USDC', issuer: USDC_ISSUER },
        '10',
      );

      expect(result.transactionId).toBeDefined();
      expect(result.destAmount).toBe('10');
      expect(parseFloat(result.sourceAmount)).toBeGreaterThan(0);
    });

    test('throws when required source exceeds maxSendAmount', async () => {
      await expect(
        stellarService.pathPaymentStrictReceive(
          donor.secretKey,
          { type: 'native', code: 'XLM', issuer: null },
          '0.0000001', // impossibly tight ceiling
          recipient.publicKey,
          { type: 'credit_alphanum', code: 'USDC', issuer: USDC_ISSUER },
          '1000',
        )
      ).rejects.toThrow(/slippage tolerance exceeded/i);
    });

    test('throws when no path exists (no_path simulation)', async () => {
      stellarService.enableFailureSimulation('no_path', 1.0);
      await expect(
        stellarService.pathPaymentStrictReceive(
          donor.secretKey,
          { type: 'native', code: 'XLM', issuer: null },
          '999',
          recipient.publicKey,
          { type: 'credit_alphanum', code: 'USDC', issuer: USDC_ISSUER },
          '10',
        )
      ).rejects.toThrow(/no payment path/i);
    });

    test('USDC → XLM strict-receive', async () => {
      const result = await stellarService.pathPaymentStrictReceive(
        donor.secretKey,
        { type: 'credit_alphanum', code: 'USDC', issuer: USDC_ISSUER },
        '999',
        recipient.publicKey,
        { type: 'native', code: 'XLM', issuer: null },
        '5',
      );
      expect(result.destAmount).toBe('5');
    });
  });

  describe('MockStellarService.findPaymentPaths()', () => {
    test('returns paths for a funded account', async () => {
      const paths = await stellarService.findPaymentPaths(
        donor.publicKey,
        recipient.publicKey,
        { type: 'credit_alphanum', code: 'USDC', issuer: USDC_ISSUER },
        '10',
      );
      expect(Array.isArray(paths)).toBe(true);
      expect(paths.length).toBeGreaterThan(0);
      expect(paths[0]).toHaveProperty('sourceAsset');
      expect(paths[0]).toHaveProperty('destAsset');
      expect(paths[0]).toHaveProperty('conversionRate');
    });

    test('returns empty array when no_path simulation is active', async () => {
      stellarService.enableFailureSimulation('no_path', 1.0);
      const paths = await stellarService.findPaymentPaths(
        donor.publicKey,
        recipient.publicKey,
        { type: 'credit_alphanum', code: 'USDC', issuer: USDC_ISSUER },
        '10',
      );
      expect(paths).toEqual([]);
    });

    test('throws for unknown source account', async () => {
      await expect(
        stellarService.findPaymentPaths(
          'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
          recipient.publicKey,
          { type: 'native', code: 'XLM', issuer: null },
          '10',
        )
      ).rejects.toThrow();
    });

    test('excludes same-asset paths', async () => {
      const paths = await stellarService.findPaymentPaths(
        donor.publicKey,
        recipient.publicKey,
        { type: 'native', code: 'XLM', issuer: null },
        '10',
      );
      // All returned paths must have a different source asset than XLM native
      for (const p of paths) {
        expect(p.sourceAsset.type).not.toBe('native');
      }
    });
  });

  // ─── POST /donations/cross-asset ────────────────────────────────────────────

  describe('POST /donations/cross-asset', () => {
    describe('strict-send', () => {
      test('201 with valid strict-send payload', async () => {
        const res = await request(app)
          .post('/donations/cross-asset')
          .set('X-API-Key', 'test-key-1')
          .set('X-Idempotency-Key', nextKey())
          .send({
            sourceSecret: donor.secretKey,
            sendAsset: 'native',
            sendAmount: '50',
            destPublicKey: recipient.publicKey,
            destAsset: JSON.stringify(USDC_ASSET),
            slippageTolerance: 0.05,
          });

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.data.transactionId).toBeDefined();
        expect(res.body.data.sourceAmount).toBe('50');
      });

      test('400 when no path found (strict-send)', async () => {
        stellarService.enableFailureSimulation('no_path', 1.0);
        const res = await request(app)
          .post('/donations/cross-asset')
          .set('X-API-Key', 'test-key-1')
          .set('X-Idempotency-Key', nextKey())
          .send({
            sourceSecret: donor.secretKey,
            sendAsset: 'native',
            sendAmount: '10',
            destPublicKey: recipient.publicKey,
            destAsset: JSON.stringify(USDC_ASSET),
          });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('NO_PATH_FOUND');
      });

      test('400 when slippage exceeded (strict-send)', async () => {
        // Use 0% tolerance so any conversion fails
        const res = await request(app)
          .post('/donations/cross-asset')
          .set('X-API-Key', 'test-key-1')
          .set('X-Idempotency-Key', nextKey())
          .send({
            sourceSecret: donor.secretKey,
            sendAsset: 'native',
            sendAmount: '10',
            destPublicKey: recipient.publicKey,
            destAsset: JSON.stringify(USDC_ASSET),
            slippageTolerance: -0.9999, // forces minDestAmount > route.destAmount
          });

        // schema rejects negative slippage
        expect([400, 422]).toContain(res.status);
      });
    });

    describe('strict-receive', () => {
      test('201 with valid strict-receive payload', async () => {
        const res = await request(app)
          .post('/donations/cross-asset')
          .set('X-API-Key', 'test-key-1')
          .set('X-Idempotency-Key', nextKey())
          .send({
            sourceSecret: donor.secretKey,
            sendAsset: 'native',
            destPublicKey: recipient.publicKey,
            destAsset: JSON.stringify(USDC_ASSET),
            destAmount: '5',
            slippageTolerance: 0.1,
          });

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.data.destAmount).toBe('5');
      });

      test('400 when no path found (strict-receive)', async () => {
        stellarService.enableFailureSimulation('no_path', 1.0);
        const res = await request(app)
          .post('/donations/cross-asset')
          .set('X-API-Key', 'test-key-1')
          .set('X-Idempotency-Key', nextKey())
          .send({
            sourceSecret: donor.secretKey,
            sendAsset: 'native',
            destPublicKey: recipient.publicKey,
            destAsset: JSON.stringify(USDC_ASSET),
            destAmount: '5',
          });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('NO_PATH_FOUND');
      });
    });

    describe('validation', () => {
      test('400 when neither sendAmount nor destAmount provided', async () => {
        const res = await request(app)
          .post('/donations/cross-asset')
          .set('X-API-Key', 'test-key-1')
          .set('X-Idempotency-Key', nextKey())
          .send({
            sourceSecret: donor.secretKey,
            sendAsset: 'native',
            destPublicKey: recipient.publicKey,
            destAsset: JSON.stringify(USDC_ASSET),
          });

        expect(res.status).toBe(400);
      });

      test('400 when both sendAmount and destAmount provided', async () => {
        const res = await request(app)
          .post('/donations/cross-asset')
          .set('X-API-Key', 'test-key-1')
          .set('X-Idempotency-Key', nextKey())
          .send({
            sourceSecret: donor.secretKey,
            sendAsset: 'native',
            sendAmount: '10',
            destPublicKey: recipient.publicKey,
            destAsset: JSON.stringify(USDC_ASSET),
            destAmount: '5',
          });

        expect(res.status).toBe(400);
      });

      test('400 when slippageTolerance is out of range', async () => {
        const res = await request(app)
          .post('/donations/cross-asset')
          .set('X-API-Key', 'test-key-1')
          .set('X-Idempotency-Key', nextKey())
          .send({
            sourceSecret: donor.secretKey,
            sendAsset: 'native',
            sendAmount: '10',
            destPublicKey: recipient.publicKey,
            destAsset: JSON.stringify(USDC_ASSET),
            slippageTolerance: 1.5,
          });

        expect(res.status).toBe(400);
      });

      test('401 without API key', async () => {
        const res = await request(app)
          .post('/donations/cross-asset')
          .set('X-Idempotency-Key', nextKey())
          .send({
            sourceSecret: donor.secretKey,
            sendAsset: 'native',
            sendAmount: '10',
            destPublicKey: recipient.publicKey,
            destAsset: JSON.stringify(USDC_ASSET),
          });

        expect(res.status).toBe(401);
      });

      test('400 when sendAsset is invalid', async () => {
        const res = await request(app)
          .post('/donations/cross-asset')
          .set('X-API-Key', 'test-key-1')
          .set('X-Idempotency-Key', nextKey())
          .send({
            sourceSecret: donor.secretKey,
            sendAsset: 'not-an-asset',
            sendAmount: '10',
            destPublicKey: recipient.publicKey,
            destAsset: JSON.stringify(USDC_ASSET),
          });

        expect(res.status).toBe(400);
      });
    });

    describe('idempotency', () => {
      test('returns same response for duplicate idempotency key', async () => {
        const key = nextKey();
        const payload = {
          sourceSecret: donor.secretKey,
          sendAsset: 'native',
          sendAmount: '5',
          destPublicKey: recipient.publicKey,
          destAsset: JSON.stringify(USDC_ASSET),
        };

        const first = await request(app)
          .post('/donations/cross-asset')
          .set('X-API-Key', 'test-key-1')
          .set('X-Idempotency-Key', key)
          .send(payload);

        const second = await request(app)
          .post('/donations/cross-asset')
          .set('X-API-Key', 'test-key-1')
          .set('X-Idempotency-Key', key)
          .send(payload);

        expect(first.status).toBe(201);
        expect(second.status).toBe(201);
        expect(second.body.data.transactionId).toBe(first.body.data.transactionId);
      });
    });
  });

  // ─── GET /donations/cross-asset/paths ───────────────────────────────────────

  describe('GET /donations/cross-asset/paths', () => {
    test('200 with available paths', async () => {
      const res = await request(app)
        .get('/donations/cross-asset/paths')
        .set('X-API-Key', 'test-key-1')
        .query({
          sourcePublicKey: donor.publicKey,
          destPublicKey: recipient.publicKey,
          destAsset: JSON.stringify(USDC_ASSET),
          destAmount: '10',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.paths)).toBe(true);
      expect(res.body.data.paths.length).toBeGreaterThan(0);

      const path = res.body.data.paths[0];
      expect(path).toHaveProperty('sourceAsset');
      expect(path).toHaveProperty('destAsset');
      expect(path).toHaveProperty('conversionRate');
      expect(path).toHaveProperty('sourceAmount');
      expect(path).toHaveProperty('destAmount');
    });

    test('400 when no paths available', async () => {
      stellarService.enableFailureSimulation('no_path', 1.0);
      const res = await request(app)
        .get('/donations/cross-asset/paths')
        .set('X-API-Key', 'test-key-1')
        .query({
          sourcePublicKey: donor.publicKey,
          destPublicKey: recipient.publicKey,
          destAsset: JSON.stringify(USDC_ASSET),
          destAmount: '10',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('NO_PATH_FOUND');
    });

    test('401 without API key', async () => {
      const res = await request(app)
        .get('/donations/cross-asset/paths')
        .query({
          sourcePublicKey: donor.publicKey,
          destPublicKey: recipient.publicKey,
          destAsset: JSON.stringify(USDC_ASSET),
          destAmount: '10',
        });

      expect(res.status).toBe(401);
    });

    test('400 when required query params missing', async () => {
      const res = await request(app)
        .get('/donations/cross-asset/paths')
        .set('X-API-Key', 'test-key-1')
        .query({ sourcePublicKey: donor.publicKey });

      expect(res.status).toBe(400);
    });

    test('400 when destAsset is invalid JSON', async () => {
      const res = await request(app)
        .get('/donations/cross-asset/paths')
        .set('X-API-Key', 'test-key-1')
        .query({
          sourcePublicKey: donor.publicKey,
          destPublicKey: recipient.publicKey,
          destAsset: 'not-valid',
          destAmount: '10',
        });

      expect(res.status).toBe(400);
    });

    test('native destAsset returns paths', async () => {
      const res = await request(app)
        .get('/donations/cross-asset/paths')
        .set('X-API-Key', 'test-key-1')
        .query({
          sourcePublicKey: donor.publicKey,
          destPublicKey: recipient.publicKey,
          destAsset: 'native',
          destAmount: '5',
        });

      // Donor has USDC, so there should be a USDC→XLM path
      expect(res.status).toBe(200);
      expect(res.body.data.paths.length).toBeGreaterThan(0);
    });
  });
});
