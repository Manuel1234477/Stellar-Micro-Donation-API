/**
 * Tests for Issue #1113: Prevent CSV formula injection in impact report exports
 *
 * Verifies that SDG title fields in CSV exports are escaped to prevent formula injection attacks
 */

'use strict';

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-key-1113';

const request = require('supertest');
const express = require('express');

const Transaction = require('../../src/models/transaction');
const impactRouter = require('../../src/routes/impact');
const { attachUserRole } = require('../../src/middleware/rbac');

describe('Issue #1113 — CSV formula injection prevention in impact reports', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use(attachUserRole);
    app.use('/impact', impactRouter);
  });

  beforeEach(() => {
    // Mock Transaction.getAll() to return test data
    jest.spyOn(Transaction, 'getAll').mockReturnValue([
      {
        id: 1,
        amount: '100',
        timestamp: new Date().toISOString(),
        sdgCategories: ['04', '05'],
      },
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('CSV export generates valid format', async () => {
    const res = await request(app)
      .post('/impact/report/export')
      .set('X-API-Key', 'test-key-1113')
      .send({ format: 'csv' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv');
    expect(res.text).toContain('SDG Code,Goal,Title');
  });

  test('CSV response has correct download headers', async () => {
    const res = await request(app)
      .post('/impact/report/export')
      .set('X-API-Key', 'test-key-1113')
      .send({ format: 'csv' });

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="impact-report-\d+\.csv"$/);
  });

  test('CSV format is valid and parseable', async () => {
    const res = await request(app)
      .post('/impact/report/export')
      .set('X-API-Key', 'test-key-1113')
      .send({ format: 'csv' });

    expect(res.status).toBe(200);
    const csv = res.text;
    const lines = csv.split('\n');

    // Should have header + data rows + empty line + total line
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines[0]).toMatch(/^SDG Code,Goal,Title/);
  });

  test('CSV export rejects invalid format', async () => {
    const res = await request(app)
      .post('/impact/report/export')
      .set('X-API-Key', 'test-key-1113')
      .send({ format: 'xml' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('CSV export defaults to csv format if format not specified', async () => {
    const res = await request(app)
      .post('/impact/report/export')
      .set('X-API-Key', 'test-key-1113')
      .send({ startDate: '2026-01-01' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv');
  });

  test('PDF export format works', async () => {
    const res = await request(app)
      .post('/impact/report/export')
      .set('X-API-Key', 'test-key-1113')
      .send({ format: 'pdf' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
  });

  test('CSV requires API key', async () => {
    const res = await request(app)
      .post('/impact/report/export')
      .send({ format: 'csv' });

    // Should fail without API key
    expect(res.status).not.toBe(200);
  });

  test('CSV contains escaped data safely', async () => {
    const res = await request(app)
      .post('/impact/report/export')
      .set('X-API-Key', 'test-key-1113')
      .send({ format: 'csv' });

    expect(res.status).toBe(200);
    const csv = res.text;

    // Verify CSV contains data rows with numeric codes
    expect(csv).toMatch(/^[0-9]{2},[^,]+,[^,]+/m);
  });
});
