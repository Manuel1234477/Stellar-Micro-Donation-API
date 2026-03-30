/**
 * Home Domain Management Tests
 *
 * Covers:
 * - MockStellarService.setHomeDomain / getHomeDomain
 * - PUT  /wallets/:id/home-domain  (set)
 * - GET  /wallets/:id/home-domain  (get)
 * - POST /wallets/:id/home-domain/verify (verify stellar.toml)
 */

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-key';

const request = require('supertest');
const express = require('express');
const walletRouter = require('../src/routes/wallet');
const { getStellarService } = require('../src/config/stellar');
const { attachUserRole } = require('../src/middleware/rbac');
const Wallet = require('../src/routes/models/wallet');

// Mock https so the verify endpoint's inline require('https') is intercepted
jest.mock('https', () => ({ get: jest.fn() }));
const https = require('https');

// ── helpers ──────────────────────────────────────────────────────────────────

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(attachUserRole());
  app.use('/wallets', walletRouter);
  app.use((err, req, res, _next) => {
    const status = err.status ||
      (err.name === 'ValidationError' ? 400 : err.name === 'NotFoundError' ? 404 : 500);
    res.status(status).json({
      success: false,
      error: { code: err.code || 'ERROR', message: err.message },
    });
  });
  return app;
}

// ── MockStellarService unit tests ─────────────────────────────────────────────

describe('MockStellarService – home domain state', () => {
  let svc;

  beforeEach(() => {
    svc = getStellarService();
  });

  test('getHomeDomain returns null for unknown account', async () => {
    const result = await svc.getHomeDomain('GNON_EXISTENT_KEY_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX');
    expect(result).toBeNull();
  });

  test('setHomeDomain stores domain and getHomeDomain retrieves it', async () => {
    const { publicKey, secretKey } = await svc.createWallet();
    const { hash, ledger } = await svc.setHomeDomain(secretKey, 'example.com');

    expect(typeof hash).toBe('string');
    expect(typeof ledger).toBe('number');

    const domain = await svc.getHomeDomain(publicKey);
    expect(domain).toBe('example.com');
  });

  test('setHomeDomain rejects domain longer than 32 chars', async () => {
    const { secretKey } = await svc.createWallet();
    await expect(svc.setHomeDomain(secretKey, 'a'.repeat(33))).rejects.toThrow('32 characters');
  });

  test('setHomeDomain rejects domain with protocol prefix', async () => {
    const { secretKey } = await svc.createWallet();
    await expect(svc.setHomeDomain(secretKey, 'https://example.com')).rejects.toThrow();
  });

  test('setHomeDomain rejects invalid secret key', async () => {
    await expect(svc.setHomeDomain('SBAD_SECRET', 'example.com')).rejects.toThrow();
  });

  test('setHomeDomain overwrites previous domain', async () => {
    const { publicKey, secretKey } = await svc.createWallet();
    await svc.setHomeDomain(secretKey, 'first.com');
    await svc.setHomeDomain(secretKey, 'second.com');
    expect(await svc.getHomeDomain(publicKey)).toBe('second.com');
  });
});

// ── HTTP endpoint tests ───────────────────────────────────────────────────────

describe('PUT /wallets/:id/home-domain', () => {
  let app, svc, wallet, dbWallet;

  beforeAll(async () => {
    app = createApp();
    svc = getStellarService();
    wallet = await svc.createWallet();
    dbWallet = Wallet.create({ address: wallet.publicKey, label: 'hd-test' });
  });

  test('sets home domain and returns hash + ledger', async () => {
    const res = await request(app)
      .put(`/wallets/${dbWallet.id}/home-domain`)
      .set('x-api-key', 'test-key')
      .send({ domain: 'stellar.org', sourceSecret: wallet.secretKey });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.homeDomain).toBe('stellar.org');
    expect(res.body.data).toHaveProperty('hash');
    expect(res.body.data).toHaveProperty('ledger');
  });

  test('returns 400 when domain is missing', async () => {
    const res = await request(app)
      .put(`/wallets/${dbWallet.id}/home-domain`)
      .set('x-api-key', 'test-key')
      .send({ sourceSecret: wallet.secretKey });

    expect(res.status).toBe(400);
  });

  test('returns 400 when sourceSecret is missing', async () => {
    const res = await request(app)
      .put(`/wallets/${dbWallet.id}/home-domain`)
      .set('x-api-key', 'test-key')
      .send({ domain: 'example.com' });

    expect(res.status).toBe(400);
  });

  test('returns 400 for invalid domain format', async () => {
    const res = await request(app)
      .put(`/wallets/${dbWallet.id}/home-domain`)
      .set('x-api-key', 'test-key')
      .send({ domain: 'https://bad-domain.com', sourceSecret: wallet.secretKey });

    expect(res.status).toBe(400);
  });

  test('returns 404 for non-existent wallet', async () => {
    const res = await request(app)
      .put('/wallets/999999/home-domain')
      .set('x-api-key', 'test-key')
      .send({ domain: 'example.com', sourceSecret: wallet.secretKey });

    expect(res.status).toBe(404);
  });
});

