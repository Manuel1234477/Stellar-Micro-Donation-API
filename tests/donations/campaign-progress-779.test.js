'use strict';
/**
 * Tests for #779: GET /campaigns/:id/progress — real-time campaign funding progress
 */

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-779-key';
process.env.NODE_ENV = 'test';

const request = require('supertest');
const express = require('express');
const Database = require('../../src/utils/database');
const campaignsRouter = require('../../src/routes/campaigns');
const requireApiKey = require('../../src/middleware/apiKey');
const { attachUserRole } = require('../../src/middleware/rbac');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(requireApiKey);
  app.use(attachUserRole());
  app.use('/campaigns', campaignsRouter);
  app.use((err, req, res, _next) => {
    res.status(err.status || 500).json({ success: false, error: err.message });
  });
  return app;
}

let app;
let campaignId;
let campaignWithEndDate;

beforeAll(async () => {
  await Database.initialize();
  app = createApp();

  // Create a test campaign
  const result = await Database.run(
    `INSERT INTO campaigns (name, description, goal_amount, current_amount, status)
     VALUES (?, ?, ?, ?, ?)`,
    ['Test Campaign 779', 'Progress test', 1000, 250, 'active']
  );
  campaignId = result.id;

  // Create a campaign with an end date
  const endDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(); // 10 days from now
  const result2 = await Database.run(
    `INSERT INTO campaigns (name, description, goal_amount, current_amount, status, end_date)
     VALUES (?, ?, ?, ?, ?, ?)`,
    ['Timed Campaign 779', 'With end date', 500, 100, 'active', endDate]
  );
  campaignWithEndDate = result2.id;
});

afterAll(async () => {
  await Database.close();
});

describe('#779 — GET /campaigns/:id/progress', () => {
  test('returns goal amount, raised amount, and percentage', async () => {
    const res = await request(app)
      .get(`/campaigns/${campaignId}/progress`)
      .set('x-api-key', 'test-779-key');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const { data } = res.body;
    expect(data).toHaveProperty('goalAmount', 1000);
    expect(data).toHaveProperty('raisedAmount', 250);
    expect(data).toHaveProperty('percentage', 25);
  });

  test('returns donor count', async () => {
    const res = await request(app)
      .get(`/campaigns/${campaignId}/progress`)
      .set('x-api-key', 'test-779-key');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('donorCount');
    expect(typeof res.body.data.donorCount).toBe('number');
  });

  test('returns daysRemaining for campaign with end date', async () => {
    const res = await request(app)
      .get(`/campaigns/${campaignWithEndDate}/progress`)
      .set('x-api-key', 'test-779-key');

    expect(res.status).toBe(200);
    const { daysRemaining } = res.body.data;
    expect(daysRemaining).not.toBeNull();
    expect(daysRemaining).toBeGreaterThan(0);
    expect(daysRemaining).toBeLessThanOrEqual(10);
  });

  test('returns daysRemaining as null when no end date', async () => {
    const res = await request(app)
      .get(`/campaigns/${campaignId}/progress`)
      .set('x-api-key', 'test-779-key');

    expect(res.status).toBe(200);
    expect(res.body.data.daysRemaining).toBeNull();
  });

  test('returns remaining amount', async () => {
    const res = await request(app)
      .get(`/campaigns/${campaignId}/progress`)
      .set('x-api-key', 'test-779-key');

    expect(res.status).toBe(200);
    expect(res.body.data.remaining).toBe(750);
  });

  test('returns 404 for non-existent campaign', async () => {
    const res = await request(app)
      .get('/campaigns/999999/progress')
      .set('x-api-key', 'test-779-key');

    expect(res.status).toBe(404);
  });

  test('percentage is capped at 100 when over-funded', async () => {
    const result = await Database.run(
      `INSERT INTO campaigns (name, goal_amount, current_amount, status)
       VALUES (?, ?, ?, ?)`,
      ['Overfunded 779', 100, 150, 'active']
    );

    const res = await request(app)
      .get(`/campaigns/${result.id}/progress`)
      .set('x-api-key', 'test-779-key');

    expect(res.status).toBe(200);
    expect(res.body.data.percentage).toBe(100);
  });
});
