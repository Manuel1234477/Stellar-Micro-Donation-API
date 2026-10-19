'use strict';

/**
 * Tests for admin audit-log pagination.
 *
 * Extracted from the legacy issue-numbered bundle `tests/issues-796-797-798.test.js`
 * (issue #796). The issue number is kept in the describe title for traceability.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../../../src/middleware/auth', () => ({
  requireAdmin: (req, res, next) => {
    req.user = { id: 1, role: 'admin' };
    next();
  },
  requireAuth: (req, res, next) => {
    req.user = { id: 1, role: 'admin' };
    next();
  },
}));

const mockQuery = jest.fn();

jest.mock('../../../src/config/database', () => ({
  query: (...args) => mockQuery(...args),
}));

const auditLogsRouter = require('../../../src/routes/admin/audit-logs');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/admin/audit-logs', auditLogsRouter);
  return app;
}

describe('Admin audit logs pagination (#796)', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  it('returns the first page with default pagination', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '3' }] })
      .mockResolvedValueOnce({
        rows: [
          { id: 3, action: 'update', created_at: '2024-01-03T00:00:00Z' },
          { id: 2, action: 'create', created_at: '2024-01-02T00:00:00Z' },
        ],
      });

    const res = await request(app).get('/admin/audit-logs');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination).toMatchObject({
      page: 1,
      limit: expect.any(Number),
      total: 3,
    });
  });

  it('honours explicit page and limit query parameters', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '25' }] })
      .mockResolvedValueOnce({
        rows: [{ id: 10, action: 'delete', created_at: '2024-01-10T00:00:00Z' }],
      });

    const res = await request(app).get('/admin/audit-logs?page=3&limit=10');

    expect(res.status).toBe(200);
    expect(res.body.pagination).toMatchObject({
      page: 3,
      limit: 10,
      total: 25,
    });

    const dataQueryCall = mockQuery.mock.calls[1];
    expect(dataQueryCall[1]).toEqual(expect.arrayContaining([10, 20]));
  });

  it('clamps an oversized limit to the maximum allowed', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/admin/audit-logs?limit=100000');

    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBeLessThanOrEqual(100);
  });

  it('returns an empty page when there are no audit logs', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/admin/audit-logs');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination).toMatchObject({ page: 1, total: 0 });
  });

  it('rejects a non-numeric page parameter', async () => {
    const res = await request(app).get('/admin/audit-logs?page=abc');

    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects a negative limit parameter', async () => {
    const res = await request(app).get('/admin/audit-logs?limit=-5');

    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns 500 when the database query fails', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));

    const res = await request(app).get('/admin/audit-logs');

    expect(res.status).toBe(500);
  });
});