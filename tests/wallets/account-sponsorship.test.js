'use strict';

const express = require('express');
const request = require('supertest');
const MockStellarService = require('../../src/services/MockStellarService');
const WalletService = require('../../src/services/WalletService');
const Wallet = require('../../src/routes/models/wallet');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePublicKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let k = 'G';
  for (let i = 0; i < 55; i++) k += chars[Math.floor(Math.random() * chars.length)];
  return k;
}

async function makeFundedWallet(svc) {
  const kp = await svc.createWallet();
  await svc.fundTestnetWallet(kp.publicKey);
  return kp;
}

/** Build a minimal Express app exposing the three sponsor routes */
function buildApp(walletSvc) {
  const app = express();
  app.use(express.json());

  app.post('/wallets/:id/sponsor', async (req, res) => {
    try {
      const result = await walletSvc.sponsorAccount(req.params.id);
      res.json({ success: true, data: result });
    } catch (err) {
      res.status(err.statusCode || err.status || 400).json({ success: false, error: { message: err.message } });
    }
  });

  app.delete('/wallets/:id/sponsor', async (req, res) => {
    try {
      const result = await walletSvc.revokeSponsorship(req.params.id, req.query.entryType);
      res.json({ success: true, data: result });
    } catch (err) {
      res.status(err.statusCode || err.status || 400).json({ success: false, error: { message: err.message } });
    }
  });

  app.get('/wallets/:id/sponsor', async (req, res) => {
    try {
      const status = await walletSvc.getSponsorshipStatus(req.params.id);
      res.json({ success: true, data: status });
    } catch (err) {
      res.status(err.statusCode || err.status || 404).json({ success: false, error: { message: err.message } });
    }
  });

  return app;
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  Wallet._clearAllData();
});

afterEach(() => {
  delete process.env.SPONSOR_SECRET;
  jest.clearAllMocks();
});

// ─── MockStellarService.sponsorAccount ───────────────────────────────────────

describe('MockStellarService.sponsorAccount', () => {
  it('creates a sponsored account with zero balance', async () => {
    const svc = new MockStellarService();
    const sponsor = await makeFundedWallet(svc);
    const newPub = makePublicKey();
    const result = await svc.sponsorAccount(sponsor.secretKey, newPub);
    expect(result.sponsored).toBe(true);
    expect(result.transactionId).toBeDefined();
    const wallet = svc.wallets.get(newPub);
    expect(wallet.sponsored).toBe(true);
    expect(wallet.sponsoredBy).toBe(sponsor.publicKey);
  });

  it('records sponsorship in the sponsorships map', async () => {
    const svc = new MockStellarService();
    const sponsor = await makeFundedWallet(svc);
    const newPub = makePublicKey();
    await svc.sponsorAccount(sponsor.secretKey, newPub);
    const record = svc.sponsorships.get(newPub);
    expect(record).toBeDefined();
    expect(record.sponsor).toBe(sponsor.publicKey);
    expect(record.revokedAt).toBeNull();
  });

  it('throws when sponsor account does not exist', async () => {
    const svc = new MockStellarService();
    const fakeSecret = 'SCZANGBA5RLMPI7JMTP2UX7BASAMFZRGLPMWFMKQ5GKNE7TNKUJHXNT';
    await expect(svc.sponsorAccount(fakeSecret, makePublicKey())).rejects.toThrow();
  });
});

// ─── MockStellarService.revokeSponsorship ────────────────────────────────────

describe('MockStellarService.revokeSponsorship', () => {
  it('revokes an active sponsorship', async () => {
    const svc = new MockStellarService();
    const sponsor = await makeFundedWallet(svc);
    const newPub = makePublicKey();
    await svc.sponsorAccount(sponsor.secretKey, newPub);
    const result = await svc.revokeSponsorship(sponsor.secretKey, newPub);
    expect(result.revoked).toBe(true);
    expect(result.transactionId).toBeDefined();
    const record = svc.sponsorships.get(newPub);
    expect(record.revokedAt).not.toBeNull();
  });

  it('throws when no sponsorship record exists', async () => {
    const svc = new MockStellarService();
    const sponsor = await makeFundedWallet(svc);
    await expect(svc.revokeSponsorship(sponsor.secretKey, makePublicKey())).rejects.toThrow();
  });

  it('throws when sponsorship already revoked', async () => {
    const svc = new MockStellarService();
    const sponsor = await makeFundedWallet(svc);
    const newPub = makePublicKey();
    await svc.sponsorAccount(sponsor.secretKey, newPub);
    await svc.revokeSponsorship(sponsor.secretKey, newPub);
    await expect(svc.revokeSponsorship(sponsor.secretKey, newPub)).rejects.toThrow();
  });
});

// ─── MockStellarService.getSponsorshipStatus ─────────────────────────────────

