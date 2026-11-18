'use strict';

/**
 * Tests for Stellar account merge with pre-merge eligibility validation (#605)
 * Covers: eligibility check, successful merge, blocked merge, invalid destination
 */

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-merge-key';

const request = require('supertest');
const express = require('express');
const Database = require('../../src/utils/database');
const walletRouter = require('../../src/routes/wallet');
const requireApiKey = require('../../src/middleware/apiKey');
const { attachUserRole } = require('../../src/middleware/rbac');

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(requireApiKey);
  app.use(attachUserRole());
  // Force admin role so wallets:delete permission is available
  app.use((req, _res, next) => {
    if (req.user) req.user.role = 'admin';
    next();
  });
  app.use('/wallets', walletRouter);
  app.use((err, req, res, _next) => {
    res.status(err.statusCode || err.status || 500).json({ success: false, error: err.message });
  });
  return app;
}

let app;
const API_KEY = 'test-merge-key';

// Valid Stellar keypairs
const SOURCE_PUBLIC = 'GDKV6OAXXQZ6HSBNB62P2BQAJWVKBX2LLCJAEEZHL7OYGKXGRPPR6OBM';
const DEST_PUBLIC   = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZXG5CPCJDGYVNO3LFPZZ';

async function createWallet(publicKey) {
  const existing = await Database.get('SELECT id FROM users WHERE publicKey = ?', [publicKey]);
  if (existing) {
    // Reset mergedAt for reuse
    await Database.run('UPDATE users SET mergedAt = NULL, mergedInto = NULL WHERE publicKey = ?', [publicKey]);
    return existing.id;
  }
  const result = await Database.run('INSERT INTO users (publicKey) VALUES (?)', [publicKey]);
  return result.id;
}

beforeAll(async () => {
  await Database.initialize();
  app = createTestApp();
});

afterAll(async () => {
  await Database.close();
});

