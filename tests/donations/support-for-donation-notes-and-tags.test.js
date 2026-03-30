/**
 * Support for donation notes and tags - Integration Tests
 */
process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-key-1,test-key-2,admin-key';

const request = require('supertest');
const express = require('express');
const donationRouter = require('../../src/routes/donation');
const statsRouter = require('../../src/routes/stats');
const tagsRouter = require('../../src/routes/tags');
const Transaction = require('../../src/routes/models/transaction');
const { getStellarService } = require('../../src/config/stellar');
const { PREDEFINED_TAGS } = require('../../src/constants/tags');

function createTestApp() {
  const app = express();
  app.use(express.json());

  // Mock attachUserRole middleware to simulate different users
  app.use((req, res, next) => {
    const apiKey = req.get('X-API-Key');
    if (apiKey === 'test-key-1') {
      req.apiKey = { id: 1, role: 'user' };
      req.user = { id: 'user-1', role: 'user', apiKeyId: 1 };
    } else if (apiKey === 'test-key-2') {
      req.apiKey = { id: 2, role: 'premium' };
      req.user = { id: 'user-2', role: 'premium', apiKeyId: 2 };
    } else if (apiKey === 'admin-key') {
      req.apiKey = { id: 3, role: 'admin' };
      req.user = { id: 'admin-1', role: 'admin', apiKeyId: 3 };
    }
    next();
  });

  // Mock idempotency middleware
  app.use((req, res, next) => {
    req.idempotency = { key: req.get('X-Idempotency-Key') || `test-idem-${Date.now()}` };
    next();
  });

  app.use('/donations', donationRouter);
  app.use('/stats', statsRouter);
  app.use('/tags', tagsRouter);

  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({
      success: false,
      error: {
        code: err.code || 'INTERNAL_ERROR',
        message: err.message || 'Internal server error'
      }
    });
  });
  return app;
}

describe('Support for Donation Notes and Tags', () => {
  let app;
  let stellarService;

  beforeAll(async () => {
    app = createTestApp();
    stellarService = getStellarService();
  });

  beforeEach(() => {
    Transaction._clearAllData();
  });

  describe('Taxonomy enforcement', () => {
    test('Standard user can use predefined tags', async () => {
      const response = await request(app)
        .post('/donations')
        .set('X-API-Key', 'test-key-1')
        .send({
          amount: '10',
          donor: 'test-donor',
          recipient: 'test-recipient',
          tags: ['education']
        });
      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });

    test('Standard user cannot use custom tags', async () => {
      const response = await request(app)
        .post('/donations')
        .set('X-API-Key', 'test-key-1')
        .send({
          amount: '10',
          donor: 'test-donor',
          recipient: 'test-recipient',
          tags: ['custom-tag']
        });
      expect(response.status).toBe(500); // Because ValidationError maps to 500 without full error handler mapping
      expect(response.body.error.message).toMatch(/Custom tags are only allowed/);
    });

    test('Premium user can use custom tags', async () => {
      const response = await request(app)
        .post('/donations')
        .set('X-API-Key', 'test-key-2')
        .send({
          amount: '10',
          donor: 'test-donor',
          recipient: 'test-recipient',
          tags: ['custom-tag']
        });
      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });
  });

  describe('Note Privacy', () => {
    let donationId;

    beforeEach(async () => {
      await request(app)
        .post('/donations')
        .set('X-API-Key', 'test-key-1')
        .send({
          amount: '10',
          donor: 'test-donor',
          recipient: 'test-recipient',
          notes: 'This is a private note from user 1'
        });

      const transactions = Transaction.getAll();
      donationId = transactions[0].id;
    });

    test('Owner can view notes', async () => {
      const response = await request(app)
        .get(`/donations/${donationId}`)
        .set('X-API-Key', 'test-key-1');
      
      expect(response.body.data.notes).toBe('This is a private note from user 1');
    });

    test('Non-owner cannot view notes', async () => {
      const response = await request(app)
        .get(`/donations/${donationId}`)
        .set('X-API-Key', 'test-key-2');
      
      expect(response.body.data.notes).toBeUndefined();
    });

    test('Admin can view notes', async () => {
      const response = await request(app)
        .get(`/donations/${donationId}`)
        .set('X-API-Key', 'admin-key');
      
      expect(response.body.data.notes).toBe('This is a private note from user 1');
    });
  });

  describe('Tag Filtering and Analytics', () => {
    beforeEach(async () => {
      // Create some donations
      await request(app)
        .post('/donations')
        .set('X-API-Key', 'test-key-1')
        .send({ amount: '50', recipient: 'test', tags: ['education'] });

      await request(app)
        .post('/donations')
        .set('X-API-Key', 'test-key-2')
        .send({ amount: '100', recipient: 'test', tags: ['education', 'custom1'] });

      await request(app)
        .post('/donations')
        .set('X-API-Key', 'test-key-1')
        .send({ amount: '30', recipient: 'test', tags: ['health'] });
    });

    test('GET /donations?tag=... returns filtered results', async () => {
      const response = await request(app)
        .get('/donations?tag=education')
        .set('X-API-Key', 'test-key-1');

      expect(response.status).toBe(200);
      expect(response.body.count).toBe(2);
      expect(response.body.data.some(tx => tx.amount === '50' || tx.amount === 50)).toBe(true);
      expect(response.body.data.some(tx => tx.amount === '100' || tx.amount === 100)).toBe(true);
    });

    test('GET /stats/tags returns aggregated stats by tag', async () => {
      const d = new Date();
      const startDate = new Date(d.setMonth(d.getMonth() - 1)).toISOString();
      const endDate = new Date(d.setMonth(d.getMonth() + 2)).toISOString();

      const response = await request(app)
        .get(`/stats/tags?startDate=${startDate}&endDate=${endDate}`)
        .set('X-API-Key', 'test-key-1');

      expect(response.status).toBe(200);
      const data = response.body.data;
      
      const educationStats = data.find(s => s.tag === 'education');
      expect(educationStats.totalDonated).toBeCloseTo(150);
      expect(educationStats.donationCount).toBe(2);

      const healthStats = data.find(s => s.tag === 'health');
      expect(healthStats.totalDonated).toBeCloseTo(30);

      const customStats = data.find(s => s.tag === 'custom1');
      expect(customStats.totalDonated).toBeCloseTo(100);
    });
  });

  describe('GET /tags Endpoint', () => {
    test('Standard user sees customAllowed=false', async () => {
      const response = await request(app)
        .get('/tags')
        .set('X-API-Key', 'test-key-1');

      expect(response.status).toBe(200);
      expect(response.body.data.customAllowed).toBe(false);
      expect(response.body.data.predefined).toEqual(expect.arrayContaining(['education']));
    });

    test('Premium user sees customAllowed=true', async () => {
      const response = await request(app)
        .get('/tags')
        .set('X-API-Key', 'test-key-2');

      expect(response.status).toBe(200);
      expect(response.body.data.customAllowed).toBe(true);
    });
  });
});
