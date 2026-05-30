/**
 * Tests: Stellar Account Sponsorship
 *
 * Covers createSponsoredAccount and revokeSponsoredAccount on MockStellarService,
 * WalletService integration, and the HTTP endpoints.
 * No live Stellar network required.
 */

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-key-sponsorship';

const MockStellarService = require('../../src/services/MockStellarService');
const WalletService = require('../../src/services/WalletService');
const Wallet = require('../../src/routes/models/wallet');

// ─── Helpers ────────────────────────────────────────────────────────────────

async function makeWallet(svc) {
  const kp = await svc.createWallet();
  await svc.fundTestnetWallet(kp.publicKey);
  return kp;
}

function makePublicKey() {
  // eslint-disable-next-line no-secrets/no-secrets
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let k = 'G';
  for (let i = 0; i < 55; i++) k += chars[Math.floor(Math.random() * chars.length)];
  return k;
}

// ─── MockStellarService unit tests ──────────────────────────────────────────

describe('MockStellarService – createSponsoredAccount', () => {
  let svc;
  let sponsor;

  beforeEach(async () => {
    svc = new MockStellarService();
    sponsor = await makeWallet(svc);
  });

  test('creates account with zero balance and sponsored=true', async () => {
    const newPub = makePublicKey();
    const result = await svc.createSponsoredAccount(sponsor.secretKey, newPub);

    expect(result.sponsored).toBe(true);
    expect(result.transactionId).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof result.ledger).toBe('number');

    const wallet = svc.wallets.get(newPub);
    expect(wallet).toBeDefined();
    expect(wallet.balance).toBe('0.0000000');
    expect(wallet.sponsored).toBe(true);
    expect(wallet.sponsoredBy).toBe(sponsor.publicKey);
  });

  test('records sponsorship in sponsorships map', async () => {
    const newPub = makePublicKey();
    await svc.createSponsoredAccount(sponsor.secretKey, newPub);

    const record = svc.sponsorships.get(newPub);
    expect(record).toBeDefined();
    expect(record.sponsor).toBe(sponsor.publicKey);
    expect(record.revokedAt).toBeNull();
  });

  test('throws NotFoundError for unknown sponsor', async () => {
    const unknownSvc = new MockStellarService();
    const kp = await unknownSvc.createWallet();
    await expect(svc.createSponsoredAccount(kp.secretKey, makePublicKey()))
      .rejects.toThrow('Sponsor account not found');
  });

  test('throws error if account already exists', async () => {
    const newPub = makePublicKey();
    await svc.createSponsoredAccount(sponsor.secretKey, newPub);
    await expect(svc.createSponsoredAccount(sponsor.secretKey, newPub))
      .rejects.toThrow('Account already exists');
  });

  test('throws ValidationError for invalid secret key', async () => {
    await expect(svc.createSponsoredAccount('bad-key', makePublicKey()))
      .rejects.toThrow();
  });

  test('throws ValidationError for invalid public key', async () => {
    await expect(svc.createSponsoredAccount(sponsor.secretKey, 'bad-pub'))
      .rejects.toThrow();
  });

  test('propagates failure simulation', async () => {
    svc.enableFailureSimulation('network_error', 1.0);
    await expect(svc.createSponsoredAccount(sponsor.secretKey, makePublicKey()))
      .rejects.toThrow();
    svc.disableFailureSimulation();
  });
});

describe('MockStellarService – revokeSponsoredAccount', () => {
  let svc;
  let sponsor;
  let newPub;

  beforeEach(async () => {
    svc = new MockStellarService();
    sponsor = await makeWallet(svc);
    newPub = makePublicKey();
    await svc.createSponsoredAccount(sponsor.secretKey, newPub);
  });

  test('revokes sponsorship and returns revoked=true', async () => {
    const result = await svc.revokeSponsoredAccount(sponsor.secretKey, newPub);

    expect(result.revoked).toBe(true);
    expect(result.transactionId).toMatch(/^[0-9a-f]{64}$/);
  });

  test('marks sponsorship record as revoked', async () => {
    await svc.revokeSponsoredAccount(sponsor.secretKey, newPub);
    const record = svc.sponsorships.get(newPub);
    expect(record.revokedAt).not.toBeNull();
  });

  test('clears sponsored flag on wallet', async () => {
    await svc.revokeSponsoredAccount(sponsor.secretKey, newPub);
    const wallet = svc.wallets.get(newPub);
    expect(wallet.sponsored).toBe(false);
  });

  test('throws NotFoundError when no sponsorship record exists', async () => {
    const unsponsored = makePublicKey();
    await expect(svc.revokeSponsoredAccount(sponsor.secretKey, unsponsored))
      .rejects.toThrow('No sponsorship record found');
  });

  test('throws error when wrong sponsor tries to revoke', async () => {
    const other = await makeWallet(svc);
    await expect(svc.revokeSponsoredAccount(other.secretKey, newPub))
      .rejects.toThrow('not sponsored by this sponsor');
  });

  test('throws error when sponsorship already revoked', async () => {
    await svc.revokeSponsoredAccount(sponsor.secretKey, newPub);
    await expect(svc.revokeSponsoredAccount(sponsor.secretKey, newPub))
      .rejects.toThrow('already revoked');
  });

  test('propagates failure simulation', async () => {
    svc.enableFailureSimulation('timeout', 1.0);
    await expect(svc.revokeSponsoredAccount(sponsor.secretKey, newPub))
      .rejects.toThrow();
    svc.disableFailureSimulation();
  });
});

