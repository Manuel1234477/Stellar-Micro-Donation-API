'use strict';

/**
 * Tests: Soroban Contract Invocation
 * Covers: invokeContract, simulateContractInvocation, getContractState, getContractEvents
 *         on MockStellarService; POST /invoke, POST /simulate, GET /state, GET /events routes.
 */

jest.mock('uuid', () => ({ v4: () => 'mock-uuid-' + Math.random().toString(36).slice(2) }), { virtual: true });
jest.mock('@opentelemetry/api', () => ({}), { virtual: true });
jest.mock('nodemailer', () => ({}), { virtual: true });

// Inject role via req.user; auth tested separately
jest.mock('../src/middleware/apiKey', () => (req, _res, next) => next());
jest.mock('../src/middleware/rbac', () => ({
  requireAdmin: () => (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Admin required' } });
    }
    next();
  },
}));

// Mock AuditLogService to avoid DB dependency in route tests
jest.mock('../src/services/AuditLogService', () => ({ log: jest.fn().mockResolvedValue(undefined) }));

let mockServiceInstance;
jest.mock('../src/config/stellar', () => ({
  getStellarService: () => mockServiceInstance,
  useMockStellar: true,
}));

const express = require('express');
const request = require('supertest');
const MockStellarService = require('../src/services/MockStellarService');
const StellarService = require('../src/services/StellarService');
const contractsRouter = require('../src/routes/contracts');

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildApp({ role = 'admin' } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'test-user', role };
    next();
  });
  app.use('/contracts', contractsRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({
      success: false,
      error: { code: err.code || 'ERROR', message: err.message },
    });
  });
  return app;
}

function freshMock() {
  mockServiceInstance = new MockStellarService();
  return mockServiceInstance;
}

// ── MockStellarService.invokeContract ─────────────────────────────────────────

describe('MockStellarService.invokeContract', () => {
  let service;
  beforeEach(() => { service = new MockStellarService(); });

  it('deposit returns status:success and a deposit event', async () => {
    const result = await service.invokeContract('C001', 'deposit', ['donor1', 50]);
    expect(result.status).toBe('success');
    expect(result.events).toHaveLength(1);
    expect(result.events[0].type).toBe('deposit');
    expect(result.transactionHash).toBeTruthy();
  });

  it('release succeeds when balance meets goal', async () => {
    await service.invokeContract('C001', 'deposit', ['donor1', 100]);
    const result = await service.invokeContract('C001', 'release', ['recipient1', 100]);
    expect(result.status).toBe('success');
    expect(result.events[0].type).toBe('release');
  });

  it('release returns error when balance is below goal', async () => {
    await service.invokeContract('C001', 'deposit', ['donor1', 10]);
    const result = await service.invokeContract('C001', 'release', ['recipient1', 100]);
    expect(result.status).toBe('error');
    expect(result.returnValue).toBe('Goal not yet reached');
    expect(result.events).toHaveLength(0);
  });

  it('unknown method returns status:success with no events', async () => {
    const result = await service.invokeContract('C001', 'ping', []);
    expect(result.status).toBe('success');
    expect(result.events).toHaveLength(0);
  });

  it('throws when contractId is missing', async () => {
    await expect(service.invokeContract('', 'deposit', [])).rejects.toThrow('contractId is required');
    await expect(service.invokeContract(null, 'deposit', [])).rejects.toThrow('contractId is required');
  });

  it('throws when method is missing', async () => {
    await expect(service.invokeContract('C001', '', [])).rejects.toThrow('method is required');
    await expect(service.invokeContract('C001', null, [])).rejects.toThrow('method is required');
  });

  it('throws when args is not an array', async () => {
    await expect(service.invokeContract('C001', 'deposit', 'bad')).rejects.toThrow('args must be an array');
    await expect(service.invokeContract('C001', 'deposit', 42)).rejects.toThrow('args must be an array');
  });
});

// ── MockStellarService.simulateContractInvocation ─────────────────────────────

describe('MockStellarService.simulateContractInvocation', () => {
  let service;
  beforeEach(() => { service = new MockStellarService(); });

  it('returns status:success with cost and footprint', async () => {
    const result = await service.simulateContractInvocation('C001', 'deposit', ['donor1', 50]);
    expect(result.status).toBe('success');
    expect(result.cost).toBeDefined();
    expect(result.footprint).toBeDefined();
  });

  it('does not modify contract state', async () => {
    await service.simulateContractInvocation('C001', 'deposit', ['donor1', 50]);
    const state = await service.getContractState('C001');
    expect(state).toEqual([]); // no contract created by simulation
  });

  it('throws when contractId is missing', async () => {
    await expect(service.simulateContractInvocation('', 'deposit', [])).rejects.toThrow('contractId is required');
  });

  it('throws when method is missing', async () => {
    await expect(service.simulateContractInvocation('C001', null, [])).rejects.toThrow('method is required');
  });

  it('throws when args is not an array', async () => {
    await expect(service.simulateContractInvocation('C001', 'deposit', 'bad')).rejects.toThrow('args must be an array');
  });
});

