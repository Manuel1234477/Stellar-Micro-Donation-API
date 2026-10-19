'use strict';

/**
 * Tests for request signing middleware.
 *
 * Extracted from the legacy issue bundle `tests/issues-65-66-67-68.test.js`.
 * Issue reference: #66.
 */

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Minimal in-memory harness mirroring the request-signing middleware contract.
// The middleware verifies an HMAC signature over the raw request body using a
// shared secret, and rejects requests whose signature is missing or invalid.
// ---------------------------------------------------------------------------

function computeSignature(secret, body) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function createRequestSigningMiddleware(options = {}) {
  const { secret, header = 'x-signature', algorithm = 'sha256' } = options;

  if (!secret) {
    throw new Error('request-signing middleware requires a secret');
  }

  return function requestSigning(req, res, next) {
    const provided = req.headers[header.toLowerCase()];

    if (!provided) {
      res.statusCode = 401;
      return res.json({ error: 'Missing signature' });
    }

    const rawBody = typeof req.rawBody === 'string'
      ? req.rawBody
      : JSON.stringify(req.body || {});

    const expected = crypto
      .createHmac(algorithm, secret)
      .update(rawBody)
      .digest('hex');

    const providedBuffer = Buffer.from(String(provided));
    const expectedBuffer = Buffer.from(expected);

    const valid =
      providedBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(providedBuffer, expectedBuffer);

    if (!valid) {
      res.statusCode = 401;
      return res.json({ error: 'Invalid signature' });
    }

    return next();
  };
}

function createMockResponse() {
  return {
    statusCode: 200,
    body: undefined,
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe('request signing middleware (#66)', () => {
  const secret = 'test-secret-key';

  it('throws when constructed without a secret', () => {
    expect(() => createRequestSigningMiddleware({})).toThrow(/secret/);
  });

  it('calls next when the signature is valid', () => {
    const middleware = createRequestSigningMiddleware({ secret });
    const body = { amount: 10, destination: 'GABC' };
    const rawBody = JSON.stringify(body);
    const req = {
      headers: { 'x-signature': computeSignature(secret, rawBody) },
      body,
      rawBody,
    };
    const res = createMockResponse();
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBeUndefined();
  });

  it('rejects requests with a missing signature', () => {
    const middleware = createRequestSigningMiddleware({ secret });
    const req = { headers: {}, body: { amount: 1 }, rawBody: '{"amount":1}' };
    const res = createMockResponse();
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Missing signature' });
  });

  it('rejects requests with an invalid signature', () => {
    const middleware = createRequestSigningMiddleware({ secret });
    const req = {
      headers: { 'x-signature': 'deadbeef' },
      body: { amount: 1 },
      rawBody: '{"amount":1}',
    };
    const res = createMockResponse();
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid signature' });
  });

  it('rejects a signature computed with the wrong secret', () => {
    const middleware = createRequestSigningMiddleware({ secret });
    const rawBody = '{"amount":5}';
    const req = {
      headers: { 'x-signature': computeSignature('wrong-secret', rawBody) },
      body: { amount: 5 },
      rawBody,
    };
    const res = createMockResponse();
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid signature' });
  });

  it('rejects a signature when the body has been tampered with', () => {
    const middleware = createRequestSigningMiddleware({ secret });
    const originalBody = '{"amount":5}';
    const tamperedBody = '{"amount":500}';
    const req = {
      headers: { 'x-signature': computeSignature(secret, originalBody) },
      body: { amount: 500 },
      rawBody: tamperedBody,
    };
    const res = createMockResponse();
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid signature' });
  });

  it('supports a custom signature header name', () => {
    const middleware = createRequestSigningMiddleware({
      secret,
      header: 'x-custom-signature',
    });
    const rawBody = '{"amount":2}';
    const req = {
      headers: { 'x-custom-signature': computeSignature(secret, rawBody) },
      body: { amount: 2 },
      rawBody,
    };
    const res = createMockResponse();
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });

  it('falls back to serialising the parsed body when rawBody is absent', () => {
    const middleware = createRequestSigningMiddleware({ secret });
    const body = { amount: 3 };
    const req = {
      headers: { 'x-signature': computeSignature(secret, JSON.stringify(body)) },
      body,
    };
    const res = createMockResponse();
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });
});