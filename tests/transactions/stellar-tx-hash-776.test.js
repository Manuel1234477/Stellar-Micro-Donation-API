'use strict';
/**
 * Tests for #776: GET /transactions and GET /transactions/:id must include stellarTxHash
 */

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-776-key';
process.env.NODE_ENV = 'test';

const request = require('supertest');
const express = require('express');
const path = require('path');
const fs = require('fs');
const Transaction = require('../../src/routes/models/transaction');
const transactionRouter = require('../../src/routes/transaction');
const requireApiKey = require('../../src/middleware/apiKey');
const { attachUserRole } = require('../../src/middleware/rbac');

const TEST_DB = path.join(__dirname, '../data/test-776-transactions.json');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(requireApiKey);
  app.use(attachUserRole());
  app.use('/transactions', transactionRouter);
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

describe('#776 — stellarTxHash in transaction responses', () => {
  test('GET /transactions includes stellarTxHash for confirmed transaction', async () => {
    Transaction.create({
      id: 'tx-776-confirmed',
      amount: 5,
      donor: 'GDONOR1',
      recipient: 'GRECIPIENT1',
      status: 'confirmed',
      stellarTxId: 'a'.repeat(64),
    });

    const res = await request(app)
      .get('/transactions')
      .set('x-api-key', 'test-776-key');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const tx = res.body.data.find(t => t.id === 'tx-776-confirmed');
    expect(tx).toBeDefined();
    expect(tx).toHaveProperty('stellarTxHash');
    expect(tx.stellarTxHash).toBe('a'.repeat(64));
  });

  test('GET /transactions includes stellarTxHash as null for pending transaction', async () => {
    Transaction.create({
      id: 'tx-776-pending',
      amount: 3,
      donor: 'GDONOR2',
      recipient: 'GRECIPIENT2',
      status: 'pending',
      stellarTxId: null,
    });

    const res = await request(app)
      .get('/transactions')
      .set('x-api-key', 'test-776-key');

    expect(res.status).toBe(200);
    const tx = res.body.data.find(t => t.id === 'tx-776-pending');
    expect(tx).toBeDefined();
    expect(tx.stellarTxHash).toBeNull();
  });

  test('GET /transactions/:id returns stellarTxHash for a known transaction', async () => {
    const created = Transaction.create({
      id: 'tx-776-byid',
      amount: 7,
      donor: 'GDONOR3',
      recipient: 'GRECIPIENT3',
      status: 'confirmed',
      stellarTxId: 'b'.repeat(64),
    });

    const res = await request(app)
      .get(`/transactions/${created.id}`)
      .set('x-api-key', 'test-776-key');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('stellarTxHash', 'b'.repeat(64));
  });

  test('GET /transactions/:id returns 404 for unknown id', async () => {
    const res = await request(app)
      .get('/transactions/nonexistent-id-776')
      .set('x-api-key', 'test-776-key');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  test('stellarTxHash is a 64-char hex string when present', async () => {
    const hash = 'c'.repeat(64);
    Transaction.create({
      id: 'tx-776-hexcheck',
      amount: 1,
      donor: 'GDONOR4',
      recipient: 'GRECIPIENT4',
      status: 'confirmed',
      stellarTxId: hash,
    });

    const res = await request(app)
      .get('/transactions/tx-776-hexcheck')
      .set('x-api-key', 'test-776-key');

    expect(res.status).toBe(200);
    const { stellarTxHash } = res.body.data;
    expect(typeof stellarTxHash).toBe('string');
    expect(stellarTxHash).toHaveLength(64);
    expect(/^[0-9a-f]+$/i.test(stellarTxHash)).toBe(true);
  });
});