describe('MockStellarService – _clearAllData clears sponsorships', () => {
  test('sponsorships map is cleared', async () => {
    const svc = new MockStellarService();
    const sponsor = await makeWallet(svc);
    const newPub = makePublicKey();
    await svc.createSponsoredAccount(sponsor.secretKey, newPub);
    svc._clearAllData();
    expect(svc.sponsorships.size).toBe(0);
  });
});

// ─── WalletService integration tests ────────────────────────────────────────

describe('WalletService – sponsored wallet creation', () => {
  let svc;
  let walletService;
  const originalSponsorSecret = process.env.SPONSOR_SECRET;

  beforeEach(async () => {
    svc = new MockStellarService();
    walletService = new WalletService(svc);
    // Clear wallet store
    Wallet.saveWallets([]);
  });

  afterEach(() => {
    process.env.SPONSOR_SECRET = originalSponsorSecret;
    Wallet.saveWallets([]);
  });

  test('creates sponsored wallet when sponsored=true and SPONSOR_SECRET set', async () => {
    const sponsor = await makeWallet(svc);
    process.env.SPONSOR_SECRET = sponsor.secretKey;

    const newPub = makePublicKey();
    const wallet = await walletService.createWallet({ address: newPub, sponsored: true });

    expect(wallet.sponsored).toBe(true);
    expect(wallet.funded).toBe(true);
  });

  test('falls back to Friendbot when sponsored=true but SPONSOR_SECRET missing', async () => {
    delete process.env.SPONSOR_SECRET;
    const kp = await svc.createWallet();
    await svc.fundTestnetWallet(kp.publicKey);

    const wallet = await walletService.createWallet({ address: kp.publicKey, sponsored: true });
    // Friendbot path: funded=true (mock), sponsored=false
    expect(wallet.sponsored).toBe(false);
  });

  test('creates normal wallet when sponsored=false', async () => {
    const kp = await svc.createWallet();
    await svc.fundTestnetWallet(kp.publicKey);

    const wallet = await walletService.createWallet({ address: kp.publicKey, sponsored: false });
    expect(wallet.sponsored).toBe(false);
  });
});

describe('WalletService – revokeSponsoredAccount', () => {
  let svc;
  let walletService;
  let sponsor;
  const originalSponsorSecret = process.env.SPONSOR_SECRET;

  beforeEach(async () => {
    svc = new MockStellarService();
    walletService = new WalletService(svc);
    Wallet.saveWallets([]);
    sponsor = await makeWallet(svc);
    process.env.SPONSOR_SECRET = sponsor.secretKey;
  });

  afterEach(() => {
    process.env.SPONSOR_SECRET = originalSponsorSecret;
    Wallet.saveWallets([]);
  });

  test('revokes sponsorship for a wallet', async () => {
    const newPub = makePublicKey();
    const created = await walletService.createWallet({ address: newPub, sponsored: true });

    const result = await walletService.revokeSponsoredAccount(created.id);
    expect(result.revoked).toBe(true);
  });

  test('throws ValidationError when SPONSOR_SECRET not set', async () => {
    delete process.env.SPONSOR_SECRET;
    const kp = await svc.createWallet();
    await svc.fundTestnetWallet(kp.publicKey);
    const created = await walletService.createWallet({ address: kp.publicKey });

    await expect(walletService.revokeSponsoredAccount(created.id))
      .rejects.toThrow('SPONSOR_SECRET is not configured');
  });

  test('throws NotFoundError for unknown wallet id', async () => {
    await expect(walletService.revokeSponsoredAccount('999999'))
      .rejects.toThrow('Wallet not found');
  });
});

// ─── HTTP endpoint tests ─────────────────────────────────────────────────────

const request = require('supertest');
const express = require('express');
const walletRouter = require('../../src/routes/wallet');
const { attachUserRole } = require('../../src/middleware/rbac');

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(attachUserRole());
  app.use('/wallets', walletRouter);
  app.use((err, req, res, next) => {
    void next;
    res.status(err.statusCode || err.status || 400).json({
      success: false,
      error: { code: err.errorCode || 'ERROR', message: err.message }
    });
  });
  return app;
}