describe('MockStellarService.getSponsorshipStatus', () => {
  it('returns sponsored=true for an active sponsorship', async () => {
    const svc = new MockStellarService();
    const sponsor = await makeFundedWallet(svc);
    const newPub = makePublicKey();
    await svc.sponsorAccount(sponsor.secretKey, newPub);
    const status = await svc.getSponsorshipStatus(newPub);
    expect(status.sponsored).toBe(true);
    expect(status.sponsoredBy).toBe(sponsor.publicKey);
  });

  it('returns sponsored=false for an unsponsored account', async () => {
    const svc = new MockStellarService();
    const kp = await makeFundedWallet(svc);
    const status = await svc.getSponsorshipStatus(kp.publicKey);
    expect(status.sponsored).toBe(false);
    expect(status.sponsoredBy).toBeNull();
  });

  it('returns sponsored=false after revocation', async () => {
    const svc = new MockStellarService();
    const sponsor = await makeFundedWallet(svc);
    const newPub = makePublicKey();
    await svc.sponsorAccount(sponsor.secretKey, newPub);
    await svc.revokeSponsorship(sponsor.secretKey, newPub);
    const status = await svc.getSponsorshipStatus(newPub);
    expect(status.sponsored).toBe(false);
  });
});

// ─── WalletService.sponsorAccount ────────────────────────────────────────────

describe('WalletService.sponsorAccount', () => {
  it('sponsors a wallet and returns transaction result', async () => {
    const stellar = new MockStellarService();
    const sponsor = await makeFundedWallet(stellar);
    process.env.SPONSOR_SECRET = sponsor.secretKey;

    const walletSvc = new WalletService(stellar);
    const newPub = makePublicKey();
    const walletRecord = Wallet.create({ address: newPub });

    const result = await walletSvc.sponsorAccount(walletRecord.id);
    expect(result.sponsored).toBe(true);
    expect(result.transactionId).toBeDefined();
  });

  it('throws ValidationError when SPONSOR_SECRET is not set', async () => {
    const walletSvc = new WalletService(new MockStellarService());
    const walletRecord = Wallet.create({ address: makePublicKey() });
    await expect(walletSvc.sponsorAccount(walletRecord.id)).rejects.toThrow('SPONSOR_SECRET');
  });

  it('throws NotFoundError for unknown wallet id', async () => {
    process.env.SPONSOR_SECRET = 'SCZANGBA5RLMPI7JMTP2UX7BASAMFZRGLPMWFMKQ5GKNE7TNKUJHXNT';
    const walletSvc = new WalletService(new MockStellarService());
    await expect(walletSvc.sponsorAccount(99999)).rejects.toThrow();
  });
});

// ─── WalletService.revokeSponsorship ─────────────────────────────────────────

describe('WalletService.revokeSponsorship', () => {
  it('revokes sponsorship when account has sufficient balance', async () => {
    const stellar = new MockStellarService();
    const sponsor = await makeFundedWallet(stellar);
    process.env.SPONSOR_SECRET = sponsor.secretKey;

    const newPub = makePublicKey();
    await stellar.sponsorAccount(sponsor.secretKey, newPub);
    // Give the account enough balance to cover its own reserve
    stellar.wallets.get(newPub).balance = '2.0000000';
    jest.spyOn(stellar, 'getBalance').mockResolvedValue({ balance: '2.0000000' });

    const walletSvc = new WalletService(stellar);
    const walletRecord = Wallet.create({ address: newPub });

    const result = await walletSvc.revokeSponsorship(walletRecord.id);
    expect(result.revoked).toBe(true);
  });

  it('returns 400 when account balance is below minimum reserve', async () => {
    const stellar = new MockStellarService();
    const sponsor = await makeFundedWallet(stellar);
    process.env.SPONSOR_SECRET = sponsor.secretKey;

    const newPub = makePublicKey();
    await stellar.sponsorAccount(sponsor.secretKey, newPub);
    jest.spyOn(stellar, 'getBalance').mockResolvedValue({ balance: '0.0000000' });

    const walletSvc = new WalletService(stellar);
    const walletRecord = Wallet.create({ address: newPub });

    await expect(walletSvc.revokeSponsorship(walletRecord.id)).rejects.toThrow(/minimum reserve/);
  });

  it('throws ValidationError when SPONSOR_SECRET is not set', async () => {
    const walletSvc = new WalletService(new MockStellarService());
    const walletRecord = Wallet.create({ address: makePublicKey() });
    await expect(walletSvc.revokeSponsorship(walletRecord.id)).rejects.toThrow('SPONSOR_SECRET');
  });
});

// ─── WalletService.getSponsorshipStatus ──────────────────────────────────────

