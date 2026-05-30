'use strict';

const mockDbGet = jest.fn();
const mockDbRun = jest.fn();

jest.mock('./src/utils/database', () => ({
  get: (...args) => mockDbGet(...args),
  run: (...args) => mockDbRun(...args),
  all: jest.fn().mockResolvedValue([]),
  query: jest.fn().mockResolvedValue([]),
}));

jest.mock('./src/services/AuditLogService', () => ({
  log: jest.fn().mockResolvedValue(undefined),
  CATEGORY: { FINANCIAL_OPERATION: 'FINANCIAL_OPERATION' },
  ACTION: {},
  SEVERITY: { MEDIUM: 'MEDIUM' },
}));

jest.mock('./src/middleware/rbac', () => ({
  checkPermission: () => (req, res, next) => next(),
  requireAdmin: () => (req, res, next) => next(),
  attachUserRole: (req, res, next) => next(),
}));
jest.mock('./src/middleware/apiKey', () => (req, res, next) => { req.apiKey = { id: 1, role: 'user' }; next(); });
jest.mock('./src/middleware/payloadSizeLimiter', () => ({ payloadSizeLimiter: () => (req, res, next) => next(), ENDPOINT_LIMITS: { stream: 1024 } }));
jest.mock('./src/middleware/requestTimeout', () => ({ requestTimeout: () => (req, res, next) => next(), TIMEOUTS: { stream: 5000 } }));
jest.mock('./src/middleware/schemaValidation', () => ({ validateSchema: () => (req, res, next) => next() }));
jest.mock('./src/services/SseManager', () => ({ addClient: jest.fn(), removeClient: jest.fn(), broadcast: jest.fn(), connectionCount: () => 0, MAX_CONNECTIONS_PER_KEY: 10, getMissedEvents: () => [], matchesFilter: () => true, writeSseEvent: jest.fn(), getStats: () => ({}), HEARTBEAT_INTERVAL_MS: 30000 }));
jest.mock('./src/events/donationEvents', () => ({ on: jest.fn() }));

const express = require('express');
const request = require('supertest');
const streamRouter = require('./src/routes/stream');

const app = express();
app.use(express.json());
app.use((req, res, next) => { req.id = 'test-req'; req.ip = '127.0.0.1'; next(); });
app.use('/stream', streamRouter);
app.use((err, req, res, next) => { console.error('ERROR:', err.message, err.stack); res.status(500).json({ error: err.message }); });

test('debug patch', async () => {
  mockDbGet.mockResolvedValue({ id: 1, status: 'active', amount: 10, frequency: 'monthly', nextExecutionDate: new Date().toISOString() });
  mockDbRun.mockResolvedValue({ changes: 1 });
  
  const res = await request(app).patch('/stream/schedules/1').send({ amount: 25 });
  console.log('Status:', res.status, 'Body:', JSON.stringify(res.body));
  expect(res.status).toBe(200);
});