// ── MockStellarService.getContractState ───────────────────────────────────────

describe('MockStellarService.getContractState', () => {
  let service;
  beforeEach(() => { service = new MockStellarService(); });

  it('returns empty array for unknown contract', async () => {
    const state = await service.getContractState('UNKNOWN');
    expect(state).toEqual([]);
  });

  it('returns key/value entries after invocation', async () => {
    await service.invokeContract('C001', 'deposit', ['donor1', 50]);
    const state = await service.getContractState('C001');
    expect(Array.isArray(state)).toBe(true);
    expect(state.length).toBeGreaterThan(0);
    expect(state[0]).toHaveProperty('key');
    expect(state[0]).toHaveProperty('value');
  });

  it('reflects balance in state after deposit', async () => {
    await service.invokeContract('C001', 'deposit', ['donor1', 75]);
    const state = await service.getContractState('C001');
    const balanceEntry = state.find(e => e.key === 'balance');
    expect(balanceEntry).toBeDefined();
    expect(balanceEntry.value).toBe(75);
  });

  it('throws when contractId is missing', async () => {
    await expect(service.getContractState('')).rejects.toThrow('contractId is required');
  });
});

// ── MockStellarService.getContractEvents ──────────────────────────────────────

describe('MockStellarService.getContractEvents', () => {
  let service;
  beforeEach(() => { service = new MockStellarService(); });

  it('returns empty array when no events exist', async () => {
    expect(await service.getContractEvents('C999')).toEqual([]);
  });

  it('returns events after invocations', async () => {
    await service.invokeContract('C001', 'deposit', ['d1', 10]);
    await service.invokeContract('C001', 'deposit', ['d2', 20]);
    const events = await service.getContractEvents('C001');
    expect(events).toHaveLength(2);
  });

  it('respects limit parameter', async () => {
    for (let i = 0; i < 5; i++) await service.invokeContract('C001', 'deposit', [`d${i}`, i + 1]);
    expect(await service.getContractEvents('C001', 2)).toHaveLength(2);
  });

  it('does not return events from a different contractId', async () => {
    await service.invokeContract('C001', 'deposit', ['d1', 10]);
    expect(await service.getContractEvents('C002')).toHaveLength(0);
  });

  it('throws when contractId is missing', async () => {
    await expect(service.getContractEvents('')).rejects.toThrow('contractId is required');
  });
});

// ── StellarService validation ─────────────────────────────────────────────────

describe('StellarService contract method validation', () => {
  let service;
  beforeEach(() => { service = new StellarService(); });

  it('invokeContract throws for missing contractId', async () => {
    await expect(service.invokeContract('', 'deposit', [])).rejects.toThrow('contractId is required');
  });

  it('invokeContract throws for missing method', async () => {
    await expect(service.invokeContract('C001', '', [])).rejects.toThrow('method is required');
  });

  it('invokeContract throws for non-array args', async () => {
    await expect(service.invokeContract('C001', 'deposit', 'bad')).rejects.toThrow('args must be an array');
  });

  it('simulateContractInvocation throws for missing contractId', async () => {
    await expect(service.simulateContractInvocation('', 'deposit', [])).rejects.toThrow('contractId is required');
  });

  it('getContractState throws for missing contractId', async () => {
    await expect(service.getContractState('')).rejects.toThrow('contractId is required');
  });

  it('getContractEvents throws for missing contractId', async () => {
    await expect(service.getContractEvents('')).rejects.toThrow('contractId is required');
  });

  it('getContractEvents returns empty array for unknown contract', async () => {
    expect(await service.getContractEvents('UNKNOWN')).toEqual([]);
  });
});

// ── POST /contracts/:contractId/invoke ────────────────────────────────────────

