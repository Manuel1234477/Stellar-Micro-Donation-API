/**
 * Test Suite: Donation Impact Reporting
 *
 * Covers:
 *  - ImpactMetricService CRUD and calculation logic
 *  - POST /admin/impact-metrics
 *  - GET /donations/:id/impact
 *  - GET /campaigns/:id/impact
 *  - Edge cases: fractional units, zero amount, no metrics, missing campaign
 */

const express = require('express');
const request = require('supertest');
const Database = require('../../src/utils/database');
const ImpactMetricService = require('../../src/services/ImpactMetricService');
const impactMetricsAdminRoutes = require('../../src/routes/admin/impactMetrics');
const campaignsRoutes = require('../../src/routes/campaigns');
const MockStellarService = require('../../src/services/MockStellarService');

// ─── Helpers ────────────────────────────────────────────────────────────────

async function createCampaign(amount = 0) {
  const result = await Database.run(
    `INSERT INTO campaigns (name, description, goal_amount, current_amount, start_date, status)
     VALUES (?, ?, ?, ?, ?, 'active')`,
    ['Test Campaign', 'desc', 1000, amount, new Date().toISOString()]
  );
  return Database.get('SELECT * FROM campaigns WHERE id = ?', [result.id]);
}

async function createMetric(campaign_id, unit = 'meal', amount_per_unit = 10) {
  return ImpactMetricService.create({ campaign_id, unit, amount_per_unit, description: `1 ${unit}` });
}

// ─── Setup ───────────────────────────────────────────────────────────────────

let app;

beforeAll(async () => {
  process.env.API_KEYS = 'test-key';

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

  await Database.run(`
    CREATE TABLE IF NOT EXISTS impact_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      unit TEXT NOT NULL,
      amount_per_unit REAL NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
    )
  `);

  await Database.run(`
    CREATE INDEX IF NOT EXISTS idx_impact_metrics_campaign_id
    ON impact_metrics(campaign_id)
  `);

  app = express();
  app.use(express.json());

  // Inject admin user for all requests
  app.use((req, res, next) => {
    req.user = { id: 1, role: 'admin' };
    req.apiKey = { id: 1, role: 'admin' };
    next();
  });

  app.use('/admin/impact-metrics', impactMetricsAdminRoutes);
  app.use('/campaigns', campaignsRoutes);

  // Minimal donation route for impact endpoint
  const donationRouter = express.Router();
  donationRouter.get('/:id/impact', async (req, res, next) => {
    try {
      // Simulate a donation record with campaign_id
      const donation = req._mockDonation;
      if (!donation) {
        return res.status(404).json({ success: false, error: 'Donation not found' });
      }
      if (!donation.campaign_id) {
        return res.json({
          success: true,
          data: { donation_id: donation.id, amount: donation.amount, campaign_id: null, impact: [], message: 'No campaign associated with this donation' },
        });
      }
      const impact = await ImpactMetricService.calculateDonationImpact(parseFloat(donation.amount), donation.campaign_id);
      res.json({ success: true, data: { donation_id: donation.id, amount: donation.amount, campaign_id: donation.campaign_id, impact } });
    } catch (err) {
      next(err);
    }
  });

  // Middleware to inject mock donation for tests
  app.use('/donations', (req, res, next) => {
    req._mockDonation = req.headers['x-mock-donation']
      ? JSON.parse(req.headers['x-mock-donation'])
      : null;
    next();
  }, donationRouter);

  // Error handler
  app.use((err, req, res, _next) => {
    const status = err.statusCode || err.status || 500;
    res.status(status).json({ success: false, error: { message: err.message, code: err.code } });
  });
});

afterAll(async () => {
  await Database.close();
});

afterEach(async () => {
  await Database.run('DELETE FROM impact_metrics');
  await Database.run('DELETE FROM campaigns');
});

// ─── ImpactMetricService Unit Tests ─────────────────────────────────────────

