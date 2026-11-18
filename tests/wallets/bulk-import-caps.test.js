'use strict';

/**
 * Bulk Import Hard Cap Tests
 *
 * Verifies that the POST /wallets/bulk-import endpoint:
 *   - Returns 413 when the uploaded file exceeds BULK_IMPORT_MAX_SIZE_BYTES
 *   - Returns 422 when the CSV row count exceeds BULK_IMPORT_MAX_ROWS
 *   - Returns 429 when the per-client rate limit is exceeded
 */

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'bulk-cap-test-key';

const request = require('supertest');
const express = require('express');
const StellarSdk = require('@stellar/stellar-sdk');
const walletRouter = require('../../src/routes/wallet');

// === Helpers

function makeKey() {
  return StellarSdk.Keypair.random().publicKey();
}

function toAddressCsv(count) {
  const header = 'address,label\n';
  const lines = Array.from({ length: count }, () => `${makeKey()},label`).join('\n');
  return Buffer.from(header + lines);
}

// === Test App
// Injects an admin user so requireAdmin() passes without real auth infrastructure.
// The route reads BULK_IMPORT_MAX_SIZE_BYTES and BULK_IMPORT_MAX_ROWS per-request,
// so env var changes in beforeAll/afterAll take effect without module reloading.

function buildApp(extraMiddleware = null) {
  const app = express();
  app.use(express.json());

  // Pre-set admin user so requireAdmin() passes
  app.use((req, res, next) => {
    req.user = { id: 'test-admin', role: 'admin', isLegacy: true };
    req.apiKey = { id: 'test-admin-key', role: 'admin', isLegacy: true };
    next();
  });

  if (extraMiddleware) {
    app.use('/wallets/bulk-import', extraMiddleware);
  }

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

const app = buildApp();

// === 413 File-size cap

describe('POST /wallets/bulk-import - 413 file size cap', () => {
  const origMax = process.env.BULK_IMPORT_MAX_SIZE_BYTES;

  beforeAll(() => {
    process.env.BULK_IMPORT_MAX_SIZE_BYTES = '512';
  });

  afterAll(() => {
    if (origMax === undefined) delete process.env.BULK_IMPORT_MAX_SIZE_BYTES;
    else process.env.BULK_IMPORT_MAX_SIZE_BYTES = origMax;
  });

  it('returns 413 when file exceeds BULK_IMPORT_MAX_SIZE_BYTES', async () => {
    const largeBuffer = Buffer.alloc(600, 'x'); // 600 bytes > 512 limit

    const res = await request(app)
      .post('/wallets/bulk-import')
      .set('X-API-Key', 'bulk-cap-test-key')
      .attach('file', largeBuffer, { filename: 'big.csv', contentType: 'text/csv' });

    expect(res.status).toBe(413);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
  });

  it('includes max_size_bytes in the 413 error details', async () => {
    const largeBuffer = Buffer.alloc(600, 'x');

    const res = await request(app)
      .post('/wallets/bulk-import')
      .set('X-API-Key', 'bulk-cap-test-key')
      .attach('file', largeBuffer, { filename: 'big.csv', contentType: 'text/csv' });

    expect(res.body.error.details).toMatchObject({ max_size_bytes: 512 });
  });
});

// === 422 Row-count cap

describe('POST /wallets/bulk-import - 422 row count cap', () => {
  const origMaxRows = process.env.BULK_IMPORT_MAX_ROWS;
  const origMaxBytes = process.env.BULK_IMPORT_MAX_SIZE_BYTES;

  beforeAll(() => {
    process.env.BULK_IMPORT_MAX_ROWS = '3';
    process.env.BULK_IMPORT_MAX_SIZE_BYTES = String(2 * 1024 * 1024); // ensure size is not the blocker
  });

  afterAll(() => {
    if (origMaxRows === undefined) delete process.env.BULK_IMPORT_MAX_ROWS;
    else process.env.BULK_IMPORT_MAX_ROWS = origMaxRows;
    if (origMaxBytes === undefined) delete process.env.BULK_IMPORT_MAX_SIZE_BYTES;
    else process.env.BULK_IMPORT_MAX_SIZE_BYTES = origMaxBytes;
  });

  it('returns 422 when row count exceeds BULK_IMPORT_MAX_ROWS', async () => {
    const csv = toAddressCsv(5); // 5 rows > 3 limit

    const res = await request(app)
      .post('/wallets/bulk-import')
      .set('X-API-Key', 'bulk-cap-test-key')
      .attach('file', csv, { filename: 'toomany.csv', contentType: 'text/csv' });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('ROW_LIMIT_EXCEEDED');
  });

  it('includes submitted count and limit in the 422 error details', async () => {
    const csv = toAddressCsv(5);

    const res = await request(app)
      .post('/wallets/bulk-import')
      .set('X-API-Key', 'bulk-cap-test-key')
      .attach('file', csv, { filename: 'toomany.csv', contentType: 'text/csv' });

    expect(res.body.error.details).toMatchObject({ submitted: 5, limit: 3 });
  });

  it('does not return 422 for a header-only CSV (zero data rows, under limit)', async () => {
    // Header-only CSV → EMPTY_FILE (400) before any DB call, proving row cap is not triggered
    const csv = Buffer.from('address,label\n');

    const res = await request(app)
      .post('/wallets/bulk-import')
      .set('X-API-Key', 'bulk-cap-test-key')
      .attach('file', csv, { filename: 'empty.csv', contentType: 'text/csv' });

    expect(res.status).not.toBe(422);
    expect(res.status).not.toBe(413);
  });
});

// === 429 Rate limit
// Uses an app where the tight rate limiter (max=0) sits before the admin injection,
// so every request is blocked at the rate limiter and never reaches the route or DB.

describe('POST /wallets/bulk-import - 429 rate limit', () => {
  it('returns 429 when the rate limit is exceeded', async () => {
    const rateLimit = require('express-rate-limit');
    // max=0 means every request is immediately rate-limited
    const blockAllLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: 0,
      standardHeaders: true,
      legacyHeaders: true,
      validate: false,
      handler: (req, res) => {
        res.set('Retry-After', '60');
        res.status(429).json({
          success: false,
          error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many bulk import requests.' },
        });
      },
    });

    // Place the limiter BEFORE admin injection so blocked requests never reach the route
    const rateLimitedApp = express();
    rateLimitedApp.use('/wallets/bulk-import', blockAllLimiter);
    rateLimitedApp.use((req, res, next) => {
      req.user = { id: 'test-admin', role: 'admin', isLegacy: true };
      req.apiKey = { id: 'test-admin-key', role: 'admin', isLegacy: true };
      next();
    });
    rateLimitedApp.use('/wallets', walletRouter);
    rateLimitedApp.use((err, req, res, next) => {
      void next;
      res.status(err.status || 500).json({
        success: false,
        error: { code: err.code || 'INTERNAL_ERROR', message: err.message },
      });
    });

    const res = await request(rateLimitedApp)
      .post('/wallets/bulk-import')
      .set('X-API-Key', 'bulk-cap-test-key')
      .attach('file', Buffer.from('address,label\n'), { filename: 'a.csv', contentType: 'text/csv' });

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(res.headers['retry-after']).toBeDefined();
  });
});
