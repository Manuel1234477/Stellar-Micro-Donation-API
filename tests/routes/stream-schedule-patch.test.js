'use strict';
/**
 * Tests: Issue #39 — PATCH /stream/schedules/:id
 * Closes #921
 */

const express = require('express');
const request = require('supertest');

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockDbGet = jest.fn();
const mockDbRun = jest.fn();
const mockDbAll = jest.fn().mockResolvedValue([]);
const mockDbQuery = jest.fn().mockResolvedValue([]);

jest.mock('../../src/utils/database', () => ({
  get: (...args) => mockDbGet(...args),
  run: (...args) => mockDbRun(...args),
  all: (...args) => mockDbAll(...args),
  query: (...args) => mockDbQuery(...args),
}));

const mockAuditLog = jest.fn().mockResolvedValue(undefined);

jest.mock('../../src/services/AuditLogService', () => ({
  log: (...args) => mockAuditLog(...args),
  CATEGORY: { FINANCIAL_OPERATION: 'FINANCIAL_OPERATION' },
  ACTION: {},
  SEVERITY: { MEDIUM: 'MEDIUM' },
}));

jest.mock('../../src/middleware/rbac', () => ({
  checkPermission: () => (req, res, next) => next(),
  requireAdmin: () => (req, res, next) => next(),
  attachUserRole: (req, res, next) => next(),
}));
jest.mock('../../src/middleware/apiKey', () => (req, res, next) => {
  req.apiKey = { id: 1, role: 'user' };
  next();
});
jest.mock('../../src/middleware/payloadSizeLimiter', () => ({
  payloadSizeLimiter: () => (req, res, next) => next(),
  ENDPOINT_LIMITS: { stream: 1024 },
}));
jest.mock('../../src/middleware/requestTimeout', () => ({
  requestTimeout: () => (req, res, next) => next(),
  TIMEOUTS: { stream: 5000 },
}));
jest.mock('../../src/middleware/schemaValidation', () => ({
  validateSchema: () => (req, res, next) => next(),
}));
jest.mock('../../src/services/SseManager', () => ({
  addClient: jest.fn(),
  removeClient: jest.fn(),
  broadcast: jest.fn(),
  connectionCount: () => 0,
  MAX_CONNECTIONS_PER_KEY: 10,
  getMissedEvents: () => [],
  matchesFilter: () => true,
  writeSseEvent: jest.fn(),
  getStats: () => ({}),
  HEARTBEAT_INTERVAL_MS: 30000,
}));
jest.mock('../../src/events/donationEvents', () => ({ on: jest.fn() }));

const streamRouter = require('../../src/routes/stream');

const app = express();
app.use(express.json());
app.use((req, res, next) => { req.id = 'test-req'; req.ip = '127.0.0.1'; next(); });
app.use('/stream', streamRouter);

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _schedules;

function seedSchedule(id, overrides = {}) {
  _schedules.set(id, {
    id,
    status: 'active',
    amount: 10,
    frequency: 'monthly',
    nextExecutionDate: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    ...overrides,
  });
}

beforeEach(() => {
  _schedules = new Map();
  mockDbGet.mockReset();
  mockDbRun.mockReset();
  mockAuditLog.mockReset().mockResolvedValue(undefined);

  mockDbGet.mockImplementation(async (sql, params = []) => {
    const id = parseInt(params[0], 10);
    return _schedules.get(id) || null;
  });

  mockDbRun.mockImplementation(async (sql, params = []) => {
    const id = parseInt(params[params.length - 1], 10);
    const row = _schedules.get(id);
    if (!row) return { changes: 0 };
    if (sql.includes('nextExecutionDate')) {
      row.amount = params[0];
      row.frequency = params[1];
      row.nextExecutionDate = params[2];
    } else if (sql.trim().toUpperCase().startsWith('UPDATE')) {
      row.amount = params[0];
      row.frequency = params[1];
    }
    return { changes: 1 };
  });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PATCH /stream/schedules/:id — amount-only update', () => {
  it('updates amount and returns 200', async () => {
    seedSchedule(1);
    const res = await request(app).patch('/stream/schedules/1').send({ amount: 25 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(_schedules.get(1).amount).toBe(25);
  });

  it('keeps frequency unchanged', async () => {
    seedSchedule(1);
    await request(app).patch('/stream/schedules/1').send({ amount: 25 });
    expect(_schedules.get(1).frequency).toBe('monthly');
  });
});

describe('PATCH /stream/schedules/:id — frequency-only update', () => {
  it('updates frequency and recalculates nextExecutionDate', async () => {
    seedSchedule(1, { frequency: 'monthly' });
    const before = new Date();
    const res = await request(app).patch('/stream/schedules/1').send({ frequency: 'weekly' });
    expect(res.status).toBe(200);
    expect(_schedules.get(1).frequency).toBe('weekly');
    const next = new Date(_schedules.get(1).nextExecutionDate);
    const diffDays = (next - before) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThanOrEqual(6.9);
    expect(diffDays).toBeLessThanOrEqual(7.1);
  });
});

describe('PATCH /stream/schedules/:id — combined update', () => {
  it('updates both amount and frequency', async () => {
    seedSchedule(1, { frequency: 'monthly' });
    const res = await request(app).patch('/stream/schedules/1').send({ amount: 50, frequency: 'daily' });
    expect(res.status).toBe(200);
    expect(_schedules.get(1).amount).toBe(50);
    expect(_schedules.get(1).frequency).toBe('daily');
  });
});

describe('PATCH /stream/schedules/:id — cancelled schedule rejected', () => {
  it('returns 409 for cancelled schedule', async () => {
    seedSchedule(1, { status: 'cancelled' });
    const res = await request(app).patch('/stream/schedules/1').send({ amount: 20 });
    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });
});

describe('PATCH /stream/schedules/:id — audit log', () => {
  it('creates an audit log entry with SCHEDULE_UPDATED action', async () => {
    seedSchedule(1);
    await request(app).patch('/stream/schedules/1').send({ amount: 30 });
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SCHEDULE_UPDATED',
        details: expect.objectContaining({
          oldValues: { amount: 10, frequency: 'monthly' },
          newValues: expect.objectContaining({ amount: 30 }),
        }),
      })
    );
  });
});

describe('PATCH /stream/schedules/:id — validation', () => {
  it('returns 400 when no fields provided', async () => {
    seedSchedule(1);
    const res = await request(app).patch('/stream/schedules/1').send({});
    expect(res.status).toBe(400);
  });

  it('returns 404 for non-existent schedule', async () => {
    const res = await request(app).patch('/stream/schedules/999').send({ amount: 10 });
    expect(res.status).toBe(404);
  });
});
