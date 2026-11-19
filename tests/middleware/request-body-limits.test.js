/**
 * Request body parsing limits, media types and HSTS (#1953, #1955, #1956).
 *
 * Mounts the real applyMiddleware() chain on a bare Express app with echo
 * routes, so the global parser, size guard, media-type guard and error handler
 * are exercised together.
 */

'use strict';

const express = require('express');
const request = require('supertest');
const { applyMiddleware, buildHstsOptions } = require('../../src/bootstrap/middleware');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../../src/middleware/payloadSizeLimiter');
const { errorHandler } = require('../../src/middleware/errorHandler');

function buildApp() {
  const app = express();
  applyMiddleware(app);
  const echo = (req, res) => res.status(200).json({ ok: true, body: req.body || null });
  // Mirror the production route-level limits: batch 512 KB, single donation 10 KB.
  app.post('/api/v1/donations/batch', payloadSizeLimiter(ENDPOINT_LIMITS.batchDonation), echo);
  app.post('/api/v1/donations/bulk', payloadSizeLimiter(ENDPOINT_LIMITS.batchDonation), echo);
  app.post('/api/v1/donations', payloadSizeLimiter(ENDPOINT_LIMITS.singleDonation), echo);
  app.post('/api/v1/wallets', echo);
  app.post('/api/v1/auth/token', echo);
  // Simulates the error body-parser raises when a body exceeds its limit.
  app.post('/api/v1/body-too-large', (_req, _res, next) => {
    const err = new Error('request entity too large');
    err.type = 'entity.too.large';
    err.status = 413;
    err.limit = ENDPOINT_LIMITS.batchDonation;
    next(err);
  });
  app.get('/api/v1/health', (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  return app;
}

/** JSON body whose serialised size is approximately `bytes`. */
function jsonBodyOfSize(bytes) {
  return JSON.stringify({ memo: 'x'.repeat(bytes) });
}

describe('batch body size limit (#1953)', () => {
  let app;
  beforeAll(() => {
    app = buildApp();
  });

  test('a 300 KB batch payload reaches the batch handler', async () => {
    const res = await request(app)
      .post('/api/v1/donations/batch')
      .set('Content-Type', 'application/json')
      .send(jsonBodyOfSize(300 * 1024));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('a 600 KB batch payload returns the standard 413 envelope', async () => {
    const res = await request(app)
      .post('/api/v1/donations/batch')
      .set('Content-Type', 'application/json')
      .send(jsonBodyOfSize(600 * 1024));
    expect(res.status).toBe(413);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(res.body.error.requestId).toBeDefined();
  });

  test('a body-parser entity.too.large error is mapped to the standard 413 envelope', async () => {
    // Chunked bodies have no Content-Length, so body-parser raises this error
    // mid-stream. The error handler must return the same envelope as payloadSizeLimiter.
    const res = await request(app).post('/api/v1/body-too-large').set('Content-Type', 'application/json').send('{}');
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(res.body.error.details).toEqual({ max_size_bytes: ENDPOINT_LIMITS.batchDonation });
    expect(res.body.error.requestId).toBeDefined();
  });

  test('a 20 KB single-donation request still returns 413 under its 10 KB limit', async () => {
    const res = await request(app)
      .post('/api/v1/donations')
      .set('Content-Type', 'application/json')
      .send(jsonBodyOfSize(20 * 1024));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  test('other endpoints keep the 100 KB default and reject 150 KB', async () => {
    const res = await request(app)
      .post('/api/v1/wallets')
      .set('Content-Type', 'application/json')
      .send(jsonBodyOfSize(150 * 1024));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('unsupported media types (#1955)', () => {
  let app;
  beforeAll(() => {
    app = buildApp();
  });

  test('form-encoded bodies on a JSON endpoint are rejected with 415', async () => {
    const res = await request(app)
      .post('/api/v1/wallets')
      .type('form')
      .send('address=GABC&label=test');
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  test('text/plain bodies are rejected with 415', async () => {
    const res = await request(app)
      .post('/api/v1/wallets')
      .set('Content-Type', 'text/plain')
      .send('hello');
    expect(res.status).toBe(415);
  });

  test('JSON bodies are still accepted', async () => {
    const res = await request(app)
      .post('/api/v1/wallets')
      .set('Content-Type', 'application/json')
      .send({ label: 'test' });
    expect(res.status).toBe(200);
    expect(res.body.body).toEqual({ label: 'test' });
  });

  test('SEP-10 token path is not blocked by the media-type guard for form-encoded bodies', async () => {
    // The real form parser is mounted on the auth router (src/routes/auth.js).
    // This test only checks that the global guard lets the request reach the route.
    const res = await request(app)
      .post('/api/v1/auth/token')
      .type('form')
      .send('transaction=AAAA');
    expect(res.status).toBe(200);
  });

  test('requests without a body are not affected by the media-type guard', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
  });
});

describe('HSTS (#1956)', () => {
  const production = { NODE_ENV: 'production', HSTS_MAX_AGE: 31536000, HSTS_INCLUDE_SUBDOMAINS: true, HSTS_PRELOAD: false };

  test('is disabled outside production', () => {
    expect(buildHstsOptions({ ...production, NODE_ENV: 'development' })).toBe(false);
    expect(buildHstsOptions({ ...production, NODE_ENV: 'test' })).toBe(false);
  });

  test('uses configured values in production, with preload off by default', () => {
    expect(buildHstsOptions(production)).toEqual({
      maxAge: 31536000,
      includeSubDomains: true,
      preload: false,
    });
  });

  test('honours HSTS_PRELOAD and the other settings when configured', () => {
    expect(buildHstsOptions({ NODE_ENV: 'production', HSTS_MAX_AGE: 300, HSTS_INCLUDE_SUBDOMAINS: false, HSTS_PRELOAD: true })).toEqual({
      maxAge: 300,
      includeSubDomains: false,
      preload: true,
    });
  });

  test('development responses do not include Strict-Transport-Security', async () => {
    // The suite runs with NODE_ENV=test, so the header must be absent.
    const res = await request(buildApp()).get('/api/v1/health');
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });
});
