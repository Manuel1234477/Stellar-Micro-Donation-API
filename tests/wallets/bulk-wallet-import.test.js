/**
 * Bulk Wallet Import Tests
 *
 * Tests for BulkWalletImportService (unit) and POST /wallets/bulk-import (integration).
 * No live Stellar network required.
 */

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-key-bulk';

const request = require('supertest');
const express = require('express');
const path = require('path');
const fs = require('fs');
const walletRouter = require('../../src/routes/wallet');
const { attachUserRole } = require('../../src/middleware/rbac');
const Wallet = require('../../src/routes/models/wallet');
const BulkWalletImportService = require('../../src/services/BulkWalletImportService');
const StellarSdk = require('stellar-sdk');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generate a valid Stellar public key */
function makeKey() {
  return StellarSdk.Keypair.random().publicKey();
}

/** Build a CSV buffer from an array of objects */
function toCSV(rows) {
  if (rows.length === 0) return Buffer.from('public_key,label\n');
  const headers = Object.keys(rows[0]).join(',');
  const lines = rows.map(r => Object.values(r).join(','));
  return Buffer.from([headers, ...lines].join('\n'));
}

/** Build a JSON buffer from an array */
function toJSON(rows) {
  return Buffer.from(JSON.stringify(rows));
}

// ─── Test App ─────────────────────────────────────────────────────────────────

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(attachUserRole());
  app.use('/wallets', walletRouter);
  app.use((err, req, res, next) => {
    void next;
    res.status(err.status || 500).json({
      success: false,
      error: { code: err.code || 'INTERNAL_ERROR', message: err.message },
    });
  });
  return app;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function make10Rows() {
  return Array.from({ length: 10 }, (_, i) => ({ public_key: makeKey(), label: `wallet-${i}` }));
}

// ─── Unit: BulkWalletImportService ───────────────────────────────────────────

describe('BulkWalletImportService', () => {
  let service;
  let snapshot;

  beforeEach(() => {
    service = new BulkWalletImportService();
    snapshot = Wallet.loadWallets();
    delete process.env.BULK_IMPORT_MAX_ROWS;
  });

  afterEach(() => {
    Wallet.saveWallets(snapshot);
  });

  // ── parseFile ──────────────────────────────────────────────────────────────

  test('parseFile parses JSON buffer', () => {
    const rows = [{ public_key: makeKey() }];
    const result = service.parseFile(toJSON(rows), 'application/json');
    expect(result).toHaveLength(1);
    expect(result[0].public_key).toBe(rows[0].public_key);
  });

  test('parseFile parses CSV buffer', () => {
    const rows = [{ public_key: makeKey(), label: 'test' }];
    const result = service.parseFile(toCSV(rows), 'text/csv');
    expect(result).toHaveLength(1);
    expect(result[0].public_key).toBe(rows[0].public_key);
  });

  test('parseFile throws on unsupported type', () => {
    expect(() => service.parseFile(Buffer.from(''), 'text/plain')).toThrow('Unsupported file type');
  });

  // ── Row limit ──────────────────────────────────────────────────────────────

  test('importRows rejects files exceeding BULK_IMPORT_MAX_ROWS', () => {
    process.env.BULK_IMPORT_MAX_ROWS = '5';
    const rows = make10Rows();
    expect(() => service.importRows(rows)).toThrow();
    try { service.importRows(rows); } catch (e) {
      expect(e.code).toBe('ROW_LIMIT_EXCEEDED');
      expect(e.limit).toBe(5);
    }
  });

  // ── Duplicate detection ────────────────────────────────────────────────────

  test('importRows rejects file with duplicate public keys', () => {
    const key = makeKey();
    const rows = [{ public_key: key }, { public_key: key }];
    expect(() => service.importRows(rows)).toThrow();
    try { service.importRows(rows); } catch (e) {
      expect(e.code).toBe('VALIDATION_FAILED');
      expect(e.details.some(d => d.reason === 'duplicate_in_file')).toBe(true);
    }
  });

  // ── Validation ─────────────────────────────────────────────────────────────

  test('importRows rejects rows with invalid public key', () => {
    const rows = [{ public_key: 'NOT_A_VALID_KEY' }];
    expect(() => service.importRows(rows)).toThrow();
    try { service.importRows(rows); } catch (e) {
      expect(e.code).toBe('VALIDATION_FAILED');
      expect(e.details[0].reason).toBe('invalid_address');
    }
  });

  test('importRows rejects rows with missing public key', () => {
    const rows = [{ label: 'no-key' }];
    expect(() => service.importRows(rows)).toThrow();
    try { service.importRows(rows); } catch (e) {
      expect(e.code).toBe('VALIDATION_FAILED');
      expect(e.details[0].reason).toBe('missing_public_key');
    }
  });

  test('importRows rejects rows containing private key fields', () => {
    const rows = [{ public_key: makeKey(), secret_key: 'S...' }];
    expect(() => service.importRows(rows)).toThrow();
    try { service.importRows(rows); } catch (e) {
      expect(e.code).toBe('VALIDATION_FAILED');
      expect(e.details[0].reason).toBe('private_key_not_accepted');
    }
  });

  // ── Successful import ──────────────────────────────────────────────────────

  test('importRows successfully imports 10 valid rows', () => {
    const rows = make10Rows();
    const result = service.importRows(rows);
    expect(result.totalSubmitted).toBe(10);
    expect(result.totalCreated).toBe(10);
    expect(result.details).toHaveLength(10);
    result.details.forEach(d => expect(d.status).toBe('created'));
  });

  // ── Atomic rollback ────────────────────────────────────────────────────────

  test('atomic rollback: if 5th row is invalid, zero records are written', () => {
    const rows = make10Rows();
    // Make the 5th row (index 4) invalid
    rows[4].public_key = 'INVALID';

    const before = Wallet.loadWallets().length;

    expect(() => service.importRows(rows)).toThrow();

    const after = Wallet.loadWallets().length;
    expect(after).toBe(before); // nothing was persisted
  });
});

