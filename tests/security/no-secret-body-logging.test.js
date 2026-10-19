/**
 * Tests for secret-key request bodies (Issue #1884)
 *
 * Secret-bearing fields (*Secret) must never be written to logs, traces or
 * the body-hash dedup cache, and must be rejected in production.
 */

const request = require('supertest');
const express = require('express');

const SECRET = 'SBZ3XQ4YQ7VZ5QKJ2X6L5A3P5C7XQKZ3QJ7W3X5Q4YQ7VZ5QKJ2X6L5A';

const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('../../src/utils/log', () => ({ log: mockLog, info: mockLog.info, warn: mockLog.warn, error: mockLog.error, debug: mockLog.debug }));

const { SECRET_FIELD_NAMES, rejectSecretBodies, assertNoSecretsInLogs } = require('../../src/middleware/secretBodyGuard');

describe('Secret key request bodies (#1884)', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    jest.clearAllMocks();
  });

  test('recognises sourceSecret and senderSecret style fields', () => {
    expect(SECRET_FIELD_NAMES).toEqual(expect.arrayContaining(['sourceSecret', 'senderSecret']));
  });

  test('a request body containing a secret never reaches the logger', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      mockLog.info('REQUEST', 'incoming', { body: req.body });
      next();
    });
    app.post('/channels/open', (req, res) => res.json({ success: true }));

    await request(app).post('/channels/open').send({ sourceSecret: SECRET, amount: 5 });

    const serialised = JSON.stringify(mockLog.info.mock.calls);
    expect(serialised).not.toContain(SECRET);
  });

  test('rejects secret-bearing bodies with 400 when NODE_ENV=production', async () => {
    process.env.NODE_ENV = 'production';
    const app = express();
    app.use(express.json());
    app.use(rejectSecretBodies);
    app.post('/claimable-balances', (req, res) => res.json({ success: true }));

    const res = await request(app).post('/claimable-balances').send({ sourceSecret: SECRET });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SECRET_IN_REQUEST_BODY');
  });

  test('deprecation header is set outside production', async () => {
    process.env.NODE_ENV = 'development';
    const app = express();
    app.use(express.json());
    app.use(rejectSecretBodies);
    app.post('/wallets/:id/merge', (req, res) => res.json({ success: true }));

    const res = await request(app).post('/wallets/w1/merge').send({ sourceSecret: SECRET });

    expect(res.status).toBe(200);
    expect(res.headers.deprecation).toBeDefined();
    expect(res.headers.sunset).toBeDefined();
  });

  test('assertNoSecretsInLogs redacts secret values in arbitrary objects', () => {
    const redacted = assertNoSecretsInLogs({ rawBody: `{"sourceSecret":"${SECRET}"}` });

    expect(JSON.stringify(redacted)).not.toContain(SECRET);
  });
});
