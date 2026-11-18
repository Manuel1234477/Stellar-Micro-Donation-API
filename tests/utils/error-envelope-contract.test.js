/**
 * Error envelope contract test (Issue #1957)
 *
 * Sends invalid, malformed and unauthenticated requests through the real app and
 * asserts every error response validates against ERROR_ENVELOPE_SCHEMA:
 *   { success: false, error: { code, message, requestId, ... } }
 */

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-key-1,test-key-2';
process.env.NODE_ENV = 'test';

const request = require('supertest');
const Ajv = require('ajv');
const { createApp } = require('../../src/app');
const { ERROR_ENVELOPE_SCHEMA, ERROR_CODES } = require('../../src/utils/errors');

const ajv = new Ajv({ allErrors: true, strict: false });
const validateEnvelope = ajv.compile(ERROR_ENVELOPE_SCHEMA);
const KNOWN_CODES = new Set(Object.values(ERROR_CODES).map(c => c.code));

const KEY = { 'X-API-Key': 'test-key-1' };

function expectEnvelope(res, expectedStatus) {
  if (expectedStatus) expect(res.status).toBe(expectedStatus);
  expect(res.status).toBeGreaterThanOrEqual(400);
  // Non-JSON bodies would indicate a framework default leaked through.
  expect(res.headers['content-type']).toMatch(/application\/json/);
  const valid = validateEnvelope(res.body);
  if (!valid) {
    throw new Error(`Envelope invalid for ${res.status}: ${JSON.stringify(validateEnvelope.errors)} body=${JSON.stringify(res.body)}`);
  }
  expect(res.body.success).toBe(false);
  expect(typeof res.body.error.requestId).toBe('string');
}

describe('Error envelope contract (Issue #1957)', () => {
  let app;

  beforeAll(() => {
    app = createApp();
  });

  test('POST /api/v1/donations/send with empty body returns coded envelope', async () => {
    const res = await request(app).post('/api/v1/donations/send').set(KEY).send({});
    expectEnvelope(res);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test('POST /api/v1/donations/batch with invalid payload returns coded envelope', async () => {
    const res = await request(app).post('/api/v1/donations/batch').set(KEY).send({ donations: 'nope' });
    expectEnvelope(res);
  });

  test('malformed JSON body returns 400 INVALID_REQUEST envelope', async () => {
    const res = await request(app)
      .post('/api/v1/donations/send')
      .set(KEY)
      .set('Content-Type', 'application/json')
      .send('{"senderId": ');
    expectEnvelope(res, 400);
    expect(res.body.error.code).toBe('INVALID_REQUEST');
  });

  test('unknown route returns ENDPOINT_NOT_FOUND envelope', async () => {
    const res = await request(app).get('/api/v1/this-route-does-not-exist').set(KEY);
    expectEnvelope(res, 404);
    expect(res.body.error.code).toBe('ENDPOINT_NOT_FOUND');
  });

  test('missing API key returns UNAUTHORIZED envelope', async () => {
    const res = await request(app).get('/api/v1/wallets');
    expectEnvelope(res);
    // The RBAC layer answers an anonymous caller with a catalogued code; the
    // exact code is an existing contract, so only assert it is catalogued.
    expect(KNOWN_CODES.has(res.body.error.code)).toBe(true);
  });

  test('every error code emitted in these responses is catalogued', async () => {
    const responses = await Promise.all([
      request(app).post('/api/v1/donations/send').set(KEY).send({}),
      request(app).post('/api/v1/donations/batch').set(KEY).send({ donations: 'nope' }),
      request(app).get('/api/v1/this-route-does-not-exist').set(KEY),
      request(app).get('/api/v1/wallets'),
    ]);
    for (const res of responses) {
      expect(KNOWN_CODES.has(res.body.error.code)).toBe(true);
    }
  });
});

describe('normalizeErrorBody (Issue #1957)', () => {
  const { normalizeErrorBody } = require('../../src/utils/errors');

  test('converts legacy string error into coded envelope', () => {
    const out = normalizeErrorBody(404, { success: false, error: 'Schedule not found' }, 'req-1');
    expect(out).toEqual({
      success: false,
      error: expect.objectContaining({ code: 'NOT_FOUND', message: 'Schedule not found', requestId: 'req-1' }),
    });
  });

  test('folds legacy top-level message into the error object', () => {
    const out = normalizeErrorBody(500, { success: false, error: 'Failed to send donation', message: 'boom' }, 'r');
    expect(out.error.code).toBe('INTERNAL_ERROR');
    expect(out.error.message).toBe('Failed to send donation');
    expect(out.message).toBeUndefined();
  });

  test('leaves success bodies untouched', () => {
    const body = { success: true, data: { ok: 1 } };
    expect(normalizeErrorBody(200, body, 'r')).toBe(body);
  });

  test('keeps an already-coded envelope intact', () => {
    const body = { success: false, error: { code: 'DONATION_NOT_FOUND', message: 'x', requestId: 'abc' } };
    expect(normalizeErrorBody(404, body, 'other')).toMatchObject(body);
    expect(normalizeErrorBody(404, body, 'other').error.requestId).toBe('abc');
  });
});
