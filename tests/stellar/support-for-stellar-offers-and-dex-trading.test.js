/**
 * Tests: Stellar Offers and DEX Trading
 *
 * Covers createOffer, cancelOffer, getOrderBook on MockStellarService
 * and all four HTTP endpoints on the offers router.
 * No live Stellar network required.
 */

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-key-dex';

const request = require('supertest');
const express = require('express');
const offersRouter = require('../../src/routes/offers');
const { attachUserRole } = require('../../src/middleware/rbac');
const MockStellarService = require('../../src/services/MockStellarService');

// ─── Helpers ────────────────────────────────────────────────────────────────

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(attachUserRole());
  app.use('/offers', offersRouter);
  app.use((err, req, res, next) => {
    void next;
    res.status(err.status || 500).json({ success: false, error: { code: err.code || 'INTERNAL_ERROR', message: err.message } });
  });
  return app;
}

async function makeWallet(svc) {
  const kp = await svc.createWallet();
  await svc.fundTestnetWallet(kp.publicKey);
  return kp;
}

// ─── MockStellarService unit tests ──────────────────────────────────────────

describe('MockStellarService – DEX methods', () => {
  let svc;
  let seller;
  let buyer;

  beforeEach(async () => {
    svc = new MockStellarService();
    seller = await makeWallet(svc);
    buyer = await makeWallet(svc);
  });

  // createOffer ──────────────────────────────────────────────────────────────

  describe('createOffer', () => {
    test('creates a new offer and returns offerId, transactionId, ledger', async () => {
      const result = await svc.createOffer({
        sourceSecret: seller.secretKey,
        sellingAsset: 'XLM',
        buyingAsset: 'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        amount: '100',
        price: '0.25',
      });

      expect(result.offerId).toBeDefined();
      expect(typeof result.offerId).toBe('number');
      expect(result.transactionId).toMatch(/^[0-9a-f]{64}$/);
      expect(typeof result.ledger).toBe('number');
    });

    test('stores the offer so getOrderBook can find it', async () => {
      const buyingAsset = 'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
      await svc.createOffer({ sourceSecret: seller.secretKey, sellingAsset: 'XLM', buyingAsset, amount: '50', price: '0.5' });

      const book = await svc.getOrderBook('XLM', buyingAsset);
      expect(book.asks.length).toBe(1);
      expect(book.asks[0].amount).toBe('50.0000000');
    });

    test('supports price as n/d ratio string', async () => {
      const result = await svc.createOffer({
        sourceSecret: seller.secretKey,
        sellingAsset: 'XLM',
        buyingAsset: 'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        amount: '10',
        price: '1/4',
      });
      expect(result.offerId).toBeDefined();
    });

    test('updates an existing offer when offerId is provided', async () => {
      const buyingAsset = 'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
      const { offerId } = await svc.createOffer({ sourceSecret: seller.secretKey, sellingAsset: 'XLM', buyingAsset, amount: '100', price: '0.25' });

      await svc.createOffer({ sourceSecret: seller.secretKey, sellingAsset: 'XLM', buyingAsset, amount: '200', price: '0.30', offerId });

      const book = await svc.getOrderBook('XLM', buyingAsset);
      expect(book.asks[0].amount).toBe('200.0000000');
    });

    test('throws ValidationError for missing sellingAsset', async () => {
      await expect(svc.createOffer({ sourceSecret: seller.secretKey, sellingAsset: '', buyingAsset: 'XLM', amount: '10', price: '1' }))
        .rejects.toThrow('sellingAsset and buyingAsset are required');
    });

    test('throws ValidationError when sellingAsset equals buyingAsset', async () => {
      await expect(svc.createOffer({ sourceSecret: seller.secretKey, sellingAsset: 'XLM', buyingAsset: 'XLM', amount: '10', price: '1' }))
        .rejects.toThrow('sellingAsset and buyingAsset must be different');
    });

    test('throws ValidationError for negative amount', async () => {
      await expect(svc.createOffer({ sourceSecret: seller.secretKey, sellingAsset: 'XLM', buyingAsset: 'USDC:ISSUER', amount: '-5', price: '1' }))
        .rejects.toThrow('amount must be a non-negative number');
    });

    test('throws ValidationError for zero price', async () => {
      await expect(svc.createOffer({ sourceSecret: seller.secretKey, sellingAsset: 'XLM', buyingAsset: 'USDC:ISSUER', amount: '10', price: '0' }))
        .rejects.toThrow('price must be a positive number');
    });

    test('throws NotFoundError for unknown source account', async () => {
      const unknown = new MockStellarService();
      const kp = await unknown.createWallet(); // not funded, not in svc
      await expect(svc.createOffer({ sourceSecret: kp.secretKey, sellingAsset: 'XLM', buyingAsset: 'USDC:ISSUER', amount: '10', price: '1' }))
        .rejects.toThrow('Source account not found');
    });

    test('throws NotFoundError when updating non-existent offerId', async () => {
      await expect(svc.createOffer({ sourceSecret: seller.secretKey, sellingAsset: 'XLM', buyingAsset: 'USDC:ISSUER', amount: '10', price: '1', offerId: 999999 }))
        .rejects.toThrow('not found');
    });

    test('throws error when non-owner tries to update offer', async () => {
      const buyingAsset = 'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
      const { offerId } = await svc.createOffer({ sourceSecret: seller.secretKey, sellingAsset: 'XLM', buyingAsset, amount: '10', price: '1' });

      await expect(svc.createOffer({ sourceSecret: buyer.secretKey, sellingAsset: 'XLM', buyingAsset, amount: '5', price: '1', offerId }))
        .rejects.toThrow('Not the offer owner');
    });

    test('propagates failure simulation', async () => {
      svc.enableFailureSimulation('network_error', 1.0);
      await expect(svc.createOffer({ sourceSecret: seller.secretKey, sellingAsset: 'XLM', buyingAsset: 'USDC:ISSUER', amount: '10', price: '1' }))
        .rejects.toThrow();
      svc.disableFailureSimulation();
    });
  });

  // cancelOffer ──────────────────────────────────────────────────────────────

  describe('cancelOffer', () => {
    test('cancels an existing offer and removes it from order book', async () => {
      const buyingAsset = 'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
      const { offerId } = await svc.createOffer({ sourceSecret: seller.secretKey, sellingAsset: 'XLM', buyingAsset, amount: '100', price: '0.25' });

      const result = await svc.cancelOffer({ sourceSecret: seller.secretKey, sellingAsset: 'XLM', buyingAsset, offerId });

      expect(result.transactionId).toBeDefined();
      const book = await svc.getOrderBook('XLM', buyingAsset);
      expect(book.asks.length).toBe(0);
    });

    test('throws NotFoundError when cancelling non-existent offer', async () => {
      await expect(svc.cancelOffer({ sourceSecret: seller.secretKey, sellingAsset: 'XLM', buyingAsset: 'USDC:ISSUER', offerId: 999 }))
        .rejects.toThrow('not found');
    });
  });

  // getOrderBook ─────────────────────────────────────────────────────────────

  describe('getOrderBook', () => {
    const buyingAsset = 'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

    test('returns empty bids and asks when no offers exist', async () => {
      const book = await svc.getOrderBook('XLM', buyingAsset);
      expect(book.bids).toEqual([]);
      expect(book.asks).toEqual([]);
      expect(book.base).toBeDefined();
      expect(book.counter).toBeDefined();
    });

    test('returns asks for matching sell offers', async () => {
      await svc.createOffer({ sourceSecret: seller.secretKey, sellingAsset: 'XLM', buyingAsset, amount: '50', price: '0.5' });
      await svc.createOffer({ sourceSecret: seller.secretKey, sellingAsset: 'XLM', buyingAsset, amount: '30', price: '0.6' });

      const book = await svc.getOrderBook('XLM', buyingAsset);
      expect(book.asks.length).toBe(2);
    });

    test('returns bids for reverse offers', async () => {
      await svc.createOffer({ sourceSecret: buyer.secretKey, sellingAsset: buyingAsset, buyingAsset: 'XLM', amount: '25', price: '2' });

      const book = await svc.getOrderBook('XLM', buyingAsset);
      expect(book.bids.length).toBe(1);
    });

    test('respects limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await svc.createOffer({ sourceSecret: seller.secretKey, sellingAsset: 'XLM', buyingAsset, amount: String(i + 1), price: '0.5' });
      }
      const book = await svc.getOrderBook('XLM', buyingAsset, 3);
      expect(book.asks.length).toBeLessThanOrEqual(3);
    });

    test('throws ValidationError for missing assets', async () => {
      await expect(svc.getOrderBook('', buyingAsset)).rejects.toThrow('sellingAsset and buyingAsset are required');
    });

    test('propagates failure simulation', async () => {
      svc.enableFailureSimulation('timeout', 1.0);
      await expect(svc.getOrderBook('XLM', buyingAsset)).rejects.toThrow();
      svc.disableFailureSimulation();
    });
  });

  // _clearAllData ────────────────────────────────────────────────────────────

  test('_clearAllData clears offers', async () => {
    const buyingAsset = 'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
    await svc.createOffer({ sourceSecret: seller.secretKey, sellingAsset: 'XLM', buyingAsset, amount: '10', price: '1' });
    svc._clearAllData();
    const book = await svc.getOrderBook('XLM', buyingAsset);
    expect(book.asks.length).toBe(0);
  });
});