describe('GET /wallets/:id/home-domain', () => {
  let app, svc, wallet, dbWallet;

  beforeAll(async () => {
    app = createApp();
    svc = getStellarService();
    wallet = await svc.createWallet();
    dbWallet = Wallet.create({ address: wallet.publicKey, label: 'hd-get-test' });
  });

  test('returns null when no home domain is set', async () => {
    const res = await request(app)
      .get(`/wallets/${dbWallet.id}/home-domain`)
      .set('x-api-key', 'test-key');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.homeDomain).toBeNull();
  });

  test('returns the domain after it has been set', async () => {
    await svc.setHomeDomain(wallet.secretKey, 'myorg.io');

    const res = await request(app)
      .get(`/wallets/${dbWallet.id}/home-domain`)
      .set('x-api-key', 'test-key');

    expect(res.status).toBe(200);
    expect(res.body.data.homeDomain).toBe('myorg.io');
  });

  test('returns 404 for non-existent wallet', async () => {
    const res = await request(app)
      .get('/wallets/999999/home-domain')
      .set('x-api-key', 'test-key');

    expect(res.status).toBe(404);
  });
});

describe('POST /wallets/:id/home-domain/verify', () => {
  let app, svc, wallet, dbWallet;

  beforeAll(async () => {
    app = createApp();
    svc = getStellarService();
    wallet = await svc.createWallet();
    dbWallet = Wallet.create({ address: wallet.publicKey, label: 'hd-verify-test' });
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  test('returns 400 when no home domain is set', async () => {
    const res = await request(app)
      .post(`/wallets/${dbWallet.id}/home-domain/verify`)
      .set('x-api-key', 'test-key');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no home domain/i);
  });

  test('returns verified:true when public key is listed in stellar.toml', async () => {
    await svc.setHomeDomain(wallet.secretKey, 'example.com');

    https.get.mockImplementation((_url, _opts, cb) => {
      const mockRes = {
        statusCode: 200,
        on: (event, handler) => {
          if (event === 'data') handler(`ACCOUNTS=["${wallet.publicKey}"]`);
          if (event === 'end') handler();
          return mockRes;
        },
        resume: jest.fn(),
      };
      cb(mockRes);
      return { on: jest.fn(), destroy: jest.fn() };
    });

    const res = await request(app)
      .post(`/wallets/${dbWallet.id}/home-domain/verify`)
      .set('x-api-key', 'test-key');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.verified).toBe(true);
    expect(res.body.data.homeDomain).toBe('example.com');
    expect(res.body.data.publicKey).toBe(wallet.publicKey);
  });

  test('returns 422 when public key is NOT listed in stellar.toml', async () => {
    await svc.setHomeDomain(wallet.secretKey, 'example.com');

    https.get.mockImplementation((_url, _opts, cb) => {
      const mockRes = {
        statusCode: 200,
        on: (event, handler) => {
          if (event === 'data') handler('ACCOUNTS=["GDIFFERENTKEY123456789012345678901234567890123456789012"]');
          if (event === 'end') handler();
          return mockRes;
        },
        resume: jest.fn(),
      };
      cb(mockRes);
      return { on: jest.fn(), destroy: jest.fn() };
    });

    const res = await request(app)
      .post(`/wallets/${dbWallet.id}/home-domain/verify`)
      .set('x-api-key', 'test-key');

    expect(res.status).toBe(422);
    expect(res.body.data.verified).toBe(false);
  });

  test('returns 502 when stellar.toml is unreachable', async () => {
    await svc.setHomeDomain(wallet.secretKey, 'unreachable.example');

    https.get.mockImplementation((_url, _opts, _cb) => {
      const emitter = { on: jest.fn() };
      emitter.on.mockImplementation((event, handler) => {
        if (event === 'error') handler(new Error('ECONNREFUSED'));
        return emitter;
      });
      return emitter;
    });

    const res = await request(app)
      .post(`/wallets/${dbWallet.id}/home-domain/verify`)
      .set('x-api-key', 'test-key');

    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
  });

  test('returns 404 for non-existent wallet', async () => {
    const res = await request(app)
      .post('/wallets/999999/home-domain/verify')
      .set('x-api-key', 'test-key');

    expect(res.status).toBe(404);
  });
});
