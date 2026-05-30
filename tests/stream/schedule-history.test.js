/**
 * Tests for issue #771: GET /stream/schedules/:id/history
 */

const request = require('supertest');
const express = require('express');

jest.mock('../../src/middleware/rbac', () => ({
  checkPermission: () => (req, res, next) => next(),
  requireAdmin: () => (req, res, next) => next(),
}));
jest.mock('../../src/middleware/payloadSizeLimiter', () => ({
  payloadSizeLimiter: () => (req, res, next) => next(),
  ENDPOINT_LIMITS: { stream: 1024 },
}));
jest.mock('../../src/middleware/requestTimeout', () => ({
  requestTimeout: () => (req, res, next) => next(),
  TIMEOUTS: { stream: 30000 },
}));
jest.mock('../../src/middleware/schemaValidation', () => ({
  validateSchema: () => (req, res, next) => next(),
}));
jest.mock('../../src/services/SseManager', () => ({
  broadcast: jest.fn(),
  addClient: jest.fn(),
  connectionCount: jest.fn(() => 0),
  MAX_CONNECTIONS_PER_KEY: 5,
  getMissedEvents: jest.fn(() => []),
  matchesFilter: jest.fn(() => true),
  writeSseEvent: jest.fn(),
}));
jest.mock('../../src/events/donationEvents', () => ({
  on: jest.fn(),
  constructor: { EVENTS: {} },
}));

const mockDb = {
  get: jest.fn(),
  query: jest.fn(),
  run: jest.fn(),
};
jest.mock('../../src/utils/database', () => mockDb);

const router = require('../../src/routes/stream');

function buildApp(userOverride = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.id = 'test-req-id';
    req.user = { id: 1, role: 'admin', subject: 'GADMIN', ...userOverride };
    next();
  });
  app.use('/stream', router);
  return app;
}

describe('GET /stream/schedules/:id/history (#771)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 404 when schedule does not exist', async () => {
    mockDb.get.mockResolvedValueOnce(null);
    const res = await request(buildApp()).get('/stream/schedules/99/history');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Schedule not found');
  });

  it('returns paginated execution history for admin', async () => {
    mockDb.get
      .mockResolvedValueOnce({ id: 1, donorPublicKey: 'GDONOR' }) // schedule lookup
      .mockResolvedValueOnce({ total: 2 });                        // count
    mockDb.query.mockResolvedValueOnce([
      { id: 1, executedAt: '2026-04-01T00:00:00Z', status: 'success', transactionHash: 'abc123', errorMessage: null },
      { id: 2, executedAt: '2026-04-02T00:00:00Z', status: 'failure', transactionHash: null, errorMessage: 'timeout' },
    ]);

    const res = await request(buildApp()).get('/stream/schedules/1/history');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta).toMatchObject({ page: 1, limit: 20, total: 2 });
  });

  it('returns 403 when non-owner non-admin requests history', async () => {
    mockDb.get.mockResolvedValueOnce({ id: 1, donorPublicKey: 'GDONOR' });
    const app = buildApp({ role: 'user', subject: 'GSOMEONEELSE' });
    const res = await request(app).get('/stream/schedules/1/history');
    expect(res.status).toBe(403);
  });

  it('allows the schedule owner to access history', async () => {
    mockDb.get
      .mockResolvedValueOnce({ id: 1, donorPublicKey: 'GOWNER' })
      .mockResolvedValueOnce({ total: 0 });
    mockDb.query.mockResolvedValueOnce([]);

    const app = buildApp({ role: 'user', subject: 'GOWNER' });
    const res = await request(app).get('/stream/schedules/1/history');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('respects page and limit query params', async () => {
    mockDb.get
      .mockResolvedValueOnce({ id: 1, donorPublicKey: 'GDONOR' })
      .mockResolvedValueOnce({ total: 50 });
    mockDb.query.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get('/stream/schedules/1/history?page=3&limit=10');
    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ page: 3, limit: 10, total: 50, totalPages: 5 });
  });
});