// ─── HTTP endpoint integration tests ────────────────────────────────────────

describe('Offers HTTP endpoints', () => {
  let app;
  let svc;
  let seller;
  const BUYING = 'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

  beforeAll(async () => {
    // The router already captured the container's stellar service at require-time.
    // Since MOCK_STELLAR=true, that service is a MockStellarService — grab it directly.
    const { getStellarService } = require('../../src/config/stellar');
    svc = getStellarService();

    app = createTestApp();
    seller = await makeWallet(svc);
  });

  beforeEach(() => {
    // Clear offer store and mock offers between tests
    offersRouter._offerStore.clear();
    if (svc.offers) svc.offers.clear();
  });

  afterAll(() => {
    if (svc._clearAllData) svc._clearAllData();
  });

  // POST /offers ─────────────────────────────────────────────────────────────

  describe('POST /offers', () => {
    test('201 – creates offer with valid payload', async () => {
      const res = await request(app)
        .post('/offers')
        .set('x-api-key', 'test-key-dex')
        .send({ sourceSecret: seller.secretKey, sellingAsset: 'XLM', buyingAsset: BUYING, amount: '100', price: '0.25' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.offerId).toBeDefined();
      expect(res.body.data.transactionId).toBeDefined();
    });

    test('400 – missing sourceSecret', async () => {
      const res = await request(app)
        .post('/offers')
        .set('x-api-key', 'test-key-dex')
        .send({ sellingAsset: 'XLM', buyingAsset: BUYING, amount: '100', price: '0.25' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('400 – missing amount', async () => {
      const res = await request(app)
        .post('/offers')
        .set('x-api-key', 'test-key-dex')
        .send({ sourceSecret: seller.secretKey, sellingAsset: 'XLM', buyingAsset: BUYING, price: '0.25' });

      expect(res.status).toBe(400);
    });

    test('400 – missing price', async () => {
      const res = await request(app)
        .post('/offers')
        .set('x-api-key', 'test-key-dex')
        .send({ sourceSecret: seller.secretKey, sellingAsset: 'XLM', buyingAsset: BUYING, amount: '100' });

      expect(res.status).toBe(400);
    });

    test('400 – invalid asset format', async () => {
      const res = await request(app)
        .post('/offers')
        .set('x-api-key', 'test-key-dex')
        .send({ sourceSecret: seller.secretKey, sellingAsset: 'BADFORMAT', buyingAsset: BUYING, amount: '100', price: '0.25' });

      expect(res.status).toBe(400);
    });

    test('400 – same selling and buying asset', async () => {
      const res = await request(app)
        .post('/offers')
        .set('x-api-key', 'test-key-dex')
        .send({ sourceSecret: seller.secretKey, sellingAsset: 'XLM', buyingAsset: 'XLM', amount: '100', price: '1' });

      expect(res.status).toBe(400);
    });

    test('401 – missing API key', async () => {
      const res = await request(app)
        .post('/offers')
        .send({ sourceSecret: seller.secretKey, sellingAsset: 'XLM', buyingAsset: BUYING, amount: '100', price: '0.25' });

      expect(res.status).toBe(401);
    });
  });

  // GET /offers ──────────────────────────────────────────────────────────────

  describe('GET /offers', () => {
    test('200 – returns empty array when no offers', async () => {
      const res = await request(app)
        .get('/offers')
        .set('x-api-key', 'test-key-dex');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(0);
    });

    test('200 – lists created offers', async () => {
      await request(app)
        .post('/offers')
        .set('x-api-key', 'test-key-dex')
        .send({ sourceSecret: seller.secretKey, sellingAsset: 'XLM', buyingAsset: BUYING, amount: '50', price: '0.5' });

      const res = await request(app)
        .get('/offers')
        .set('x-api-key', 'test-key-dex');

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].sellingAsset).toBe('XLM');
    });

    test('401 – missing API key', async () => {
      const res = await request(app).get('/offers');
      expect(res.status).toBe(401);
    });
  });

  // DELETE /offers/:id ───────────────────────────────────────────────────────

  describe('DELETE /offers/:id', () => {
    test('200 – cancels an existing offer', async () => {
      const createRes = await request(app)
        .post('/offers')
        .set('x-api-key', 'test-key-dex')
        .send({ sourceSecret: seller.secretKey, sellingAsset: 'XLM', buyingAsset: BUYING, amount: '100', price: '0.25' });

      const offerId = createRes.body.data.offerId;

      const delRes = await request(app)
        .delete(`/offers/${offerId}`)
        .set('x-api-key', 'test-key-dex')
        .send({ sourceSecret: seller.secretKey, sellingAsset: 'XLM', buyingAsset: BUYING });

      expect(delRes.status).toBe(200);
      expect(delRes.body.success).toBe(true);
    });

    test('cancelled offer no longer appears in GET /offers', async () => {
      const createRes = await request(app)
        .post('/offers')
        .set('x-api-key', 'test-key-dex')
        .send({ sourceSecret: seller.secretKey, sellingAsset: 'XLM', buyingAsset: BUYING, amount: '100', price: '0.25' });

      const offerId = createRes.body.data.offerId;

      await request(app)
        .delete(`/offers/${offerId}`)
        .set('x-api-key', 'test-key-dex')
        .send({ sourceSecret: seller.secretKey, sellingAsset: 'XLM', buyingAsset: BUYING });

      const listRes = await request(app)
        .get('/offers')
        .set('x-api-key', 'test-key-dex');

      expect(listRes.body.data.length).toBe(0);
    });

    test('400 – non-integer offer ID', async () => {
      const res = await request(app)
        .delete('/offers/abc')
        .set('x-api-key', 'test-key-dex')
        .send({ sourceSecret: seller.secretKey, sellingAsset: 'XLM', buyingAsset: BUYING });

      expect(res.status).toBe(400);
    });

    test('400 – missing sourceSecret', async () => {
      const res = await request(app)
        .delete('/offers/12345')
        .set('x-api-key', 'test-key-dex')
        .send({ sellingAsset: 'XLM', buyingAsset: BUYING });

      expect(res.status).toBe(400);
    });

    test('404 – cancelling non-existent offer', async () => {
      const res = await request(app)
        .delete('/offers/999999')
        .set('x-api-key', 'test-key-dex')
        .send({ sourceSecret: seller.secretKey, sellingAsset: 'XLM', buyingAsset: BUYING });

      expect(res.status).toBe(404);
    });

    test('401 – missing API key', async () => {
      const res = await request(app)
        .delete('/offers/1')
        .send({ sourceSecret: seller.secretKey, sellingAsset: 'XLM', buyingAsset: BUYING });

      expect(res.status).toBe(401);
    });
  });

  // GET /orderbook/:baseAsset/:counterAsset ──────────────────────────────────

  describe('GET /orderbook/:baseAsset/:counterAsset', () => {
    test('200 – returns order book structure', async () => {
      const res = await request(app)
        .get(`/offers/orderbook/XLM/${encodeURIComponent(BUYING)}`)
        .set('x-api-key', 'test-key-dex');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.bids)).toBe(true);
      expect(Array.isArray(res.body.data.asks)).toBe(true);
      expect(res.body.data.base).toBeDefined();
      expect(res.body.data.counter).toBeDefined();
    });

    test('200 – order book reflects created offers', async () => {
      await request(app)
        .post('/offers')
        .set('x-api-key', 'test-key-dex')
        .send({ sourceSecret: seller.secretKey, sellingAsset: 'XLM', buyingAsset: BUYING, amount: '75', price: '0.4' });

      const res = await request(app)
        .get(`/offers/orderbook/XLM/${encodeURIComponent(BUYING)}`)
        .set('x-api-key', 'test-key-dex');

      expect(res.status).toBe(200);
      expect(res.body.data.asks.length).toBe(1);
    });

    test('200 – respects limit query param', async () => {
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/offers')
          .set('x-api-key', 'test-key-dex')
          .send({ sourceSecret: seller.secretKey, sellingAsset: 'XLM', buyingAsset: BUYING, amount: String(i + 1), price: '0.5' });
      }

      const res = await request(app)
        .get(`/offers/orderbook/XLM/${encodeURIComponent(BUYING)}?limit=2`)
        .set('x-api-key', 'test-key-dex');

      expect(res.status).toBe(200);
      expect(res.body.data.asks.length).toBeLessThanOrEqual(2);
    });

    test('400 – invalid base asset format', async () => {
      const res = await request(app)
        .get(`/offers/orderbook/BADFORMAT/${encodeURIComponent(BUYING)}`)
        .set('x-api-key', 'test-key-dex');

      expect(res.status).toBe(400);
    });

    test('401 – missing API key', async () => {
      const res = await request(app)
        .get(`/offers/orderbook/XLM/${encodeURIComponent(BUYING)}`);

      expect(res.status).toBe(401);
    });
  });
});
