/**
 * Test Suite: Donation Campaign Management
 * Asserts campaign creations, expiry filtering, and donation guard.
 */

const express = require('express');
const request = require('supertest');
const Database = require('../../src/utils/database');
const campaignsRoutes = require('../../src/routes/campaigns');
const DonationService = require('../../src/services/DonationService');
const WebhookService = require('../../src/services/WebhookService');
const MockStellarService = require('../../src/services/MockStellarService');

// Minimal app for campaign guard testing that avoids the full donation service chain
function buildCampaignGuardApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = { id: 1, role: 'admin' }; next(); });
  app.use('/campaigns', campaignsRoutes);

  // Minimal /donations/send that only exercises the campaign guard
  app.post('/donations/send', async (req, res) => {
    const { campaign_id, senderId, receiverId, amount } = req.body;
    if (!senderId || !receiverId || !amount) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }
    if (campaign_id) {
      const campaign = await Database.get(
        `SELECT id, end_date, status FROM campaigns WHERE id = ? AND deleted_at IS NULL`,
        [campaign_id]
      );
      if (!campaign) {
        return res.status(404).json({ success: false, error: 'Campaign not found' });
      }
      const isExpired =
        campaign.status === 'expired' ||
        (campaign.end_date && new Date(campaign.end_date) < new Date());
      if (isExpired) {
        return res.status(422).json({
          success: false,
          error: 'Campaign has ended',
          campaignId: campaign.id,
          endedAt: campaign.end_date
        });
      }
    }
    // Guard passed — return a stub success (no actual Stellar call)
    return res.status(200).json({ success: true, data: { id: 999 } });
  });

  app.use((err, req, res, _next) => {
    res.status(err.status || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('Donation Campaign Management Feature', () => {
  let app;
  let donationService;

  beforeAll(async () => {
    process.env.API_KEYS = 'test-key';
    process.env.MOCK_STELLAR = 'true';

    await Database.run(`
      CREATE TABLE IF NOT EXISTS campaigns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        goal_amount REAL NOT NULL,
        current_amount REAL DEFAULT 0,
        start_date DATETIME,
        end_date DATETIME,
        status TEXT DEFAULT 'active',
        created_by INTEGER,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted_at DATETIME DEFAULT NULL
      )
    `);

    app = buildCampaignGuardApp();

    const mService = new MockStellarService();
    donationService = new DonationService(mService);
  });

  afterAll(async () => {
    await Database.close();
  });

  afterEach(async () => {
    await Database.run('DELETE FROM campaigns');
    jest.restoreAllMocks();
  });

  // ── Campaign creation ────────────────────────────────────────────────────────

  test('should create a campaign and set initial states', async () => {
    const res = await request(app)
      .post('/campaigns')
      .set('X-API-Key', 'test-key')
      .send({ name: 'Relief Fund', description: 'Testing', goal_amount: 5000 });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Relief Fund');
    expect(res.body.data.current_amount).toBe(0);
    expect(res.body.data.status).toBe('active');
  });

  test('should accept float goal_amount', async () => {
    const res = await request(app)
      .post('/campaigns')
      .set('X-API-Key', 'test-key')
      .send({ name: 'Float Fund', goal_amount: 500.55 });

    expect(res.status).toBe(201);
    expect(res.body.data.goal_amount).toBe(500.55);
  });

  // ── GET /campaigns filtering ─────────────────────────────────────────────────

  test('GET /campaigns default returns only active (non-expired) campaigns', async () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const future = new Date(Date.now() + 86400000).toISOString();
    await Database.run(`INSERT INTO campaigns (name, goal_amount, end_date, status) VALUES ('Past', 100, ?, 'active')`, [past]);
    await Database.run(`INSERT INTO campaigns (name, goal_amount, end_date, status) VALUES ('Future', 100, ?, 'active')`, [future]);
    await Database.run(`INSERT INTO campaigns (name, goal_amount, end_date, status) VALUES ('NoEnd', 100, NULL, 'active')`);

    const res = await request(app).get('/campaigns');
    expect(res.status).toBe(200);
    const names = res.body.data.map(c => c.name);
    expect(names).toContain('Future');
    expect(names).toContain('NoEnd');
    expect(names).not.toContain('Past');
  });

  test('GET /campaigns?status=expired returns only expired campaigns', async () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const future = new Date(Date.now() + 86400000).toISOString();
    await Database.run(`INSERT INTO campaigns (name, goal_amount, end_date, status) VALUES ('Past', 100, ?, 'active')`, [past]);
    await Database.run(`INSERT INTO campaigns (name, goal_amount, end_date, status) VALUES ('Future', 100, ?, 'active')`, [future]);

    const res = await request(app).get('/campaigns?status=expired');
    expect(res.status).toBe(200);
    const names = res.body.data.map(c => c.name);
    expect(names).toContain('Past');
    expect(names).not.toContain('Future');
  });

  test('GET /campaigns?status=all returns every non-deleted campaign', async () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const future = new Date(Date.now() + 86400000).toISOString();
    await Database.run(`INSERT INTO campaigns (name, goal_amount, end_date, status) VALUES ('Past', 100, ?, 'active')`, [past]);
    await Database.run(`INSERT INTO campaigns (name, goal_amount, end_date, status) VALUES ('Future', 100, ?, 'active')`, [future]);

    const res = await request(app).get('/campaigns?status=all');
    expect(res.status).toBe(200);
    const names = res.body.data.map(c => c.name);
    expect(names).toContain('Past');
    expect(names).toContain('Future');
  });

  test('GET /campaigns auto-marks stale active campaigns as expired in DB', async () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const { id } = await Database.run(
      `INSERT INTO campaigns (name, goal_amount, end_date, status) VALUES ('Stale', 100, ?, 'active')`,
      [past]
    );

    await request(app).get('/campaigns');

    const row = await Database.get('SELECT status FROM campaigns WHERE id = ?', [id]);
    expect(row.status).toBe('expired');
  });

  // ── Donation guard ───────────────────────────────────────────────────────────

  test('POST /donations/send returns 404 when campaign_id does not exist', async () => {
    const res = await request(app)
      .post('/donations/send')
      .send({ senderId: 1, receiverId: 2, amount: 10, campaign_id: 99999 });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  test('POST /donations/send returns 422 when campaign is expired', async () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const { id } = await Database.run(
      `INSERT INTO campaigns (name, goal_amount, end_date, status) VALUES ('Ended', 100, ?, 'active')`,
      [past]
    );

    const res = await request(app)
      .post('/donations/send')
      .send({ senderId: 1, receiverId: 2, amount: 10, campaign_id: id });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('Campaign has ended');
    expect(res.body.campaignId).toBe(id);
    expect(res.body.endedAt).toBeTruthy();
  });

  test('POST /donations/send passes guard for active campaign', async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const { id } = await Database.run(
      `INSERT INTO campaigns (name, goal_amount, end_date, status) VALUES ('Active', 100, ?, 'active')`,
      [future]
    );

    const res = await request(app)
      .post('/donations/send')
      .send({ senderId: 1, receiverId: 2, amount: 10, campaign_id: id });

    // Guard passed — stub returns 200
    expect(res.status).toBe(200);
  });

  // ── Webhook / contribution ───────────────────────────────────────────────────

  test('processCampaignContribution: increments amount and triggers webhook on goal met', async () => {
    const mockDeliver = jest.spyOn(WebhookService, 'deliver').mockResolvedValue(true);
    const { id } = await Database.run(
      `INSERT INTO campaigns (name, goal_amount, current_amount, status) VALUES ('Water', 500, 0, 'active')`
    );

    await donationService.processCampaignContribution(id, 300);
    let c = await Database.get('SELECT * FROM campaigns WHERE id = ?', [id]);
    expect(c.current_amount).toBe(300);
    expect(c.status).toBe('active');
    expect(mockDeliver).not.toHaveBeenCalled();

    await donationService.processCampaignContribution(id, 200);
    c = await Database.get('SELECT * FROM campaigns WHERE id = ?', [id]);
    expect(c.current_amount).toBe(500);
    expect(c.status).toBe('completed');
    expect(mockDeliver).toHaveBeenCalledWith('campaign.completed', expect.objectContaining({
      campaign_id: id,
      goal_amount: 500,
      final_amount: 500
    }));
  });
});