describe('POST /wallets with sponsored=true', () => {
  let app;
  let svc;
  let sponsor;
  const originalSponsorSecret = process.env.SPONSOR_SECRET;

  beforeAll(async () => {
    const { getStellarService } = require('../../src/config/stellar');
    svc = getStellarService();
    sponsor = await makeWallet(svc);
    app = createTestApp();
  });

  beforeEach(() => {
    Wallet.saveWallets([]);
    if (svc.sponsorships) svc.sponsorships.clear();
  });

  afterAll(() => {
    process.env.SPONSOR_SECRET = originalSponsorSecret;
    Wallet.saveWallets([]);
  });

  test('201 – creates sponsored wallet when SPONSOR_SECRET configured', async () => {
    process.env.SPONSOR_SECRET = sponsor.secretKey;
    const newPub = makePublicKey();

    const res = await request(app)
      .post('/wallets')
      .set('x-api-key', 'test-key-sponsorship')
      .send({ address: newPub, sponsored: true });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.sponsored).toBe(true);
  });

  test('201 – creates normal wallet when sponsored=false', async () => {
    const kp = await svc.createWallet();
    await svc.fundTestnetWallet(kp.publicKey);

    const res = await request(app)
      .post('/wallets')
      .set('x-api-key', 'test-key-sponsorship')
      .send({ address: kp.publicKey, sponsored: false });

    expect(res.status).toBe(201);
    expect(res.body.data.sponsored).toBe(false);
  });

  test('201 – sponsored field defaults to false when omitted', async () => {
    const kp = await svc.createWallet();
    await svc.fundTestnetWallet(kp.publicKey);

    const res = await request(app)
      .post('/wallets')
      .set('x-api-key', 'test-key-sponsorship')
      .send({ address: kp.publicKey });

    expect(res.status).toBe(201);
    expect(res.body.data.sponsored).toBe(false);
  });

  test('401/403 – missing API key', async () => {
    const res = await request(app)
      .post('/wallets')
      .send({ address: makePublicKey(), sponsored: true });
    expect([401, 403]).toContain(res.status);
  });
});

describe('POST /wallets/:id/revoke-sponsorship', () => {
  let app;
  let svc;
  let sponsor;
  const originalSponsorSecret = process.env.SPONSOR_SECRET;

  beforeAll(async () => {
    const { getStellarService } = require('../../src/config/stellar');
    svc = getStellarService();
    sponsor = await makeWallet(svc);
    app = createTestApp();
  });

  beforeEach(() => {
    Wallet.saveWallets([]);
    if (svc.sponsorships) svc.sponsorships.clear();
  });

  afterAll(() => {
    process.env.SPONSOR_SECRET = originalSponsorSecret;
    Wallet.saveWallets([]);
  });

  test('200 – revokes sponsorship for existing wallet', async () => {
    process.env.SPONSOR_SECRET = sponsor.secretKey;
    const newPub = makePublicKey();

    const createRes = await request(app)
      .post('/wallets')
      .set('x-api-key', 'test-key-sponsorship')
      .send({ address: newPub, sponsored: true });

    const walletId = createRes.body.data.id;

    const revokeRes = await request(app)
      .post(`/wallets/${walletId}/revoke-sponsorship`)
      .set('x-api-key', 'test-key-sponsorship');

    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body.success).toBe(true);
    expect(revokeRes.body.data.revoked).toBe(true);
  });

  test('400 – revoke fails when SPONSOR_SECRET not set', async () => {
    delete process.env.SPONSOR_SECRET;
    const kp = await svc.createWallet();
    await svc.fundTestnetWallet(kp.publicKey);

    const createRes = await request(app)
      .post('/wallets')
      .set('x-api-key', 'test-key-sponsorship')
      .send({ address: kp.publicKey });

    const walletId = createRes.body.data.id;

    const revokeRes = await request(app)
      .post(`/wallets/${walletId}/revoke-sponsorship`)
      .set('x-api-key', 'test-key-sponsorship');

    expect(revokeRes.status).toBe(400);
    expect(revokeRes.body.success).toBe(false);
  });

  test('404 – revoke fails for unknown wallet id', async () => {
    process.env.SPONSOR_SECRET = sponsor.secretKey;

    const res = await request(app)
      .post('/wallets/999999/revoke-sponsorship')
      .set('x-api-key', 'test-key-sponsorship');

    expect(res.status).toBe(404);
  });

  test('401/403 – missing API key', async () => {
    const res = await request(app)
      .post('/wallets/1/revoke-sponsorship');
    expect([401, 403]).toContain(res.status);
  });
});