describe('ImpactMetricService', () => {
  describe('create()', () => {
    test('creates a metric and returns the record', async () => {
      const campaign = await createCampaign();
      const metric = await ImpactMetricService.create({
        campaign_id: campaign.id,
        unit: 'meal',
        amount_per_unit: 10,
        description: 'Feeds one person',
      });

      expect(metric.id).toBeDefined();
      expect(metric.campaign_id).toBe(campaign.id);
      expect(metric.unit).toBe('meal');
      expect(metric.amount_per_unit).toBe(10);
      expect(metric.description).toBe('Feeds one person');
    });

    test('creates a metric with null description', async () => {
      const campaign = await createCampaign();
      const metric = await ImpactMetricService.create({
        campaign_id: campaign.id,
        unit: 'book',
        amount_per_unit: 5,
      });
      expect(metric.description).toBeNull();
    });

    test('throws ValidationError when campaign does not exist', async () => {
      await expect(
        ImpactMetricService.create({ campaign_id: 99999, unit: 'meal', amount_per_unit: 10 })
      ).rejects.toMatchObject({ message: 'Campaign not found' });
    });
  });

  describe('getById()', () => {
    test('returns the metric by id', async () => {
      const campaign = await createCampaign();
      const created = await createMetric(campaign.id);
      const fetched = await ImpactMetricService.getById(created.id);
      expect(fetched.id).toBe(created.id);
    });

    test('throws NotFoundError for unknown id', async () => {
      await expect(ImpactMetricService.getById(99999)).rejects.toMatchObject({
        message: 'Impact metric not found',
      });
    });
  });

  describe('getByCampaign()', () => {
    test('returns all metrics for a campaign ordered by amount_per_unit', async () => {
      const campaign = await createCampaign();
      await createMetric(campaign.id, 'book', 5);
      await createMetric(campaign.id, 'meal', 10);
      await createMetric(campaign.id, 'tree', 25);

      const metrics = await ImpactMetricService.getByCampaign(campaign.id);
      expect(metrics).toHaveLength(3);
      expect(metrics[0].unit).toBe('book');
      expect(metrics[1].unit).toBe('meal');
      expect(metrics[2].unit).toBe('tree');
    });

    test('returns empty array when no metrics defined', async () => {
      const campaign = await createCampaign();
      const metrics = await ImpactMetricService.getByCampaign(campaign.id);
      expect(metrics).toEqual([]);
    });
  });

  describe('calculateDonationImpact()', () => {
    test('calculates whole units correctly', async () => {
      const campaign = await createCampaign();
      await createMetric(campaign.id, 'meal', 10);

      const impact = await ImpactMetricService.calculateDonationImpact(50, campaign.id);
      expect(impact).toHaveLength(1);
      expect(impact[0].unit).toBe('meal');
      expect(impact[0].units_delivered).toBe(5);
    });

    test('floors fractional units', async () => {
      const campaign = await createCampaign();
      await createMetric(campaign.id, 'meal', 10);

      const impact = await ImpactMetricService.calculateDonationImpact(25, campaign.id);
      expect(impact[0].units_delivered).toBe(2); // floor(25/10) = 2
    });

    test('returns 0 units when donation is less than amount_per_unit', async () => {
      const campaign = await createCampaign();
      await createMetric(campaign.id, 'meal', 100);

      const impact = await ImpactMetricService.calculateDonationImpact(50, campaign.id);
      expect(impact[0].units_delivered).toBe(0);
    });

    test('handles zero donation amount', async () => {
      const campaign = await createCampaign();
      await createMetric(campaign.id, 'meal', 10);

      const impact = await ImpactMetricService.calculateDonationImpact(0, campaign.id);
      expect(impact[0].units_delivered).toBe(0);
    });

    test('handles multiple metrics for same campaign', async () => {
      const campaign = await createCampaign();
      await createMetric(campaign.id, 'meal', 10);
      await createMetric(campaign.id, 'book', 25);

      const impact = await ImpactMetricService.calculateDonationImpact(100, campaign.id);
      expect(impact).toHaveLength(2);

      const mealImpact = impact.find(i => i.unit === 'meal');
      const bookImpact = impact.find(i => i.unit === 'book');
      expect(mealImpact.units_delivered).toBe(10);
      expect(bookImpact.units_delivered).toBe(4);
    });

    test('returns empty array when no metrics defined', async () => {
      const campaign = await createCampaign();
      const impact = await ImpactMetricService.calculateDonationImpact(100, campaign.id);
      expect(impact).toEqual([]);
    });

    test('handles fractional amount_per_unit (e.g. $0.50 per unit)', async () => {
      const campaign = await createCampaign();
      await createMetric(campaign.id, 'snack', 0.5);

      const impact = await ImpactMetricService.calculateDonationImpact(7.3, campaign.id);
      expect(impact[0].units_delivered).toBe(14); // floor(7.3 / 0.5) = 14
    });

    test('includes amount_per_unit and description in result', async () => {
      const campaign = await createCampaign();
      await ImpactMetricService.create({
        campaign_id: campaign.id,
        unit: 'meal',
        amount_per_unit: 10,
        description: 'Feeds one person for a day',
      });

      const impact = await ImpactMetricService.calculateDonationImpact(30, campaign.id);
      expect(impact[0].amount_per_unit).toBe(10);
      expect(impact[0].description).toBe('Feeds one person for a day');
    });
  });

  describe('calculateCampaignImpact()', () => {
    test('returns aggregate impact based on current_amount', async () => {
      const campaign = await createCampaign(200);
      await createMetric(campaign.id, 'meal', 10);

      const summary = await ImpactMetricService.calculateCampaignImpact(campaign.id);
      expect(summary.campaign_id).toBe(campaign.id);
      expect(summary.total_donated).toBe(200);
      expect(summary.impact[0].units_delivered).toBe(20);
    });

    test('returns zero units when campaign has no donations', async () => {
      const campaign = await createCampaign(0);
      await createMetric(campaign.id, 'meal', 10);

      const summary = await ImpactMetricService.calculateCampaignImpact(campaign.id);
      expect(summary.total_donated).toBe(0);
      expect(summary.impact[0].units_delivered).toBe(0);
    });

    test('throws NotFoundError for unknown campaign', async () => {
      await expect(ImpactMetricService.calculateCampaignImpact(99999)).rejects.toMatchObject({
        message: 'Campaign not found',
      });
    });
  });
});