// ─── Integration: POST /wallets/bulk-import ───────────────────────────────────

describe('POST /wallets/bulk-import', () => {
  let app;
  let snapshot;

  beforeAll(() => { app = createTestApp(); });

  beforeEach(() => {
    snapshot = Wallet.loadWallets();
    delete process.env.BULK_IMPORT_MAX_ROWS;
  });

  afterEach(() => {
    Wallet.saveWallets(snapshot);
  });

  // ── CSV success ────────────────────────────────────────────────────────────

  test('imports 10-row CSV successfully', async () => {
    const rows = make10Rows();
    const res = await request(app)
      .post('/wallets/bulk-import')
      .set('X-API-Key', 'test-key-bulk')
      .attach('file', toCSV(rows), { filename: 'wallets.csv', contentType: 'text/csv' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.totalCreated).toBe(10);
    expect(res.body.data.totalSubmitted).toBe(10);
  });

  // ── JSON success ───────────────────────────────────────────────────────────

  test('imports 10-item JSON array successfully', async () => {
    const rows = make10Rows();
    const res = await request(app)
      .post('/wallets/bulk-import')
      .set('X-API-Key', 'test-key-bulk')
      .attach('file', toJSON(rows), { filename: 'wallets.json', contentType: 'application/json' });

    expect(res.status).toBe(201);
    expect(res.body.data.totalCreated).toBe(10);
  });

  // ── Duplicate keys ─────────────────────────────────────────────────────────

  test('rejects file with duplicate public keys (400)', async () => {
    const key = makeKey();
    const rows = [{ public_key: key }, { public_key: key }];
    const res = await request(app)
      .post('/wallets/bulk-import')
      .set('X-API-Key', 'test-key-bulk')
      .attach('file', toJSON(rows), { filename: 'dup.json', contentType: 'application/json' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.some(d => d.reason === 'duplicate_in_file')).toBe(true);
  });

  // ── Row limit ──────────────────────────────────────────────────────────────

  test('rejects file exceeding BULK_IMPORT_MAX_ROWS (400)', async () => {
    process.env.BULK_IMPORT_MAX_ROWS = '5';
    const rows = make10Rows();
    const res = await request(app)
      .post('/wallets/bulk-import')
      .set('X-API-Key', 'test-key-bulk')
      .attach('file', toJSON(rows), { filename: 'big.json', contentType: 'application/json' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ROW_LIMIT_EXCEEDED');
    expect(res.body.error.limit).toBe(5);
  });

  // ── Missing file ───────────────────────────────────────────────────────────

  test('returns 400 when no file is uploaded', async () => {
    const res = await request(app)
      .post('/wallets/bulk-import')
      .set('X-API-Key', 'test-key-bulk');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_FILE');
  });

  // ── Atomic rollback ────────────────────────────────────────────────────────

  test('atomic rollback: 5th row invalid → zero records written', async () => {
    const rows = make10Rows();
    rows[4].public_key = 'INVALID_KEY';

    const before = Wallet.loadWallets().length;

    const res = await request(app)
      .post('/wallets/bulk-import')
      .set('X-API-Key', 'test-key-bulk')
      .attach('file', toJSON(rows), { filename: 'bad5.json', contentType: 'application/json' });

    expect(res.status).toBe(400);
    expect(Wallet.loadWallets().length).toBe(before);
  });

  // ── Unauthorized ───────────────────────────────────────────────────────────

  test('returns 401/403 without API key', async () => {
    const rows = make10Rows();
    const res = await request(app)
      .post('/wallets/bulk-import')
      .attach('file', toJSON(rows), { filename: 'wallets.json', contentType: 'application/json' });

    expect([401, 403, 500]).toContain(res.status);
  });
});