describe('MockStellarService.validateMergeEligibility', () => {
  test('returns eligible=true for a clean account', async () => {
    const MockStellarService = require('../../src/services/MockStellarService');
    const svc = new MockStellarService();
    svc.wallets.set(SOURCE_PUBLIC, {
      publicKey: SOURCE_PUBLIC,
      balance: '100.0000000',
      balances: [{ asset_type: 'native', balance: '100.0000000' }],
    });

    const result = await svc.validateMergeEligibility(SOURCE_PUBLIC);
    expect(result.eligible).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  test('returns eligible=false with non_zero_trustline blocker', async () => {
    const MockStellarService = require('../../src/services/MockStellarService');
    const svc = new MockStellarService();
    svc.wallets.set(SOURCE_PUBLIC, {
      publicKey: SOURCE_PUBLIC,
      balance: '100.0000000',
      balances: [
        { asset_type: 'native', balance: '100.0000000' },
        { asset_type: 'credit_alphanum4', asset_code: 'USDC', balance: '50.0000000' },
      ],
    });

    const result = await svc.validateMergeEligibility(SOURCE_PUBLIC);
    expect(result.eligible).toBe(false);
    expect(result.blockers.some(b => b.type === 'non_zero_trustline')).toBe(true);
  });

  test('returns eligible=false with open_offers blocker', async () => {
    const MockStellarService = require('../../src/services/MockStellarService');
    const svc = new MockStellarService();
    svc.wallets.set(SOURCE_PUBLIC, {
      publicKey: SOURCE_PUBLIC,
      balance: '100.0000000',
      balances: [{ asset_type: 'native', balance: '100.0000000' }],
      openOffers: [{ id: '1', amount: '10' }],
    });

    const result = await svc.validateMergeEligibility(SOURCE_PUBLIC);
    expect(result.eligible).toBe(false);
    expect(result.blockers.some(b => b.type === 'open_offers')).toBe(true);
  });

  test('returns eligible=false with data_entries blocker', async () => {
    const MockStellarService = require('../../src/services/MockStellarService');
    const svc = new MockStellarService();
    svc.wallets.set(SOURCE_PUBLIC, {
      publicKey: SOURCE_PUBLIC,
      balance: '100.0000000',
      balances: [{ asset_type: 'native', balance: '100.0000000' }],
      dataEntries: { key1: 'value1' },
    });

    const result = await svc.validateMergeEligibility(SOURCE_PUBLIC);
    expect(result.eligible).toBe(false);
    expect(result.blockers.some(b => b.type === 'data_entries')).toBe(true);
  });

  test('throws for invalid public key', async () => {
    const MockStellarService = require('../../src/services/MockStellarService');
    const svc = new MockStellarService();
    await expect(svc.validateMergeEligibility('INVALID')).rejects.toThrow();
  });

  test('throws NotFoundError for unknown account', async () => {
    const MockStellarService = require('../../src/services/MockStellarService');
    const svc = new MockStellarService();
    await expect(svc.validateMergeEligibility(SOURCE_PUBLIC)).rejects.toThrow();
  });
});

describe('GET /wallets/:id/merge/eligibility', () => {
  test('returns 404 for unknown wallet', async () => {
    const res = await request(app)
      .get('/wallets/999999/merge/eligibility')
      .set('X-API-Key', API_KEY);

    expect(res.status).toBe(404);
  });

  test('returns eligibility data for a known wallet', async () => {
    const serviceContainer = require('../../src/config/serviceContainer');
    const svc = serviceContainer.getStellarService();
    const walletId = await createWallet(SOURCE_PUBLIC);

    if (svc.wallets) {
      svc.wallets.set(SOURCE_PUBLIC, {
        publicKey: SOURCE_PUBLIC,
        balance: '100.0000000',
        balances: [{ asset_type: 'native', balance: '100.0000000' }],
      });
    }

    const res = await request(app)
      .get(`/wallets/${walletId}/merge/eligibility`)
      .set('X-API-Key', API_KEY);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('eligible');
    expect(res.body.data).toHaveProperty('blockers');
    expect(Array.isArray(res.body.data.blockers)).toBe(true);
  });

  test('returns 409 for already-merged wallet', async () => {
    const walletId = await createWallet('GMERGED_TEST_KEY_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
    await Database.run(
      "UPDATE users SET mergedAt = '2024-01-01T00:00:00.000Z' WHERE id = ?",
      [walletId]
    );

    const res = await request(app)
      .get(`/wallets/${walletId}/merge/eligibility`)
      .set('X-API-Key', API_KEY);

    expect(res.status).toBe(409);
    expect(res.body.data.eligible).toBe(false);
  });
});

describe('POST /wallets/:id/merge with eligibility check', () => {
  test('returns 400 when account has blocking conditions', async () => {
    const serviceContainer = require('../../src/config/serviceContainer');
    const svc = serviceContainer.getStellarService();
    const walletId = await createWallet(SOURCE_PUBLIC);

    if (svc.wallets) {
      svc.wallets.set(SOURCE_PUBLIC, {
        publicKey: SOURCE_PUBLIC,
        balance: '100.0000000',
        balances: [
          { asset_type: 'native', balance: '100.0000000' },
          { asset_type: 'credit_alphanum4', asset_code: 'USDC', balance: '10.0000000' },
        ],
      });
    }

    const res = await request(app)
      .post(`/wallets/${walletId}/merge`)
      .set('X-API-Key', API_KEY)
      .send({
        destinationPublicKey: DEST_PUBLIC,
        sourceSecret: 'SCZANGBA5YELEHWYD4BXMWMSE2OVLKIAWLKN4BKFZQWI4YBKXQWSM7Y',
        confirm: true,
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.data.blockers).toBeDefined();
    expect(res.body.data.blockers.length).toBeGreaterThan(0);
  });

  test('validateMergeEligibility is a function on MockStellarService', () => {
    const MockStellarService = require('../../src/services/MockStellarService');
    const svc = new MockStellarService();
    expect(typeof svc.validateMergeEligibility).toBe('function');
  });

  test('validateMergeEligibility is a function on StellarService', () => {
    const StellarService = require('../../src/services/StellarService');
    const svc = new StellarService();
    expect(typeof svc.validateMergeEligibility).toBe('function');
  });
});
