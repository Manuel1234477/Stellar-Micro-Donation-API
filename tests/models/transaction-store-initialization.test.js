'use strict';

/**
 * Transaction model store initialisation (#1696)
 *
 * - Requiring src/models/transaction.js performs no database I/O.
 * - initialize() loads donations_store and fails loudly when it cannot.
 * - /health/ready reports not-ready until the store has loaded.
 */

const VALID_DONOR = 'GDONOR' + 'A'.repeat(50);
const VALID_RECIPIENT = 'GRECIP' + 'B'.repeat(50);

describe('Transaction model store initialisation', () => {
  let Database;
  let Transaction;

  beforeEach(() => {
    jest.resetModules();
    Database = require('../../src/utils/database');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('performs no database I/O at require time', () => {
    const spies = ['all', 'get', 'query', 'run'].map((m) => jest.spyOn(Database, m));

    Transaction = require('../../src/models/transaction');

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(Transaction.getStoreStatus()).toEqual({ loaded: false, error: null });
  });

  it('initialize() loads persisted donations into the in-memory store', async () => {
    Transaction = require('../../src/models/transaction');
    const record = { id: 'init-test-1', donor: VALID_DONOR, recipient: VALID_RECIPIENT, amount: 10, status: 'pending', idempotencyKey: 'init-idem-1' };
    await Database.run('DELETE FROM donations_store WHERE id = ?', [record.id]);
    await Database.run(
      `INSERT INTO donations_store (id, donor, recipient, amount_text, status, idempotency_key, timestamp, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [record.id, record.donor, record.recipient, '10', 'pending', record.idempotencyKey, new Date().toISOString(), JSON.stringify(record)]
    );

    try {
      await Transaction.initialize();

      expect(Transaction.getStoreStatus()).toEqual({ loaded: true, error: null });
      expect(Transaction.getById(record.id)).toMatchObject({ id: record.id });
      // Idempotency index is rebuilt from the loaded rows
      expect(Transaction.create({ ...record, id: undefined }).id).toBe(record.id);
    } finally {
      await Database.run('DELETE FROM donations_store WHERE id = ?', [record.id]);
    }
  });

  it('initialize() rejects instead of silently starting empty when the table cannot be read', async () => {
    Transaction = require('../../src/models/transaction');
    jest.spyOn(Database, 'all').mockRejectedValue(new Error('no such table: donations_store'));

    await expect(Transaction.initialize()).rejects.toThrow('no such table');
    expect(Transaction.getStoreStatus()).toEqual({ loaded: false, error: 'no such table: donations_store' });

    // A later successful attempt recovers
    Database.all.mockResolvedValue([]);
    await Transaction.initialize();
    expect(Transaction.getStoreStatus()).toEqual({ loaded: true, error: null });
  });
});

describe('GET /health/ready and the donation store', () => {
  let request;
  let app;
  let state;
  let Transaction;
  let Database;

  beforeAll(() => {
    jest.resetModules();
    request = require('supertest');
    app = require('../../src/app');
    state = require('../../src/bootstrap/state');
    Transaction = require('../../src/models/transaction');
    Database = require('../../src/utils/database');
  });

  afterEach(() => {
    state.isInitialized = false;
    jest.restoreAllMocks();
  });

  it('reports not-ready with the load error when the store failed to load', async () => {
    jest.spyOn(Database, 'all').mockRejectedValueOnce(new Error('disk I/O error'));
    await expect(Transaction.initialize()).rejects.toThrow('disk I/O error');
    state.isInitialized = true;

    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('not_ready');
    expect(res.body.reason).toContain('donation store failed to load: disk I/O error');
  });

  it('passes the donation store check once the store has loaded', async () => {
    await Transaction.initialize();
    state.isInitialized = true;

    const res = await request(app).get('/health/ready');

    expect(res.body.reason || '').not.toContain('donation store');
  });
});