describe('POST /contracts/:contractId/invoke', () => {
  let app;
  beforeEach(() => { freshMock(); app = buildApp({ role: 'admin' }); });

  it('invokes a contract method and returns result', async () => {
    const res = await request(app)
      .post('/contracts/C001/invoke')
      .send({ method: 'deposit', args: ['donor1', 50] });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('success');
    expect(res.body.data.transactionHash).toBeTruthy();
  });

  it('returns 400 when method is missing', async () => {
    const res = await request(app).post('/contracts/C001/invoke').send({ args: [] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when args is not an array', async () => {
    const res = await request(app).post('/contracts/C001/invoke').send({ method: 'deposit', args: 'bad' });
    expect(res.status).toBe(400);
  });

  it('returns 403 for non-admin', async () => {
    const userApp = buildApp({ role: 'user' });
    const res = await request(userApp).post('/contracts/C001/invoke').send({ method: 'deposit', args: [] });
    expect(res.status).toBe(403);
  });

  it('returns 403 for guest', async () => {
    const guestApp = buildApp({ role: 'guest' });
    const res = await request(guestApp).post('/contracts/C001/invoke').send({ method: 'deposit', args: [] });
    expect(res.status).toBe(403);
  });

  it('returns 500 when service throws', async () => {
    mockServiceInstance.invokeContract = async () => { throw new Error('RPC down'); };
    const res = await request(app).post('/contracts/C001/invoke').send({ method: 'deposit', args: [] });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INVOKE_FAILED');
  });
});

// ── POST /contracts/:contractId/simulate ──────────────────────────────────────

describe('POST /contracts/:contractId/simulate', () => {
  let app;
  beforeEach(() => { freshMock(); app = buildApp({ role: 'admin' }); });

  it('returns simulation result without submitting', async () => {
    const res = await request(app)
      .post('/contracts/C001/simulate')
      .send({ method: 'deposit', args: ['donor1', 50] });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('success');
    expect(res.body.data.cost).toBeDefined();
    expect(res.body.data.footprint).toBeDefined();
  });

  it('does not create contract events (dry-run)', async () => {
    await request(app).post('/contracts/C001/simulate').send({ method: 'deposit', args: ['d1', 50] });
    const eventsRes = await request(app).get('/contracts/C001/events');
    expect(eventsRes.body.count).toBe(0);
  });

  it('returns 400 when method is missing', async () => {
    const res = await request(app).post('/contracts/C001/simulate').send({ args: [] });
    expect(res.status).toBe(400);
  });

  it('returns 403 for non-admin', async () => {
    const userApp = buildApp({ role: 'user' });
    const res = await request(userApp).post('/contracts/C001/simulate').send({ method: 'deposit', args: [] });
    expect(res.status).toBe(403);
  });

  it('returns 500 when service throws', async () => {
    mockServiceInstance.simulateContractInvocation = async () => { throw new Error('sim error'); };
    const res = await request(app).post('/contracts/C001/simulate').send({ method: 'deposit', args: [] });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('SIMULATE_FAILED');
  });
});

// ── GET /contracts/:contractId/state ──────────────────────────────────────────

describe('GET /contracts/:contractId/state', () => {
  let app;
  beforeEach(() => { freshMock(); app = buildApp({ role: 'admin' }); });

  it('returns empty array for unknown contract', async () => {
    const res = await request(app).get('/contracts/UNKNOWN/state');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
    expect(res.body.count).toBe(0);
  });

  it('returns contract state after invocation', async () => {
    await mockServiceInstance.invokeContract('C001', 'deposit', ['donor1', 60]);
    const res = await request(app).get('/contracts/C001/state');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    const balanceEntry = res.body.data.find(e => e.key === 'balance');
    expect(balanceEntry.value).toBe(60);
  });

  it('returns 403 for non-admin', async () => {
    const userApp = buildApp({ role: 'user' });
    const res = await request(userApp).get('/contracts/C001/state');
    expect(res.status).toBe(403);
  });

  it('returns 500 when service throws', async () => {
    mockServiceInstance.getContractState = async () => { throw new Error('state error'); };
    const res = await request(app).get('/contracts/C001/state');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('FETCH_STATE_FAILED');
  });
});

// ── GET /contracts/:id/events ─────────────────────────────────────────────────

describe('GET /contracts/:id/events', () => {
  let app;
  beforeEach(() => { freshMock(); app = buildApp({ role: 'admin' }); });

  it('returns empty array when no events exist', async () => {
    const res = await request(app).get('/contracts/C999/events');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [], count: 0 });
  });

  it('returns events after deposits', async () => {
    await mockServiceInstance.invokeContract('C001', 'deposit', ['d1', 50]);
    await mockServiceInstance.invokeContract('C001', 'deposit', ['d2', 30]);
    const res = await request(app).get('/contracts/C001/events');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
  });

  it('respects limit query param', async () => {
    for (let i = 0; i < 5; i++) await mockServiceInstance.invokeContract('C001', 'deposit', [`d${i}`, 10]);
    const res = await request(app).get('/contracts/C001/events?limit=2');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  it('returns 400 for non-integer limit', async () => {
    const res = await request(app).get('/contracts/C001/events?limit=abc');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REQUEST');
  });

  it('returns 400 for zero limit', async () => {
    expect((await request(app).get('/contracts/C001/events?limit=0')).status).toBe(400);
  });

  it('returns 400 for negative limit', async () => {
    expect((await request(app).get('/contracts/C001/events?limit=-1')).status).toBe(400);
  });

  it('returns 500 when service throws', async () => {
    mockServiceInstance.getContractEvents = async () => { throw new Error('DB exploded'); };
    const res = await request(app).get('/contracts/C001/events');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('FETCH_EVENTS_FAILED');
  });
});
