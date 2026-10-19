/**
 * Tests for CSV formula-injection protection in the impact CSV export route.
 * Traceability: issue #1113.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../../src/services/ImpactService', () => ({
  getImpactStats: jest.fn(),
}));

const ImpactService = require('../../src/services/ImpactService');

describe('Impact CSV export - formula injection protection (#1113)', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    app = express();
    app.use(express.json());

    // Re-require the router after resetting modules so mocks apply.
    const impactRouter = require('../../src/routes/impact');
    app.use('/api/impact', impactRouter);
  });

  const buildStats = (overrides = {}) => ({
    totalDonations: 10,
    totalAmount: 1000,
    totalDonors: 5,
    totalVolunteers: 3,
    ...overrides,
  });

  it('prefixes cells beginning with "=" to neutralize formulas', async () => {
    ImpactService.getImpactStats.mockResolvedValue(
      buildStats({ topDonor: '=cmd|"/c calc"!A1' })
    );

    const res = await request(app).get('/api/impact/export/csv');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).not.toMatch(/(^|,)=cmd/);
    expect(res.text).toContain("'=cmd");
  });

  it('prefixes cells beginning with "+" to neutralize formulas', async () => {
    ImpactService.getImpactStats.mockResolvedValue(
      buildStats({ topDonor: '+1+1' })
    );

    const res = await request(app).get('/api/impact/export/csv');

    expect(res.status).toBe(200);
    expect(res.text).not.toMatch(/(^|,)\+1\+1/);
    expect(res.text).toContain("'+1+1");
  });

  it('prefixes cells beginning with "-" to neutralize formulas', async () => {
    ImpactService.getImpactStats.mockResolvedValue(
      buildStats({ topDonor: '-2+3' })
    );

    const res = await request(app).get('/api/impact/export/csv');

    expect(res.status).toBe(200);
    expect(res.text).not.toMatch(/(^|,)-2\+3/);
    expect(res.text).toContain("'-2+3");
  });

  it('prefixes cells beginning with "@" to neutralize formulas', async () => {
    ImpactService.getImpactStats.mockResolvedValue(
      buildStats({ topDonor: '@SUM(A1:A2)' })
    );

    const res = await request(app).get('/api/impact/export/csv');

    expect(res.status).toBe(200);
    expect(res.text).not.toMatch(/(^|,)@SUM/);
    expect(res.text).toContain("'@SUM");
  });

  it('leaves benign values untouched', async () => {
    ImpactService.getImpactStats.mockResolvedValue(
      buildStats({ topDonor: 'Jane Doe' })
    );

    const res = await request(app).get('/api/impact/export/csv');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Jane Doe');
    expect(res.text).not.toContain("'Jane Doe");
  });

  it('returns 500 when the impact service fails', async () => {
    ImpactService.getImpactStats.mockRejectedValue(new Error('boom'));

    const res = await request(app).get('/api/impact/export/csv');

    expect(res.status).toBe(500);
  });
});