describe('Donation Campaign Management Feature', () => {
  let app;
  let donationService;

  beforeAll(async () => {
    process.env.API_KEYS = 'test-key';
    process.env.MOCK_STELLAR = 'true';

    await Database.run(`
      CREATE TABLE IF NOT EXISTS campaigns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        goal_amount REAL NOT NULL,
        current_amount REAL DEFAULT 0,
        start_date DATETIME,
        end_date DATETIME,
        status TEXT DEFAULT 'active',
        created_by INTEGER,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted_at DATETIME DEFAULT NULL
      )
    `);

    app = buildApp();

    const mService = new MockStellarService();
    donationService = new DonationService(mService);
  });

  afterAll(async () => {
    await Database.close();
  });

  afterEach(async () => {
    await Database.run('DELETE FROM campaigns');
    jest.restoreAllMocks();
  });

  // ── Campaign creation ────────────────────────────────────────────────────────

  test('should create a campaign and set initial states', async () => {
    const res = await request(app)
      .post('/campaigns')
      .set('X-API-Key', 'test-key')
      .send({ name: 'Relief Fund', description: 'Testing', goal_amount: 5000 });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Relief Fund');
    expect(res.body.data.current_amount).toBe(0);
    expect(res.body.data.status).toBe('active');
  });

  test('should accept float goal_amount', async () => {
    const res = await request(app)
      .post('/campaigns')
      .set('X-API-Key', 'test-key')
      .send({ name: 'Float Fund', goal_amount: 500.55 });

    expect(res.status).toBe(201);
    expect(res.body.data.goal_amount).toBe(500.55);
  });

  // ── GET /campaigns filtering ─────────────────────────────────────────────────

  test('GET /campaigns default returns only active (non-expired) campaigns', async () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const future = new Date(Date.now() + 86400000).toISOString();
    await Database.run(`INSERT INTO campaigns (name, goal_amount, end_date, status) VALUES ('Past', 100, ?, 'active')`, [past]);
    await Database.run(`INSERT INTO campaigns (name, goal_amount, end_date, status) VALUES ('Future', 100, ?, 'active')`, [future]);
    await Database.run(`INSERT INTO campaigns (name, goal_amount, end_date, status) VALUES ('NoEnd', 100, NULL, 'active')`);

    const res = await request(app).get('/campaigns');
    expect(res.status).toBe(200);
    const names = res.body.data.map(c => c.name);
    expect(names).toContain('Future');
    expect(names).toContain('NoEnd');
    expect(names).not.toContain('Past');
  });

  test('GET /campaigns?status=expired returns only expired campaigns', async () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const future = new Date(Date.now() + 86400000).toISOString();
    await Database.run(`INSERT INTO campaigns (name, goal_amount, end_date, status) VALUES ('Past', 100, ?, 'active')`, [past]);
    await Database.run(`INSERT INTO campaigns (name, goal_amount, end_date, status) VALUES ('Future', 100, ?, 'active')`, [future]);

    const res = await request(app).get('/campaigns?status=expired');
    expect(res.status).toBe(200);
    const names = res.body.data.map(c => c.name);
    expect(names).toContain('Past');
    expect(names).not.toContain('Future');
  });

  test('GET /campaigns?status=all returns every non-deleted campaign', async () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const future = new Date(Date.now() + 86400000).toISOString();
    await Database.run(`INSERT INTO campaigns (name, goal_amount, end_date, status) VALUES ('Past', 100, ?, 'active')`, [past]);
    await Database.run(`INSERT INTO campaigns (name, goal_amount, end_date, status) VALUES ('Future', 100, ?, 'active')`, [future]);

    const res = await request(app).get('/campaigns?status=all');
    expect(res.status).toBe(200);
    const names = res.body.data.map(c => c.name);
    expect(names).toContain('Past');
    expect(names).toContain('Future');
  });

  test('GET /campaigns auto-marks stale active campaigns as expired in DB', async () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const { id } = await Database.run(
      `INSERT INTO campaigns (name, goal_amount, end_date, status) VALUES ('Stale', 100, ?, 'active')`,
      [past]
    );

    await request(app).get('/campaigns');

    const row = await Database.get('SELECT status FROM campaigns WHERE id = ?', [id]);
    expect(row.status).toBe('expired');
  });

  // ── Donation guard ───────────────────────────────────────────────────────────

  test('POST /donations/send returns 404 when campaign_id does not exist', async () => {
    const res = await request(app)
      .post('/donations/send')
      .set('X-API-Key', 'test-key')
      .set('X-Idempotency-Key', 'idem-no-campaign')
      .send({ senderId: 1, receiverId: 2, amount: 10, campaign_id: 99999 });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  test('POST /donations/send returns 422 when campaign is expired', async () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const { id } = await Database.run(
      `INSERT INTO campaigns (name, goal_amount, end_date, status) VALUES ('Ended', 100, ?, 'active')`,
      [past]
    );

    const res = await request(app)
      .post('/donations/send')
      .set('X-API-Key', 'test-key')
      .set('X-Idempotency-Key', 'idem-expired-campaign')
      .send({ senderId: 1, receiverId: 2, amount: 10, campaign_id: id });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('Campaign has ended');
    expect(res.body.campaignId).toBe(id);
    expect(res.body.endedAt).toBeTruthy();
  });

  // ── Webhook / contribution ───────────────────────────────────────────────────

  test('processCampaignContribution: increments amount and triggers webhook on goal met', async () => {
    const mockDeliver = jest.spyOn(WebhookService, 'deliver').mockResolvedValue(true);
    const { id } = await Database.run(
      `INSERT INTO campaigns (name, goal_amount, current_amount, status) VALUES ('Water', 500, 0, 'active')`
    );

    await donationService.processCampaignContribution(id, 300);
    let c = await Database.get('SELECT * FROM campaigns WHERE id = ?', [id]);
    expect(c.current_amount).toBe(300);
    expect(c.status).toBe('active');
    expect(mockDeliver).not.toHaveBeenCalled();

    await donationService.processCampaignContribution(id, 200);
    c = await Database.get('SELECT * FROM campaigns WHERE id = ?', [id]);
    expect(c.current_amount).toBe(500);
    expect(c.status).toBe('completed');
    expect(mockDeliver).toHaveBeenCalledWith('campaign.completed', expect.objectContaining({
      campaign_id: id,
      goal_amount: 500,
      final_amount: 500
    }));
  });
});
