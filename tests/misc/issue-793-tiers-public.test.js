'use strict';

/**
 * Tests for #793 — GET /tiers is public (no auth required),
 * rate-limited, and returns Cache-Control: public, max-age=3600.
 */

const request = require('supertest');
const express = require('express');

const MOCK_TIERS = [
  { id: 1, name: 'free', amount: 0, interval: 'monthly', benefits: '["Basic analytics"]', stripe_plan_id: 'plan_free', created_at: '2026-01-01' },
  { id: 2, name: 'pro', amount: 29, interval: 'monthly', benefits: '["Advanced analytics","Webhooks"]', stripe_plan_id: 'plan_pro', created_at: '2026-01-01' },
];

// Stub SubscriptionTierService
jest.mock('../../src/services/SubscriptionTierService', () => {
  return jest.fn().mockImplementation(() => ({
    listTiers: jest.fn().mockResolvedValue(MOCK_TIERS),
  }));
});

// Stub serviceContainer
jest.mock('../../src/config/serviceContainer', () => ({
  getRecurringDonationScheduler: () => ({}),
}));

const tiersRouter = require('../../src/routes/tiers');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/tiers', tiersRouter);
  return app;
}

describe('GET /tiers (#793)', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  it('returns 200 without any API key', async () => {
    const res = await request(app).get('/tiers');
    expect(res.status).toBe(200);
  });

  it('response includes success, data array, count, lastUpdatedAt', async () => {
    const res = await request(app).get('/tiers');
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(typeof res.body.count).toBe('number');
    expect(res.body.lastUpdatedAt).toBeDefined();
  });

  it('sets Cache-Control: public, max-age=3600', async () => {
    const res = await request(app).get('/tiers');
    expect(res.headers['cache-control']).toMatch(/public/);
    expect(res.headers['cache-control']).toMatch(/max-age=3600/);
  });

  it('excludes internal fields (id, stripe_plan_id, created_at) from response', async () => {
    const res = await request(app).get('/tiers');
    for (const tier of res.body.data) {
      expect(tier).not.toHaveProperty('id');
      expect(tier).not.toHaveProperty('stripe_plan_id');
      expect(tier).not.toHaveProperty('created_at');
    }
  });

  it('includes name, amount, interval, benefits', async () => {
    const res = await request(app).get('/tiers');
    const tier = res.body.data[0];
    expect(tier).toHaveProperty('name');
    expect(tier).toHaveProperty('amount');
    expect(tier).toHaveProperty('interval');
    expect(tier).toHaveProperty('benefits');
  });

  it('parses JSON benefits string into array', async () => {
    const res = await request(app).get('/tiers');
    const tier = res.body.data[0];
    expect(Array.isArray(tier.benefits)).toBe(true);
  });
});
