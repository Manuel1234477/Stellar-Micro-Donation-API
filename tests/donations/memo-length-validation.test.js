/**
 * Tests for issue #768: memo text must be validated to ≤28 bytes before Stellar submission
 */

const request = require('supertest');
const express = require('express');

jest.mock('../../src/middleware/rbac', () => ({
  checkPermission: () => (req, res, next) => next(),
  requireAdmin: () => (req, res, next) => next(),
}));
jest.mock('../../src/middleware/apiKey', () => (req, res, next) => next());
jest.mock('../../src/middleware/idempotency', () => ({
  requireIdempotency: (req, res, next) => next(),
  storeIdempotencyResponse: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/middleware/rateLimiter', () => ({
  donationRateLimiter: (req, res, next) => next(),
  verificationRateLimiter: (req, res, next) => next(),
  batchRateLimiter: (req, res, next) => next(),
}));
jest.mock('../../src/middleware/payloadSizeLimiter', () => ({
  payloadSizeLimiter: () => (req, res, next) => next(),
  ENDPOINT_LIMITS: { singleDonation: 1024 },
}));
jest.mock('../../src/config/stellar', () => ({
  getStellarService: jest.fn(() => ({})),
}));
jest.mock('../../src/services/DonationService', () => {
  return jest.fn().mockImplementation(() => ({
    sendCustodialDonation: jest.fn().mockResolvedValue({ id: 1, amount: 10 }),
    getPaginatedDonations: jest.fn().mockReturnValue({ data: [], totalCount: 0, meta: {} }),
    getDonationById: jest.fn(),
  }));
});
jest.mock('../../src/utils/database', () => ({
  get: jest.fn(),
  query: jest.fn(() => []),
  run: jest.fn(),
}));
jest.mock('../../src/services/AuditLogService', () => ({
  log: jest.fn().mockResolvedValue(undefined),
  CATEGORY: {}, ACTION: {}, SEVERITY: {},
}));
jest.mock('../../src/services/LimitService', () => ({}));

const router = require('../../src/routes/donation');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.id = 'test-req-id'; req.user = { id: 1, role: 'admin' }; next(); });
  app.use('/donations', router);
  return app;
}

describe('POST /donations - memo length validation (#768)', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  it('accepts a memo within 28 bytes (ASCII)', async () => {
    const res = await request(app)
      .post('/donations')
      .send({ senderId: '1', receiverId: '2', amount: 10, memo: 'hello' });
    expect(res.status).toBe(201);
  });

  it('accepts a memo of exactly 28 ASCII characters', async () => {
    const res = await request(app)
      .post('/donations')
      .send({ senderId: '1', receiverId: '2', amount: 10, memo: 'a'.repeat(28) });
    expect(res.status).toBe(201);
  });

  it('rejects a memo exceeding 28 bytes (ASCII)', async () => {
    const res = await request(app)
      .post('/donations')
      .send({ senderId: '1', receiverId: '2', amount: 10, memo: 'a'.repeat(29) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Memo text must be 28 bytes or less');
  });

  it('rejects a memo exceeding 28 bytes with multibyte UTF-8 characters', async () => {
    // Each '€' is 3 bytes in UTF-8 — 10 of them = 30 bytes
    const res = await request(app)
      .post('/donations')
      .send({ senderId: '1', receiverId: '2', amount: 10, memo: '€'.repeat(10) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Memo text must be 28 bytes or less');
  });

  it('accepts a multibyte memo within 28 bytes', async () => {
    // 9 × '€' = 27 bytes — valid
    const res = await request(app)
      .post('/donations')
      .send({ senderId: '1', receiverId: '2', amount: 10, memo: '€'.repeat(9) });
    expect(res.status).toBe(201);
  });

  it('accepts a donation with no memo', async () => {
    const res = await request(app)
      .post('/donations')
      .send({ senderId: '1', receiverId: '2', amount: 10 });
    expect(res.status).toBe(201);
  });
});
