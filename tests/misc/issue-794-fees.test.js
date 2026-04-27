'use strict';

/**
 * Tests for #794 — GET /fees includes Stellar base fee from NetworkStatusService cache.
 */

const request = require('supertest');

// Minimal serviceContainer stub
jest.mock('../../src/config/serviceContainer', () => ({
  getNetworkStatusService: () => ({
    getStatus: () => ({
      connected: true,
      feeStroops: 200,
      timestamp: '2026-04-20T11:55:00Z',
      feeSurgeMultiplier: 2,
    }),
  }),
}));

const feesRouter = require('../../src/routes/fees');
const express = require('express');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/fees', feesRouter);
  return app;
}

describe('GET /fees (#794)', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  it('returns 200 without authentication', async () => {
    const res = await request(app).get('/fees');
    expect(res.status).toBe(200);
  });

  it('includes stellar.baseFeeStroops and stellar.baseFeeXLM', async () => {
    const res = await request(app).get('/fees');
    expect(res.body.stellar.baseFeeStroops).toBe(200);
    expect(res.body.stellar.baseFeeXLM).toBeCloseTo(200 / 10_000_000, 7);
  });

  it('stellar.lastUpdatedAt reflects cache timestamp', async () => {
    const res = await request(app).get('/fees');
    expect(res.body.stellar.lastUpdatedAt).toBe('2026-04-20T11:55:00Z');
  });

  it('stellar.networkCongestion is medium for feeSurgeMultiplier=2', async () => {
    const res = await request(app).get('/fees');
    expect(res.body.stellar.networkCongestion).toBe('medium');
  });

  it('stellar.feeSource is network_status_cache when connected', async () => {
    const res = await request(app).get('/fees');
    expect(res.body.stellar.feeSource).toBe('network_status_cache');
  });

  it('total.minimumTotalFeeXLM = minimumFeeXLM + baseFeeXLM', async () => {
    const res = await request(app).get('/fees');
    const { minimumFeeXLM } = res.body.application;
    const { baseFeeXLM } = res.body.stellar;
    expect(res.body.total.minimumTotalFeeXLM).toBeCloseTo(minimumFeeXLM + baseFeeXLM, 7);
  });

  it('feeCalculationExample shows correct breakdown for 100 XLM', async () => {
    const res = await request(app).get('/fees');
    const ex = res.body.application.feeCalculationExample;
    expect(ex.donationAmount).toBe(100);
    expect(ex.stellarFee).toBeCloseTo(200 / 10_000_000, 7);
    expect(ex.totalCost).toBeCloseTo(ex.donationAmount + ex.platformFee + ex.stellarFee, 5);
  });

  it('falls back to 100 stroops when service returns no feeStroops', async () => {
    jest.resetModules();
    jest.doMock('../../src/config/serviceContainer', () => ({
      getNetworkStatusService: () => ({
        getStatus: () => ({ connected: false, feeStroops: null, timestamp: null, feeSurgeMultiplier: 1 }),
      }),
    }));
    const router = require('../../src/routes/fees');
    const testApp = express();
    testApp.use(express.json());
    testApp.use('/fees', router);
    const res = await request(testApp).get('/fees');
    expect(res.body.stellar.baseFeeStroops).toBe(100);
    expect(res.body.stellar.feeSource).toBe('fallback_baseline');
  });
});
