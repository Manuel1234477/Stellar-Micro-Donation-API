'use strict';
/**
 * Tests for #777: GET /donations/:id/receipt — downloadable donation receipts
 */

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-777-key';
process.env.NODE_ENV = 'test';

const request = require('supertest');
const express = require('express');
const path = require('path');
const fs = require('fs');
const Transaction = require('../../src/routes/models/transaction');
const donationRouter = require('../../src/routes/donation');
const requireApiKey = require('../../src/middleware/apiKey');
const { attachUserRole } = require('../../src/middleware/rbac');

const TEST_DB = path.join(__dirname, '../data/test-777-transactions.json');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(requireApiKey);
  app.use(attachUserRole());
  app.use('/donations', donationRouter);
  app.use((err, req, res, _next) => {
    res.status(err.status || 500).json({ success: false, error: err.message });
  });
  return app;
}

let app;

beforeAll(() => {
  Transaction.getDbPath = () => TEST_DB;
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  app = createApp();
});

afterAll(() => {
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
});

beforeEach(() => {
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
});

describe('#777 — GET /donations/:id/receipt', () => {
  test('returns a PDF for a confirmed donation', async () => {
    const tx = Transaction.create({
      id: 'receipt-777-confirmed',
      amount: 10,
      donor: 'GDONOR777A',
      recipient: 'GRECIPIENT777A',
      status: 'confirmed',
      stellarTxId: 'd'.repeat(64),
    });

    const res = await request(app)
      .get(`/donations/${tx.id}/receipt`)
      .set('x-api-key', 'test-777-key');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(res.body).toBeDefined();
  });

  test('receipt is accessible with a valid API key (donor/admin)', async () => {
    const tx = Transaction.create({
      id: 'receipt-777-access',
      amount: 5,
      donor: 'GDONOR777B',
      recipient: 'GRECIPIENT777B',
      status: 'confirmed',
      stellarTxId: 'e'.repeat(64),
    });

    const res = await request(app)
      .get(`/donations/${tx.id}/receipt`)
      .set('x-api-key', 'test-777-key');

    expect(res.status).toBe(200);
  });

  test('returns 404 for a non-existent donation', async () => {
    const res = await request(app)
      .get('/donations/nonexistent-777/receipt')
      .set('x-api-key', 'test-777-key');

    expect(res.status).toBe(404);
  });

  test('returns 401 without API key', async () => {
    const tx = Transaction.create({
      id: 'receipt-777-noauth',
      amount: 2,
      donor: 'GDONOR777C',
      recipient: 'GRECIPIENT777C',
      status: 'confirmed',
      stellarTxId: 'f'.repeat(64),
    });

    const res = await request(app)
      .get(`/donations/${tx.id}/receipt`);

    expect(res.status).toBe(401);
  });
});
