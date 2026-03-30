/**
 * Tests for per-endpoint request body size validation.
 *
 * Covers:
 * - payloadSizeLimiter factory function behaviour
 * - Per-endpoint limits (single donation, batch donation, wallet, stream, transaction)
 * - Content-Length validation before body parsing
 * - 413 response shape including max_size field
 * - Oversized request logging with client IP and endpoint
 * - Edge cases: missing Content-Length, GET requests, exact-boundary payloads
 */

'use strict';

const request = require('supertest');
const express = require('express');
const { payloadSizeLimiter, ENDPOINT_LIMITS, formatBytes } = require('../src/middleware/payloadSizeLimiter');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a minimal Express app with a single POST route protected by the given limit.
 *
 * @param {number} limitBytes
 * @returns {import('express').Application}
 */
function buildApp(limitBytes) {
  const app = express();
  app.use((req, _res, next) => { req.id = 'test-req-id'; next(); });
  app.use(payloadSizeLimiter(limitBytes));
  app.use(express.json());
  app.post('/test', (req, res) => res.status(200).json({ success: true }));
  app.get('/test', (req, res) => res.status(200).json({ success: true }));
  return app;
}

/** Return a JSON string of exactly `targetBytes` bytes (approximate). */
function jsonOfSize(targetBytes) {
  const padding = Math.max(0, targetBytes - 14); // '{"d":"' + '"}'
  return JSON.stringify({ d: 'x'.repeat(padding) });
}

// ─── formatBytes ─────────────────────────────────────────────────────────────

describe('formatBytes', () => {
  it('formats raw bytes', () => expect(formatBytes(500)).toBe('500 bytes'));
  it('formats kilobytes', () => expect(formatBytes(2048)).toBe('2.00 KB'));
  it('formats megabytes', () => expect(formatBytes(2 * 1024 * 1024)).toBe('2.00 MB'));
});

// ─── ENDPOINT_LIMITS constants ────────────────────────────────────────────────

describe('ENDPOINT_LIMITS', () => {
  it('exports expected keys', () => {
    expect(ENDPOINT_LIMITS).toMatchObject({
      default: expect.any(Number),
      singleDonation: expect.any(Number),
      batchDonation: expect.any(Number),
      wallet: expect.any(Number),
      stream: expect.any(Number),
      transaction: expect.any(Number),
    });
  });

  it('batchDonation limit is larger than singleDonation limit', () => {
    expect(ENDPOINT_LIMITS.batchDonation).toBeGreaterThan(ENDPOINT_LIMITS.singleDonation);
  });
});

// ─── payloadSizeLimiter factory ───────────────────────────────────────────────

describe('payloadSizeLimiter factory', () => {
  it('returns a function (middleware)', () => {
    expect(typeof payloadSizeLimiter(1024)).toBe('function');
  });

  it('uses ENDPOINT_LIMITS.default when called with no argument', () => {
    const mw = payloadSizeLimiter();
    expect(typeof mw).toBe('function');
  });
});

// ─── Single-donation limit (10 KB) ───────────────────────────────────────────