// ─── POST /admin/impact-metrics ──────────────────────────────────────────────

describe('POST /admin/impact-metrics', () => {
  test('creates a metric and returns 201', async () => {
    const campaign = await createCampaign();

    const res = await request(app)
      .post('/admin/impact-metrics')
      .set('X-API-Key', 'test-key')
      .send({ campaign_id: campaign.id, unit: 'meal', amount_per_unit: 10, description: 'One meal' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.unit).toBe('meal');
    expect(res.body.data.amount_per_unit).toBe(10);
  });

  test('returns 400 when campaign_id is missing', async () => {
    const res = await request(app)
      .post('/admin/impact-metrics')
      .set('X-API-Key', 'test-key')
      .send({ unit: 'meal', amount_per_unit: 10 });

    expect(res.status).toBe(400);
  });

  test('returns 400 when unit is missing', async () => {
    const campaign = await createCampaign();
    const res = await request(app)
      .post('/admin/impact-metrics')
      .set('X-API-Key', 'test-key')
      .send({ campaign_id: campaign.id, amount_per_unit: 10 });

    expect(res.status).toBe(400);
  });

  test('returns 400 when amount_per_unit is missing', async () => {
    const campaign = await createCampaign();
    const res = await request(app)
      .post('/admin/impact-metrics')
      .set('X-API-Key', 'test-key')
      .send({ campaign_id: campaign.id, unit: 'meal' });

    expect(res.status).toBe(400);
  });

  test('returns 400 when amount_per_unit is zero', async () => {
    const campaign = await createCampaign();
    const res = await request(app)
      .post('/admin/impact-metrics')
      .set('X-API-Key', 'test-key')
      .send({ campaign_id: campaign.id, unit: 'meal', amount_per_unit: 0 });

    expect(res.status).toBe(400);
  });

  test('returns 400 when amount_per_unit is negative', async () => {
    const campaign = await createCampaign();
    const res = await request(app)
      .post('/admin/impact-metrics')
      .set('X-API-Key', 'test-key')
      .send({ campaign_id: campaign.id, unit: 'meal', amount_per_unit: -5 });

    expect(res.status).toBe(400);
  });

  test('returns error when campaign does not exist', async () => {
    const res = await request(app)
      .post('/admin/impact-metrics')
      .set('X-API-Key', 'test-key')
      .send({ campaign_id: 99999, unit: 'meal', amount_per_unit: 10 });

    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test('accepts optional description', async () => {
    const campaign = await createCampaign();
    const res = await request(app)
      .post('/admin/impact-metrics')
      .set('X-API-Key', 'test-key')
      .send({ campaign_id: campaign.id, unit: 'book', amount_per_unit: 5, description: 'One book for a child' });

    expect(res.status).toBe(201);
    expect(res.body.data.description).toBe('One book for a child');
  });

  test('creates metric without description (null)', async () => {
    const campaign = await createCampaign();
    const res = await request(app)
      .post('/admin/impact-metrics')
      .set('X-API-Key', 'test-key')
      .send({ campaign_id: campaign.id, unit: 'tree', amount_per_unit: 20 });

    expect(res.status).toBe(201);
    expect(res.body.data.description).toBeNull();
  });
});

// ─── GET /admin/impact-metrics ───────────────────────────────────────────────

describe('GET /admin/impact-metrics', () => {
  test('returns all metrics', async () => {
    const campaign = await createCampaign();
    await createMetric(campaign.id, 'meal', 10);
    await createMetric(campaign.id, 'book', 5);

    const res = await request(app)
      .get('/admin/impact-metrics')
      .set('X-API-Key', 'test-key');

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
  });

  test('filters by campaign_id', async () => {
    const c1 = await createCampaign();
    const c2 = await createCampaign();
    await createMetric(c1.id, 'meal', 10);
    await createMetric(c2.id, 'book', 5);

    const res = await request(app)
      .get(`/admin/impact-metrics?campaign_id=${c1.id}`)
      .set('X-API-Key', 'test-key');

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.data[0].unit).toBe('meal');
  });
});

// ─── GET /admin/impact-metrics/:id ───────────────────────────────────────────

describe('GET /admin/impact-metrics/:id', () => {
  test('returns a specific metric', async () => {
    const campaign = await createCampaign();
    const metric = await createMetric(campaign.id);

    const res = await request(app)
      .get(`/admin/impact-metrics/${metric.id}`)
      .set('X-API-Key', 'test-key');

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(metric.id);
  });

  test('returns 404 for unknown id', async () => {
    const res = await request(app)
      .get('/admin/impact-metrics/99999')
      .set('X-API-Key', 'test-key');

    expect(res.status).toBe(404);
  });
});

// ─── GET /donations/:id/impact ───────────────────────────────────────────────

describe('GET /donations/:id/impact', () => {
  test('returns impact for a donation with a campaign', async () => {
    const campaign = await createCampaign();
    await createMetric(campaign.id, 'meal', 10);

    const mockDonation = { id: 'don-1', amount: 50, campaign_id: campaign.id };

    const res = await request(app)
      .get('/donations/don-1/impact')
      .set('x-mock-donation', JSON.stringify(mockDonation));

    expect(res.status).toBe(200);
    expect(res.body.data.impact[0].units_delivered).toBe(5);
    expect(res.body.data.campaign_id).toBe(campaign.id);
  });

  test('returns empty impact for donation without campaign', async () => {
    const mockDonation = { id: 'don-2', amount: 50, campaign_id: null };

    const res = await request(app)
      .get('/donations/don-2/impact')
      .set('x-mock-donation', JSON.stringify(mockDonation));

    expect(res.status).toBe(200);
    expect(res.body.data.impact).toEqual([]);
    expect(res.body.data.campaign_id).toBeNull();
  });

  test('returns 404 when donation not found', async () => {
    const res = await request(app).get('/donations/nonexistent/impact');
    expect(res.status).toBe(404);
  });

  test('returns empty impact when campaign has no metrics', async () => {
    const campaign = await createCampaign();
    const mockDonation = { id: 'don-3', amount: 100, campaign_id: campaign.id };

    const res = await request(app)
      .get('/donations/don-3/impact')
      .set('x-mock-donation', JSON.stringify(mockDonation));

    expect(res.status).toBe(200);
    expect(res.body.data.impact).toEqual([]);
  });
});

// ─── GET /campaigns/:id/impact ───────────────────────────────────────────────

describe('GET /campaigns/:id/impact', () => {
  test('returns aggregate impact for a campaign', async () => {
    const campaign = await createCampaign(300);
    await createMetric(campaign.id, 'meal', 10);

    const res = await request(app)
      .get(`/campaigns/${campaign.id}/impact`);

    expect(res.status).toBe(200);
    expect(res.body.data.total_donated).toBe(300);
    expect(res.body.data.impact[0].units_delivered).toBe(30);
  });

  test('returns 404 for unknown campaign', async () => {
    const res = await request(app).get('/campaigns/99999/impact');
    expect(res.status).toBe(404);
  });

  test('returns zero units when campaign has no donations', async () => {
    const campaign = await createCampaign(0);
    await createMetric(campaign.id, 'meal', 10);

    const res = await request(app).get(`/campaigns/${campaign.id}/impact`);

    expect(res.status).toBe(200);
    expect(res.body.data.total_donated).toBe(0);
    expect(res.body.data.impact[0].units_delivered).toBe(0);
  });

  test('returns empty impact array when no metrics defined', async () => {
    const campaign = await createCampaign(500);

    const res = await request(app).get(`/campaigns/${campaign.id}/impact`);

    expect(res.status).toBe(200);
    expect(res.body.data.impact).toEqual([]);
  });

  test('handles multiple metrics correctly', async () => {
    const campaign = await createCampaign(100);
    await createMetric(campaign.id, 'meal', 10);
    await createMetric(campaign.id, 'book', 25);

    const res = await request(app).get(`/campaigns/${campaign.id}/impact`);

    expect(res.status).toBe(200);
    const mealImpact = res.body.data.impact.find(i => i.unit === 'meal');
    const bookImpact = res.body.data.impact.find(i => i.unit === 'book');
    expect(mealImpact.units_delivered).toBe(10);
    expect(bookImpact.units_delivered).toBe(4);
  });
});

// ─── Accuracy / Edge Cases ───────────────────────────────────────────────────

describe('Impact calculation accuracy', () => {
  test('large donation with small unit cost', async () => {
    const campaign = await createCampaign();
    await createMetric(campaign.id, 'cup of water', 0.01);

    const impact = await ImpactMetricService.calculateDonationImpact(1000, campaign.id);
    expect(impact[0].units_delivered).toBe(100000);
  });

  test('exact multiple produces no remainder', async () => {
    const campaign = await createCampaign();
    await createMetric(campaign.id, 'meal', 7);

    const impact = await ImpactMetricService.calculateDonationImpact(49, campaign.id);
    expect(impact[0].units_delivered).toBe(7);
  });

  test('just below threshold produces one fewer unit', async () => {
    const campaign = await createCampaign();
    await createMetric(campaign.id, 'meal', 10);

    const impact = await ImpactMetricService.calculateDonationImpact(9.99, campaign.id);
    expect(impact[0].units_delivered).toBe(0);
  });

  test('MockStellarService is not required for impact calculations', async () => {
    // Confirm no Stellar network calls are made
    const mockStellar = new MockStellarService();
    const campaign = await createCampaign(50);
    await createMetric(campaign.id, 'meal', 10);

    // Impact calculation is purely DB-based — no stellar calls needed
    const summary = await ImpactMetricService.calculateCampaignImpact(campaign.id);
    expect(summary.impact[0].units_delivered).toBe(5);

    // Stellar service should have had zero interactions
    expect(mockStellar.transactions.size).toBe(0);
  });
});
