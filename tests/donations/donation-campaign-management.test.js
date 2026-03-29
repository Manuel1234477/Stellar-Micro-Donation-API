/**
 * Test Suite: Donation Campaign Management
 * Asserts campaign native creations, logic bridges and completion webhook closures.
 */

const express = require('express');
const request = require('supertest');
const Database = require('../../src/utils/database');
const campaignsRoutes = require('../../src/routes/campaigns');
const DonationService = require('../../src/services/DonationService');
const WebhookService = require('../../src/services/WebhookService');
const MockStellarService = require('../../src/services/MockStellarService');

describe('Donation Campaign Management Feature', () => {
  let app;
  let donationService;
  
  beforeAll(async () => {
    process.env.API_KEYS = 'test-key';
    
    // Setup in-memory sqlite for tracking schema
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
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Setup Mock App
    app = express();
    app.use(express.json());
    
    // Mock user injection natively
    app.use((req, res, next) => {
      req.user = { id: 1, role: 'admin' };
      next();
    });

    app.use('/campaigns', campaignsRoutes);

    // Provide mocked dependencies
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

  test('should create a campaign properly and set initial states', async () => {
    const res = await request(app)
      .post('/campaigns')
      .set('X-API-Key', 'test-key')
      .send({
        name: 'Relief Fund',
        description: 'Testing',
        goal_amount: 5000,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Relief Fund');
    expect(res.body.data.current_amount).toBe(0);
    expect(res.body.data.status).toBe('active');
  });

  test('should gracefully handle floating schemas mapping properly natively', async () => {
    const res = await request(app)
      .post('/campaigns')
      .set('X-API-Key', 'test-key')
      .send({
        name: 'Relief Fund Float',
        goal_amount: 500.55,
      });
    expect(res.status).toBe(201);
    expect(res.body.data.goal_amount).toBe(500.55);
  });

  test('processCampaignContribution: should increment current_amount and trigger webhook when goal met', async () => {
    const mockDeliver = jest.spyOn(WebhookService, 'deliver').mockResolvedValue(true);

    const { id } = await Database.run(`INSERT INTO campaigns (name, goal_amount, current_amount, status) VALUES ('Water', 500, 0, 'active')`);

    // Donate 300
    await donationService.processCampaignContribution(id, 300);
    let c = await Database.get('SELECT * FROM campaigns WHERE id = ?', [id]);
    expect(c.current_amount).toBe(300);
    expect(c.status).toBe('active');
    expect(mockDeliver).not.toHaveBeenCalled();

    // Donate remaining 200
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

  test('should auto-update expired campaigns to completed internally when GET requests', async () => {
    const pastDate = new Date(Date.now() - 10000).toISOString();
    await Database.run(`INSERT INTO campaigns (name, goal_amount, end_date, status) VALUES ('Expired', 500, ?, 'active')`, [pastDate]);

    const res = await request(app)
        .get('/campaigns')
        .set('X-API-Key', 'test-key');
    expect(res.status).toBe(200);
    
    const camp = res.body.data[0];
    expect(camp.status).toBe('completed');
  });
});