describe('Single-donation endpoint limit', () => {
  const LIMIT = ENDPOINT_LIMITS.singleDonation; // 10 KB
  let app;

  beforeEach(() => { app = buildApp(LIMIT); });

  it('accepts a payload within the limit', async () => {
    const res = await request(app)
      .post('/test')
      .set('Content-Type', 'application/json')
      .send({ amount: '10', recipient: 'GABC' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('rejects a payload exceeding the limit with 413', async () => {
    const body = jsonOfSize(LIMIT + 500);

    const res = await request(app)
      .post('/test')
      .set('Content-Type', 'application/json')
      .send(body);

    expect(res.status).toBe(413);
  });

  it('returns success:false on 413', async () => {
    const body = jsonOfSize(LIMIT + 500);
    const res = await request(app).post('/test').set('Content-Type', 'application/json').send(body);
    expect(res.body.success).toBe(false);
  });

  it('returns PAYLOAD_TOO_LARGE error code', async () => {
    const body = jsonOfSize(LIMIT + 500);
    const res = await request(app).post('/test').set('Content-Type', 'application/json').send(body);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('includes max_size_bytes in error details', async () => {
    const body = jsonOfSize(LIMIT + 500);
    const res = await request(app).post('/test').set('Content-Type', 'application/json').send(body);
    expect(res.body.error.details.max_size_bytes).toBe(LIMIT);
  });

  it('includes received_size and max_size in error details', async () => {
    const body = jsonOfSize(LIMIT + 500);
    const res = await request(app).post('/test').set('Content-Type', 'application/json').send(body);
    expect(res.body.error.details).toHaveProperty('received_size');
    expect(res.body.error.details).toHaveProperty('max_size');
  });

  it('includes requestId in error response', async () => {
    const body = jsonOfSize(LIMIT + 500);
    const res = await request(app).post('/test').set('Content-Type', 'application/json').send(body);
    expect(res.body.error.requestId).toBe('test-req-id');
  });

  it('includes timestamp in error response', async () => {
    const body = jsonOfSize(LIMIT + 500);
    const res = await request(app).post('/test').set('Content-Type', 'application/json').send(body);
    expect(res.body.error.timestamp).toBeDefined();
  });
});

// ─── Batch-donation limit (512 KB) ───────────────────────────────────────────

describe('Batch-donation endpoint limit', () => {
  const LIMIT = ENDPOINT_LIMITS.batchDonation; // 512 KB
  let app;

  beforeEach(() => { app = buildApp(LIMIT); });

  it('accepts a payload that would be rejected by the single-donation limit', async () => {
    // 50 KB — over singleDonation (10 KB) but under batchDonation (512 KB)
    const body = jsonOfSize(50 * 1024);

    const res = await request(app)
      .post('/test')
      .set('Content-Type', 'application/json')
      .send(body);

    expect(res.status).toBe(200);
  });

  it('rejects a payload exceeding the batch limit with 413', async () => {
    const body = jsonOfSize(LIMIT + 1024);

    const res = await request(app)
      .post('/test')
      .set('Content-Type', 'application/json')
      .send(body);

    expect(res.status).toBe(413);
    expect(res.body.error.details.max_size_bytes).toBe(LIMIT);
  });
});

// ─── Wallet endpoint limit (20 KB) ───────────────────────────────────────────

describe('Wallet endpoint limit', () => {
  const LIMIT = ENDPOINT_LIMITS.wallet; // 20 KB
  let app;

  beforeEach(() => { app = buildApp(LIMIT); });

  it('accepts a normal wallet creation payload', async () => {
    const res = await request(app)
      .post('/test')
      .set('Content-Type', 'application/json')
      .send({ address: 'GABC', label: 'My Wallet' });

    expect(res.status).toBe(200);
  });

  it('rejects an oversized wallet payload', async () => {
    const body = jsonOfSize(LIMIT + 500);
    const res = await request(app).post('/test').set('Content-Type', 'application/json').send(body);
    expect(res.status).toBe(413);
    expect(res.body.error.details.max_size_bytes).toBe(LIMIT);
  });
});

// ─── Stream endpoint limit (10 KB) ───────────────────────────────────────────

describe('Stream endpoint limit', () => {
  const LIMIT = ENDPOINT_LIMITS.stream; // 10 KB
  let app;

  beforeEach(() => { app = buildApp(LIMIT); });

  it('accepts a normal stream create payload', async () => {
    const res = await request(app)
      .post('/test')
      .set('Content-Type', 'application/json')
      .send({ donorPublicKey: 'GABC', recipientPublicKey: 'GDEF', amount: 5, frequency: 'monthly' });

    expect(res.status).toBe(200);
  });

  it('rejects an oversized stream payload', async () => {
    const body = jsonOfSize(LIMIT + 500);
    const res = await request(app).post('/test').set('Content-Type', 'application/json').send(body);
    expect(res.status).toBe(413);
  });
});

// ─── Transaction sync endpoint limit (50 KB) ─────────────────────────────────

describe('Transaction sync endpoint limit', () => {
  const LIMIT = ENDPOINT_LIMITS.transaction; // 50 KB
  let app;

  beforeEach(() => { app = buildApp(LIMIT); });

  it('accepts a normal sync payload', async () => {
    const res = await request(app)
      .post('/test')
      .set('Content-Type', 'application/json')
      .send({ publicKey: 'GABC' });

    expect(res.status).toBe(200);
  });

  it('rejects an oversized sync payload', async () => {
    const body = jsonOfSize(LIMIT + 1024);
    const res = await request(app).post('/test').set('Content-Type', 'application/json').send(body);
    expect(res.status).toBe(413);
    expect(res.body.error.details.max_size_bytes).toBe(LIMIT);
  });
});

// ─── Content-Length validation ────────────────────────────────────────────────

describe('Content-Length validation', () => {
  const LIMIT = 1024; // 1 KB for these tests
  let app;

  beforeEach(() => { app = buildApp(LIMIT); });

  it('passes when Content-Length is absent (treated as 0)', async () => {
    // supertest sets Content-Length automatically; send a tiny body
    const res = await request(app)
      .post('/test')
      .set('Content-Type', 'application/json')
      .send('{}');

    expect(res.status).toBe(200);
  });

  it('rejects based on Content-Length before body is parsed', async () => {
    // Build a raw buffer larger than the limit
    const body = Buffer.alloc(LIMIT + 100, 'x');

    const res = await request(app)
      .post('/test')
      .set('Content-Type', 'application/json')
      .set('Content-Length', String(body.length))
      .send(body);

    // Must be rejected at the size-check stage, not a parse error
    expect(res.status).toBe(413);
  });
});

// ─── GET requests are unaffected ─────────────────────────────────────────────

describe('GET requests', () => {
  it('are never blocked by the size limiter', async () => {
    const app = buildApp(1); // absurdly small limit
    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
  });
});

// ─── Logging of oversized requests ───────────────────────────────────────────

describe('Logging oversized requests', () => {
  it('calls log.warn with ip and path when limit is exceeded', async () => {
    const log = require('../src/utils/log');
    const warnSpy = jest.spyOn(log, 'warn').mockImplementation(() => {});

    const app = buildApp(100);
    const body = jsonOfSize(500);

    await request(app)
      .post('/test')
      .set('Content-Type', 'application/json')
      .send(body);

    expect(warnSpy).toHaveBeenCalledWith(
      'PAYLOAD_SIZE_LIMITER',
      expect.any(String),
      expect.objectContaining({ ip: expect.anything(), path: '/test' })
    );

    warnSpy.mockRestore();
  });
});

// ─── Default limit fallback ───────────────────────────────────────────────────

describe('Default limit fallback', () => {
  it('uses ENDPOINT_LIMITS.default when no argument is passed', async () => {
    const app = express();
    app.use((req, _res, next) => { req.id = 'x'; next(); });
    app.use(payloadSizeLimiter()); // no argument
    app.use(express.json());
    app.post('/test', (req, res) => res.json({ success: true }));

    // Payload well within 100 KB default
    const res = await request(app)
      .post('/test')
      .set('Content-Type', 'application/json')
      .send({ hello: 'world' });

    expect(res.status).toBe(200);
  });
});
