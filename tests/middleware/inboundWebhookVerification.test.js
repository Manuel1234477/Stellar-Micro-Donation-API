/**
 * Tests for the generic inbound webhook signature verification middleware (Issue #1524).
 */

const crypto = require('crypto');
const {
  registerWebhookSource,
  verifyInboundWebhook,
  _clearWebhookSources,
} = require('../../src/middleware/inboundWebhookVerification');

function sign(secret, body, prefix = '') {
  return prefix + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function mockRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe('inboundWebhookVerification', () => {
  beforeEach(() => {
    _clearWebhookSources();
    registerWebhookSource('stripe', {
      secret: 'stripe-secret',
      headerName: 'stripe-signature',
    });
    registerWebhookSource('github-style', {
      secret: 'gh-secret',
      headerName: 'x-hub-signature-256',
      signaturePrefix: 'sha256=',
    });
  });

  test('calls next() for a valid signature', () => {
    const rawBody = Buffer.from(JSON.stringify({ hello: 'world' }));
    const sig = sign('stripe-secret', rawBody);
    const req = { headers: { 'stripe-signature': sig }, rawBody, path: '/webhooks/inbound/stripe' };
    const res = mockRes();
    const next = jest.fn();

    verifyInboundWebhook('stripe')(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.webhookSource).toBe('stripe');
    expect(res.statusCode).toBeNull();
  });

  test('supports a signature prefix (e.g. GitHub-style sha256=)', () => {
    const rawBody = Buffer.from(JSON.stringify({ event: 'ping' }));
    const sig = sign('gh-secret', rawBody, 'sha256=');
    const req = { headers: { 'x-hub-signature-256': sig }, rawBody, path: '/webhooks/inbound/github' };
    const res = mockRes();
    const next = jest.fn();

    verifyInboundWebhook('github-style')(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  test('rejects with 401 when the signature header is missing', () => {
    const req = { headers: {}, rawBody: Buffer.from('{}'), path: '/webhooks/inbound/stripe' };
    const res = mockRes();
    const next = jest.fn();

    verifyInboundWebhook('stripe')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe('MISSING_WEBHOOK_SIGNATURE');
  });

  test('rejects with 401 when the signature is invalid', () => {
    const rawBody = Buffer.from(JSON.stringify({ hello: 'world' }));
    const req = {
      headers: { 'stripe-signature': 'deadbeef'.repeat(8) },
      rawBody,
      path: '/webhooks/inbound/stripe',
    };
    const res = mockRes();
    const next = jest.fn();

    verifyInboundWebhook('stripe')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe('INVALID_WEBHOOK_SIGNATURE');
  });

  test('rejects with 401 when the body has been tampered with', () => {
    const original = Buffer.from(JSON.stringify({ amount: 10 }));
    const sig = sign('stripe-secret', original);
    const tampered = Buffer.from(JSON.stringify({ amount: 10000 }));
    const req = { headers: { 'stripe-signature': sig }, rawBody: tampered, path: '/webhooks/inbound/stripe' };
    const res = mockRes();
    const next = jest.fn();

    verifyInboundWebhook('stripe')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  test('returns 500 for an unregistered source', () => {
    const req = { headers: {}, rawBody: Buffer.from('{}'), path: '/webhooks/inbound/unknown' };
    const res = mockRes();
    const next = jest.fn();

    verifyInboundWebhook('unknown-source')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(500);
  });
});