describe('WalletService.getSponsorshipStatus', () => {
  it('returns sponsorship status from stellar service', async () => {
    const stellar = new MockStellarService();
    const sponsor = await makeFundedWallet(stellar);
    process.env.SPONSOR_SECRET = sponsor.secretKey;

    const newPub = makePublicKey();
    await stellar.sponsorAccount(sponsor.secretKey, newPub);

    const walletSvc = new WalletService(stellar);
    const walletRecord = Wallet.create({ address: newPub });

    const status = await walletSvc.getSponsorshipStatus(walletRecord.id);
    expect(status.sponsored).toBe(true);
    expect(status.sponsoredBy).toBe(sponsor.publicKey);
  });

  it('returns sponsored=false when no stellar service', async () => {
    const walletSvc = new WalletService(null);
    const walletRecord = Wallet.create({ address: makePublicKey() });
    const status = await walletSvc.getSponsorshipStatus(walletRecord.id);
    expect(status.sponsored).toBe(false);
  });

  it('throws NotFoundError for unknown wallet', async () => {
    const walletSvc = new WalletService(new MockStellarService());
    await expect(walletSvc.getSponsorshipStatus(99999)).rejects.toThrow();
  });
});

// ─── HTTP endpoints ───────────────────────────────────────────────────────────

describe('POST /wallets/:id/sponsor', () => {
  it('returns 200 with sponsored=true', async () => {
    const stellar = new MockStellarService();
    const sponsor = await makeFundedWallet(stellar);
    process.env.SPONSOR_SECRET = sponsor.secretKey;

    const walletSvc = new WalletService(stellar);
    const walletRecord = Wallet.create({ address: makePublicKey() });
    const app = buildApp(walletSvc);

    const res = await request(app).post(`/wallets/${walletRecord.id}/sponsor`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.sponsored).toBe(true);
  });

  it('returns 400 when SPONSOR_SECRET is missing', async () => {
    const walletSvc = new WalletService(new MockStellarService());
    const walletRecord = Wallet.create({ address: makePublicKey() });
    const app = buildApp(walletSvc);

    const res = await request(app).post(`/wallets/${walletRecord.id}/sponsor`);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('DELETE /wallets/:id/sponsor', () => {
  it('returns 200 with revoked=true when balance is sufficient', async () => {
    const stellar = new MockStellarService();
    const sponsor = await makeFundedWallet(stellar);
    process.env.SPONSOR_SECRET = sponsor.secretKey;

    const newPub = makePublicKey();
    await stellar.sponsorAccount(sponsor.secretKey, newPub);
    jest.spyOn(stellar, 'getBalance').mockResolvedValue({ balance: '5.0000000' });

    const walletSvc = new WalletService(stellar);
    const walletRecord = Wallet.create({ address: newPub });
    const app = buildApp(walletSvc);

    const res = await request(app).delete(`/wallets/${walletRecord.id}/sponsor`);
    expect(res.status).toBe(200);
    expect(res.body.data.revoked).toBe(true);
  });

  it('returns 400 when account cannot cover its own reserve', async () => {
    const stellar = new MockStellarService();
    const sponsor = await makeFundedWallet(stellar);
    process.env.SPONSOR_SECRET = sponsor.secretKey;

    const newPub = makePublicKey();
    await stellar.sponsorAccount(sponsor.secretKey, newPub);
    jest.spyOn(stellar, 'getBalance').mockResolvedValue({ balance: '0.0000000' });

    const walletSvc = new WalletService(stellar);
    const walletRecord = Wallet.create({ address: newPub });
    const app = buildApp(walletSvc);

    const res = await request(app).delete(`/wallets/${walletRecord.id}/sponsor`);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/minimum reserve/);
  });
});

describe('GET /wallets/:id/sponsor', () => {
  it('returns sponsored=true for an active sponsorship', async () => {
    const stellar = new MockStellarService();
    const sponsor = await makeFundedWallet(stellar);
    process.env.SPONSOR_SECRET = sponsor.secretKey;

    const newPub = makePublicKey();
    await stellar.sponsorAccount(sponsor.secretKey, newPub);

    const walletSvc = new WalletService(stellar);
    const walletRecord = Wallet.create({ address: newPub });
    const app = buildApp(walletSvc);

    const res = await request(app).get(`/wallets/${walletRecord.id}/sponsor`);
    expect(res.status).toBe(200);
    expect(res.body.data.sponsored).toBe(true);
    expect(res.body.data.sponsoredBy).toBe(sponsor.publicKey);
  });

  it('returns sponsored=false for an unsponsored account', async () => {
    const stellar = new MockStellarService();
    const kp = await makeFundedWallet(stellar);
    const walletSvc = new WalletService(stellar);
    const walletRecord = Wallet.create({ address: kp.publicKey });
    const app = buildApp(walletSvc);

    const res = await request(app).get(`/wallets/${walletRecord.id}/sponsor`);
    expect(res.status).toBe(200);
    expect(res.body.data.sponsored).toBe(false);
  });

  it('returns 404 for unknown wallet', async () => {
    const walletSvc = new WalletService(new MockStellarService());
    const app = buildApp(walletSvc);
    const res = await request(app).get('/wallets/99999/sponsor');
    expect(res.status).toBe(404);
  });
});
