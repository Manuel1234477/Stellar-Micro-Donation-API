'use strict';
/**
 * Tests for #909 — GET /donations/:id/receipt PDF generation endpoint
 *
 * Verifies:
 *  - Content-Type: application/pdf and non-empty body
 *  - JSON format (?format=json) returns correct fields
 *  - Non-existent donation returns HTTP 404
 *  - Unconfirmed donation generates a receipt (pending status)
 */

process.env.NODE_ENV = 'test';
process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-909-key';

const request = require('supertest');
const express = require('express');
const path = require('path');
const fs = require('fs');

// Use a temp JSON file for the Transaction model during tests
const tmpDbPath = path.join(__dirname, '../../data/donations-test-909.json');
process.env.DB_JSON_PATH = tmpDbPath;

const requireApiKey = require('../../src/middleware/apiKey');
const { attachUserRole } = require('../../src/middleware/rbac');
const receiptRouter = require('../../src/routes/receipt');
const Transaction = require('../../src/models/transaction');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(requireApiKey);
  app.use(attachUserRole());
  app.use('/donations', receiptRouter);
  app.use((err, req, res, _next) => {
    res.status(err.statusCode || err.status || 500).json({ success: false, error: err.message });
  });
  return app;
}

let app;

beforeAll(() => {
  // Clean slate
  if (fs.existsSync(tmpDbPath)) fs.unlinkSync(tmpDbPath);
  app = createApp();
});

beforeEach(() => {
  // Fresh transaction store per test
  if (fs.existsSync(tmpDbPath)) fs.unlinkSync(tmpDbPath);
});

afterAll(() => {
  if (fs.existsSync(tmpDbPath)) fs.unlinkSync(tmpDbPath);
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDonation(overrides = {}) {
  return Transaction.create({
    amount: 10,
    donor: 'GDONORPUBLICKEY1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ0001',
    recipient: 'GRECIPPUBLICKEY1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ002',
    stellarTxId: 'abc123txhash',
    timestamp: new Date().toISOString(),
    memo: '',
    ...overrides,
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('#909 — GET /donations/:id/receipt', () => {
  test('returns application/pdf with non-empty body for a confirmed donation', async () => {
    const txn = makeDonation({ status: 'confirmed' });

    const res = await request(app)
      .get(`/donations/${txn.id}/receipt`)
      .set('X-API-Key', 'test-909-key');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(res.headers['content-disposition']).toContain(`receipt-${txn.id}.pdf`);
    expect(res.body).toBeTruthy();
    expect(res.headers['content-length']).toBeDefined();
    expect(Number(res.headers['content-length'])).toBeGreaterThan(0);
  });

  test('?format=json returns receipt data with all required fields', async () => {
    const txn = makeDonation({ status: 'confirmed' });

    const res = await request(app)
      .get(`/donations/${txn.id}/receipt?format=json`)
      .set('X-API-Key', 'test-909-key');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const data = res.body.data;
    expect(data).toHaveProperty('receiptNumber');
    expect(data).toHaveProperty('donationDate');
    expect(data).toHaveProperty('amountXLM');
    expect(data).toHaveProperty('donorPublicKey');
    expect(data).toHaveProperty('recipientPublicKey');
    expect(data).toHaveProperty('transactionHash');
    expect(data).toHaveProperty('confirmationStatus');
    expect(data).toHaveProperty('explorerUrl');
  });

  test('returns 404 for a non-existent donation', async () => {
    const res = await request(app)
      .get('/donations/NON_EXISTENT_ID_909/receipt')
      .set('X-API-Key', 'test-909-key');

    expect(res.status).toBe(404);
  });

  test('unconfirmed donation generates a receipt with PENDING CONFIRMATION status', async () => {
    const txn = makeDonation({ status: 'pending' });

    const res = await request(app)
      .get(`/donations/${txn.id}/receipt?format=json`)
      .set('X-API-Key', 'test-909-key');

    expect(res.status).toBe(200);
    expect(res.body.data.confirmationStatus).toBe('PENDING CONFIRMATION');
  });

  test('unconfirmed donation still returns a PDF (not rejected)', async () => {
    const txn = makeDonation({ status: 'pending' });

    const res = await request(app)
      .get(`/donations/${txn.id}/receipt`)
      .set('X-API-Key', 'test-909-key');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
  });

  test('donor public key is masked by default (first 8 + last 4 chars)', async () => {
    const fullKey = 'GDONORPUBLICKEY1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ0001';
    const txn = makeDonation({ status: 'confirmed', donor: fullKey });

    const res = await request(app)
      .get(`/donations/${txn.id}/receipt?format=json`)
      .set('X-API-Key', 'test-909-key');

    expect(res.status).toBe(200);
    const maskedDonor = res.body.data.donorPublicKey;
    expect(maskedDonor).not.toBe(fullKey);
    expect(maskedDonor).toContain('...');
    // Starts with first 8 chars
    expect(maskedDonor.startsWith(fullKey.slice(0, 8))).toBe(true);
    // Ends with last 4 chars
    expect(maskedDonor.endsWith(fullKey.slice(-4))).toBe(true);
  });

  test('public keys are included unmasked when ?fullKey=true', async () => {
    const fullKey = 'GDONORPUBLICKEY1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ0001';
    const txn = makeDonation({ status: 'confirmed', donor: fullKey });

    const res = await request(app)
      .get(`/donations/${txn.id}/receipt?format=json&fullKey=true`)
      .set('X-API-Key', 'test-909-key');

    expect(res.status).toBe(200);
    expect(res.body.data.donorPublicKey).toBe(fullKey);
  });

  test('receipt number is included in JSON response', async () => {
    const txn = makeDonation({ status: 'confirmed' });

    const res = await request(app)
      .get(`/donations/${txn.id}/receipt?format=json`)
      .set('X-API-Key', 'test-909-key');

    expect(res.status).toBe(200);
    expect(res.body.data.receiptNumber).toMatch(/^RCP-/);
  });
});
