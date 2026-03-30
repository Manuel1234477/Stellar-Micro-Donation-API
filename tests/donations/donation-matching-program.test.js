/**
 * Test Suite: Donation Matching Program Support
 *
 * Tests matching program creation, matching logic, utilization tracking,
 * exhaustion notifications, edge cases, and validation errors.
 * Uses MockStellarService — no live Stellar network required.
 */

const express = require('express');
const request = require('supertest');
const Database = require('../../src/utils/database');
const MatchingProgramService = require('../../src/services/MatchingProgramService');
const DonationService = require('../../src/services/DonationService');
const MockStellarService = require('../../src/services/MockStellarService');
const WebhookService = require('../../src/services/WebhookService');
const matchingProgramsRoutes = require('../../src/routes/admin/matchingPrograms');

describe('Donation Matching Program Support', () => {
  let app;
  let donationService;
  let mockStellarService;

  beforeAll(async () => {
    process.env.API_KEYS = 'test-admin-key';

    // Create required tables
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
      CREATE TABLE IF NOT EXISTS matching_programs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sponsor_wallet_id TEXT NOT NULL,
        match_ratio REAL NOT NULL DEFAULT 1.0,
        max_match_amount REAL NOT NULL,
        remaining_match_amount REAL NOT NULL,
        campaign_id INTEGER,
        status TEXT NOT NULL DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
      )
    `);

    await Database.run(`
      CREATE TABLE IF NOT EXISTS matching_donations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        matching_program_id INTEGER NOT NULL,
        original_donation_id INTEGER NOT NULL,
        matched_amount REAL NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (matching_program_id) REFERENCES matching_programs(id)
      )
    `);

    await Database.run(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        senderId INTEGER,
        receiverId INTEGER,
        amount REAL NOT NULL,
        memo TEXT,
        notes TEXT,
        tags TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        idempotencyKey TEXT UNIQUE,
        stellar_tx_id TEXT UNIQUE,
        is_orphan INTEGER NOT NULL DEFAULT 0,
        campaign_id INTEGER
      )
    `);

    // Setup Express app with admin mock
    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.user = { id: 1, role: 'admin' };
      req.apiKey = { id: 'test-admin-key', role: 'admin' };
      next();
    });
    app.use('/admin/matching-programs', matchingProgramsRoutes);

    mockStellarService = new MockStellarService();
    donationService = new DonationService(mockStellarService);
  });

  afterAll(async () => {
    await Database.close();
  });

  afterEach(async () => {
    await Database.run('DELETE FROM matching_donations');
    await Database.run('DELETE FROM matching_programs');
    await Database.run('DELETE FROM transactions');
    await Database.run('DELETE FROM campaigns');
    jest.restoreAllMocks();
  });

  // ─── Matching Program CRUD (Service Layer) ────────────────────────────────

  describe('MatchingProgramService.create', () => {
    test('should create a matching program when valid parameters', async () => {
      const program = await MatchingProgramService.create({
        sponsor_wallet_id: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDEFGHIJKLMNOPQRS',
        match_ratio: 1.0,
        max_match_amount: 10000,
        campaign_id: null
      });

      expect(program).toBeDefined();
      expect(program.id).toBeDefined();
      expect(program.sponsor_wallet_id).toBe('GABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDEFGHIJKLMNOPQRS');
      expect(program.match_ratio).toBe(1.0);
      expect(program.max_match_amount).toBe(10000);
      expect(program.remaining_match_amount).toBe(10000);
      expect(program.status).toBe('active');
    });

    test('should create a matching program linked to a campaign', async () => {
      const { id: campaignId } = await Database.run(
        `INSERT INTO campaigns (name, goal_amount, status) VALUES ('Test Campaign', 5000, 'active')`
      );

      const program = await MatchingProgramService.create({
        sponsor_wallet_id: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDEFGHIJKLMNOPQRS',
        match_ratio: 0.5,
        max_match_amount: 2500,
        campaign_id: campaignId
      });

      expect(program.campaign_id).toBe(campaignId);
      expect(program.match_ratio).toBe(0.5);
    });

    test('should reject invalid sponsor_wallet_id', async () => {
      await expect(MatchingProgramService.create({
        sponsor_wallet_id: '',
        match_ratio: 1.0,
        max_match_amount: 1000
      })).rejects.toThrow('sponsor_wallet_id is required');
    });

    test('should reject match_ratio <= 0', async () => {
      await expect(MatchingProgramService.create({
        sponsor_wallet_id: 'GABCDEFG',
        match_ratio: 0,
        max_match_amount: 1000
      })).rejects.toThrow('match_ratio must be a number between 0');
    });

    test('should reject match_ratio > 10', async () => {
      await expect(MatchingProgramService.create({
        sponsor_wallet_id: 'GABCDEFG',
        match_ratio: 11,
        max_match_amount: 1000
      })).rejects.toThrow('match_ratio must be a number between 0');
    });

    test('should reject negative max_match_amount', async () => {
      await expect(MatchingProgramService.create({
        sponsor_wallet_id: 'GABCDEFG',
        match_ratio: 1.0,
        max_match_amount: -100
      })).rejects.toThrow('max_match_amount must be a positive number');
    });

    test('should reject non-existent campaign_id', async () => {
      await expect(MatchingProgramService.create({
        sponsor_wallet_id: 'GABCDEFG',
        match_ratio: 1.0,
        max_match_amount: 1000,
        campaign_id: 99999
      })).rejects.toThrow('Campaign not found');
    });
  });

  describe('MatchingProgramService.getById', () => {
    test('should retrieve an existing matching program', async () => {
      const created = await MatchingProgramService.create({
        sponsor_wallet_id: 'GSPONSOR1',
        match_ratio: 2.0,
        max_match_amount: 5000,
        campaign_id: null
      });

      const fetched = await MatchingProgramService.getById(created.id);
      expect(fetched.id).toBe(created.id);
      expect(fetched.match_ratio).toBe(2.0);
    });

    test('should throw NotFoundError when non-existent ID', async () => {
      await expect(MatchingProgramService.getById(99999))
        .rejects.toThrow('Matching program not found');
    });
  });

  describe('MatchingProgramService.getAll', () => {
    test('should return all matching programs', async () => {
      await MatchingProgramService.create({ sponsor_wallet_id: 'GA1', match_ratio: 1, max_match_amount: 1000 });
      await MatchingProgramService.create({ sponsor_wallet_id: 'GA2', match_ratio: 2, max_match_amount: 2000 });

      const all = await MatchingProgramService.getAll();
      expect(all.length).toBe(2);
    });

    test('should filter by status', async () => {
      await MatchingProgramService.create({ sponsor_wallet_id: 'GA1', match_ratio: 1, max_match_amount: 1000 });
      const prog2 = await MatchingProgramService.create({ sponsor_wallet_id: 'GA2', match_ratio: 1, max_match_amount: 500 });
      await MatchingProgramService.updateStatus(prog2.id, 'paused');

      const active = await MatchingProgramService.getAll({ status: 'active' });
      expect(active.length).toBe(1);

      const paused = await MatchingProgramService.getAll({ status: 'paused' });
      expect(paused.length).toBe(1);
    });
  });

  describe('MatchingProgramService.updateStatus', () => {
    test('should update program status', async () => {
      const program = await MatchingProgramService.create({
        sponsor_wallet_id: 'GSPONSOR',
        match_ratio: 1,
        max_match_amount: 1000
      });

      const updated = await MatchingProgramService.updateStatus(program.id, 'paused');
      expect(updated.status).toBe('paused');
    });

    test('should reject invalid status', async () => {
      const program = await MatchingProgramService.create({
        sponsor_wallet_id: 'GSPONSOR',
        match_ratio: 1,
        max_match_amount: 1000
      });

      await expect(MatchingProgramService.updateStatus(program.id, 'invalid'))
        .rejects.toThrow('Invalid status');
    });
  });

  // ─── Matching Donation Logic ───────────────────────────────────────────────

  describe('MatchingProgramService.processMatchingDonation', () => {
    test('should create a 1:1 matching donation when a global program', async () => {
      await MatchingProgramService.create({
        sponsor_wallet_id: 'GSPONSOR',
        match_ratio: 1.0,
        max_match_amount: 10000,
        campaign_id: null
      });

      const results = await MatchingProgramService.processMatchingDonation({
        id: 1,
        amount: 100,
        campaign_id: null
      });

      expect(results.length).toBe(1);
      expect(results[0].matched_amount).toBe(100);
      expect(results[0].sponsor_wallet_id).toBe('GSPONSOR');
    });

    test('should create a matching donation when custom ratio (0.5 = 50%)', async () => {
      await MatchingProgramService.create({
        sponsor_wallet_id: 'GSPONSOR',
        match_ratio: 0.5,
        max_match_amount: 10000,
        campaign_id: null
      });

      const results = await MatchingProgramService.processMatchingDonation({
        id: 2,
        amount: 200,
        campaign_id: null
      });

      expect(results.length).toBe(1);
      expect(results[0].matched_amount).toBe(100);
    });

    test('should create a matching donation when 2:1 ratio (double match)', async () => {
      await MatchingProgramService.create({
        sponsor_wallet_id: 'GSPONSOR',
        match_ratio: 2.0,
        max_match_amount: 10000,
        campaign_id: null
      });

      const results = await MatchingProgramService.processMatchingDonation({
        id: 3,
        amount: 50,
        campaign_id: null
      });

      expect(results.length).toBe(1);
      expect(results[0].matched_amount).toBe(100);
    });

    test('should cap matching at remaining program balance', async () => {
      await MatchingProgramService.create({
        sponsor_wallet_id: 'GSPONSOR',
        match_ratio: 1.0,
        max_match_amount: 50,
        campaign_id: null
      });

      const results = await MatchingProgramService.processMatchingDonation({
        id: 4,
        amount: 100,
        campaign_id: null
      });

      expect(results.length).toBe(1);
      expect(results[0].matched_amount).toBe(50);
    });

    test('should match donations when campaign-specific programs', async () => {
      const { id: campaignId } = await Database.run(
        `INSERT INTO campaigns (name, goal_amount, status) VALUES ('Match Campaign', 10000, 'active')`
      );

      await MatchingProgramService.create({
        sponsor_wallet_id: 'GCAMPAIGNSPONSOR',
        match_ratio: 1.0,
        max_match_amount: 5000,
        campaign_id: campaignId
      });

      const results = await MatchingProgramService.processMatchingDonation({
        id: 5,
        amount: 200,
        campaign_id: campaignId
      });

      expect(results.length).toBe(1);
      expect(results[0].matched_amount).toBe(200);
    });

    test('should not match donations when a different campaign', async () => {
      const { id: campaign1 } = await Database.run(
        `INSERT INTO campaigns (name, goal_amount, status) VALUES ('Campaign A', 1000, 'active')`
      );
      const { id: campaign2 } = await Database.run(
        `INSERT INTO campaigns (name, goal_amount, status) VALUES ('Campaign B', 1000, 'active')`
      );

      await MatchingProgramService.create({
        sponsor_wallet_id: 'GSPONSOR',
        match_ratio: 1.0,
        max_match_amount: 5000,
        campaign_id: campaign1
      });

      const results = await MatchingProgramService.processMatchingDonation({
        id: 6,
        amount: 100,
        campaign_id: campaign2
      });

      // No campaign-specific match, no global match
      expect(results.length).toBe(0);
    });

    test('should combine campaign-specific and global matching programs', async () => {
      const { id: campaignId } = await Database.run(
        `INSERT INTO campaigns (name, goal_amount, status) VALUES ('Combo Campaign', 10000, 'active')`
      );

      await MatchingProgramService.create({
        sponsor_wallet_id: 'GCAMPAIGN',
        match_ratio: 1.0,
        max_match_amount: 5000,
        campaign_id: campaignId
      });

      await MatchingProgramService.create({
        sponsor_wallet_id: 'GGLOBAL',
        match_ratio: 0.5,
        max_match_amount: 5000,
        campaign_id: null
      });

      const results = await MatchingProgramService.processMatchingDonation({
        id: 7,
        amount: 100,
        campaign_id: campaignId
      });

      expect(results.length).toBe(2);
      expect(results[0].matched_amount).toBe(100); // campaign-specific 1:1
      expect(results[1].matched_amount).toBe(50);  // global 0.5:1
    });

    test('should not match when no active programs exist', async () => {
      const results = await MatchingProgramService.processMatchingDonation({
        id: 8,
        amount: 100,
        campaign_id: null
      });

      expect(results.length).toBe(0);
    });

    test('should not match when program is paused', async () => {
      const program = await MatchingProgramService.create({
        sponsor_wallet_id: 'GSPONSOR',
        match_ratio: 1.0,
        max_match_amount: 1000,
        campaign_id: null
      });

      await MatchingProgramService.updateStatus(program.id, 'paused');

      const results = await MatchingProgramService.processMatchingDonation({
        id: 9,
        amount: 100,
        campaign_id: null
      });

      expect(results.length).toBe(0);
    });

    test('should return empty array when donation has no campaign and no global programs exist', async () => {
      // Create only a campaign-specific program
      const { id: campaignId } = await Database.run(
        `INSERT INTO campaigns (name, goal_amount, status) VALUES ('Specific', 1000, 'active')`
      );
      await MatchingProgramService.create({
        sponsor_wallet_id: 'GSPONSOR',
        match_ratio: 1.0,
        max_match_amount: 1000,
        campaign_id: campaignId
      });

      const results = await MatchingProgramService.processMatchingDonation({
        id: 10,
        amount: 100,
        campaign_id: null
      });

      expect(results.length).toBe(0);
    });
  });

  // ─── Program Exhaustion ────────────────────────────────────────────────────

  describe('Program exhaustion', () => {
    test('should mark program as exhausted when remaining reaches 0', async () => {
      jest.spyOn(WebhookService, 'deliver').mockResolvedValue(true);

      const program = await MatchingProgramService.create({
        sponsor_wallet_id: 'GSPONSOR',
        match_ratio: 1.0,
        max_match_amount: 100,
        campaign_id: null
      });

      await MatchingProgramService.processMatchingDonation({
        id: 11,
        amount: 100,
        campaign_id: null
      });

      const updated = await MatchingProgramService.getById(program.id);
      expect(updated.status).toBe('exhausted');
      expect(updated.remaining_match_amount).toBe(0);
    });

    test('should send webhook notification when program is exhausted', async () => {
      const deliverSpy = jest.spyOn(WebhookService, 'deliver').mockResolvedValue(true);

      await MatchingProgramService.create({
        sponsor_wallet_id: 'GSPONSOR',
        match_ratio: 1.0,
        max_match_amount: 50,
        campaign_id: null
      });

      await MatchingProgramService.processMatchingDonation({
        id: 12,
        amount: 50,
        campaign_id: null
      });

      expect(deliverSpy).toHaveBeenCalledWith(
        'matching_program.exhausted',
        expect.objectContaining({
          sponsor_wallet_id: 'GSPONSOR',
          max_match_amount: 50
        })
      );
    });

    test('should exhaust program over multiple donations', async () => {
      jest.spyOn(WebhookService, 'deliver').mockResolvedValue(true);

      const program = await MatchingProgramService.create({
        sponsor_wallet_id: 'GSPONSOR',
        match_ratio: 1.0,
        max_match_amount: 150,
        campaign_id: null
      });

      // First donation: 100 matched, 50 remaining
      await MatchingProgramService.processMatchingDonation({
        id: 13, amount: 100, campaign_id: null
      });
      let p = await MatchingProgramService.getById(program.id);
      expect(p.remaining_match_amount).toBe(50);
      expect(p.status).toBe('active');

      // Second donation: 50 matched, 0 remaining → exhausted
      await MatchingProgramService.processMatchingDonation({
        id: 14, amount: 100, campaign_id: null
      });
      p = await MatchingProgramService.getById(program.id);
      expect(p.remaining_match_amount).toBe(0);
      expect(p.status).toBe('exhausted');
    });

    test('should not create matching donation when program is already exhausted', async () => {
      jest.spyOn(WebhookService, 'deliver').mockResolvedValue(true);

      await MatchingProgramService.create({
        sponsor_wallet_id: 'GSPONSOR',
        match_ratio: 1.0,
        max_match_amount: 50,
        campaign_id: null
      });

      // Exhaust the program
      await MatchingProgramService.processMatchingDonation({
        id: 15, amount: 50, campaign_id: null
      });

      // Try another donation — should not match
      const results = await MatchingProgramService.processMatchingDonation({
        id: 16, amount: 100, campaign_id: null
      });

      expect(results.length).toBe(0);
    });
  });

  // ─── Utilization Tracking ─────────────────────────────────────────────────

  describe('MatchingProgramService.getUtilization', () => {
    test('should return correct utilization stats', async () => {
      const program = await MatchingProgramService.create({
        sponsor_wallet_id: 'GSPONSOR',
        match_ratio: 1.0,
        max_match_amount: 1000,
        campaign_id: null
      });

      await MatchingProgramService.processMatchingDonation({
        id: 17, amount: 300, campaign_id: null
      });

      const stats = await MatchingProgramService.getUtilization(program.id);

      expect(stats.program_id).toBe(program.id);
      expect(stats.total_matched).toBe(300);
      expect(stats.remaining).toBe(700);
      expect(stats.utilization_percentage).toBe(30);
      expect(stats.matching_donations_count).toBe(1);
      expect(stats.matching_donations.length).toBe(1);
    });

    test('should return 0 utilization when unused program', async () => {
      const program = await MatchingProgramService.create({
        sponsor_wallet_id: 'GSPONSOR',
        match_ratio: 1.0,
        max_match_amount: 1000,
        campaign_id: null
      });

      const stats = await MatchingProgramService.getUtilization(program.id);
      expect(stats.total_matched).toBe(0);
      expect(stats.utilization_percentage).toBe(0);
      expect(stats.matching_donations_count).toBe(0);
    });
  });

  // ─── Admin API Routes ─────────────────────────────────────────────────────

  describe('POST /admin/matching-programs', () => {
    test('should create a matching program via API', async () => {
      const res = await request(app)
        .post('/admin/matching-programs')
        .set('X-API-Key', 'test-admin-key')
        .send({
          sponsor_wallet_id: 'GABCDEFG',
          match_ratio: 1.0,
          max_match_amount: 5000
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.sponsor_wallet_id).toBe('GABCDEFG');
      expect(res.body.data.status).toBe('active');
    });

    test('should create a matching program when campaign_id via API', async () => {
      const { id: campaignId } = await Database.run(
        `INSERT INTO campaigns (name, goal_amount, status) VALUES ('API Test', 5000, 'active')`
      );

      const res = await request(app)
        .post('/admin/matching-programs')
        .set('X-API-Key', 'test-admin-key')
        .send({
          sponsor_wallet_id: 'GABCDEFG',
          match_ratio: 2.0,
          max_match_amount: 10000,
          campaign_id: campaignId
        });

      expect(res.status).toBe(201);
      expect(res.body.data.campaign_id).toBe(campaignId);
    });

    test('should reject creation when missing required fields', async () => {
      const res = await request(app)
        .post('/admin/matching-programs')
        .set('X-API-Key', 'test-admin-key')
        .send({
          match_ratio: 1.0
        });

      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('GET /admin/matching-programs', () => {
    test('should list all matching programs', async () => {
      await MatchingProgramService.create({ sponsor_wallet_id: 'GA1', match_ratio: 1, max_match_amount: 1000 });
      await MatchingProgramService.create({ sponsor_wallet_id: 'GA2', match_ratio: 2, max_match_amount: 2000 });

      const res = await request(app)
        .get('/admin/matching-programs')
        .set('X-API-Key', 'test-admin-key');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.count).toBe(2);
    });

    test('should filter by status query param', async () => {
      await MatchingProgramService.create({ sponsor_wallet_id: 'GA1', match_ratio: 1, max_match_amount: 1000 });
      const p2 = await MatchingProgramService.create({ sponsor_wallet_id: 'GA2', match_ratio: 1, max_match_amount: 500 });
      await MatchingProgramService.updateStatus(p2.id, 'paused');

      const res = await request(app)
        .get('/admin/matching-programs?status=active')
        .set('X-API-Key', 'test-admin-key');

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
    });
  });

  describe('GET /admin/matching-programs/:id', () => {
    test('should return a specific matching program', async () => {
      const program = await MatchingProgramService.create({
        sponsor_wallet_id: 'GSPONSOR',
        match_ratio: 1.5,
        max_match_amount: 3000
      });

      const res = await request(app)
        .get(`/admin/matching-programs/${program.id}`)
        .set('X-API-Key', 'test-admin-key');

      expect(res.status).toBe(200);
      expect(res.body.data.match_ratio).toBe(1.5);
    });

    test('should return 404 when non-existent program', async () => {
      const res = await request(app)
        .get('/admin/matching-programs/99999')
        .set('X-API-Key', 'test-admin-key');

      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('GET /admin/matching-programs/:id/utilization', () => {
    test('should return utilization stats', async () => {
      const program = await MatchingProgramService.create({
        sponsor_wallet_id: 'GSPONSOR',
        match_ratio: 1.0,
        max_match_amount: 1000
      });

      await MatchingProgramService.processMatchingDonation({
        id: 20, amount: 250, campaign_id: null
      });

      const res = await request(app)
        .get(`/admin/matching-programs/${program.id}/utilization`)
        .set('X-API-Key', 'test-admin-key');

      expect(res.status).toBe(200);
      expect(res.body.data.total_matched).toBe(250);
      expect(res.body.data.utilization_percentage).toBe(25);
    });
  });

  describe('PATCH /admin/matching-programs/:id/status', () => {
    test('should update program status via API', async () => {
      const program = await MatchingProgramService.create({
        sponsor_wallet_id: 'GSPONSOR',
        match_ratio: 1.0,
        max_match_amount: 1000
      });

      const res = await request(app)
        .patch(`/admin/matching-programs/${program.id}/status`)
        .set('X-API-Key', 'test-admin-key')
        .send({ status: 'paused' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('paused');
    });

    test('should reject invalid status via API', async () => {
      const program = await MatchingProgramService.create({
        sponsor_wallet_id: 'GSPONSOR',
        match_ratio: 1.0,
        max_match_amount: 1000
      });

      const res = await request(app)
        .patch(`/admin/matching-programs/${program.id}/status`)
        .set('X-API-Key', 'test-admin-key')
        .send({ status: 'destroyed' });

      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  // ─── Edge Cases ────────────────────────────────────────────────────────────

  describe('Edge cases', () => {
    test('should handle very small donation amounts when precision', async () => {
      await MatchingProgramService.create({
        sponsor_wallet_id: 'GSPONSOR',
        match_ratio: 1.0,
        max_match_amount: 10000,
        campaign_id: null
      });

      const results = await MatchingProgramService.processMatchingDonation({
        id: 30, amount: 0.0000001, campaign_id: null
      });

      expect(results.length).toBe(1);
      expect(results[0].matched_amount).toBe(0.0000001);
    });

    test('should handle fractional match ratios correctly', async () => {
      await MatchingProgramService.create({
        sponsor_wallet_id: 'GSPONSOR',
        match_ratio: 0.333,
        max_match_amount: 10000,
        campaign_id: null
      });

      const results = await MatchingProgramService.processMatchingDonation({
        id: 31, amount: 100, campaign_id: null
      });

      expect(results.length).toBe(1);
      expect(results[0].matched_amount).toBe(33.3);
    });

    test('should handle multiple programs matching the same donation', async () => {
      await MatchingProgramService.create({
        sponsor_wallet_id: 'GSPONSOR1',
        match_ratio: 1.0,
        max_match_amount: 10000,
        campaign_id: null
      });

      await MatchingProgramService.create({
        sponsor_wallet_id: 'GSPONSOR2',
        match_ratio: 0.5,
        max_match_amount: 10000,
        campaign_id: null
      });

      const results = await MatchingProgramService.processMatchingDonation({
        id: 32, amount: 100, campaign_id: null
      });

      expect(results.length).toBe(2);
      const totalMatch = results.reduce((sum, r) => sum + r.matched_amount, 0);
      expect(totalMatch).toBe(150); // 100 + 50
    });

    test('should correctly update remaining balance across multiple donations', async () => {
      const program = await MatchingProgramService.create({
        sponsor_wallet_id: 'GSPONSOR',
        match_ratio: 1.0,
        max_match_amount: 500,
        campaign_id: null
      });

      await MatchingProgramService.processMatchingDonation({ id: 33, amount: 100, campaign_id: null });
      await MatchingProgramService.processMatchingDonation({ id: 34, amount: 150, campaign_id: null });
      await MatchingProgramService.processMatchingDonation({ id: 35, amount: 200, campaign_id: null });

      const updated = await MatchingProgramService.getById(program.id);
      expect(updated.remaining_match_amount).toBe(50); // 500 - 100 - 150 - 200
    });

    test('should handle donation when 0 campaign_id gracefully', async () => {
      await MatchingProgramService.create({
        sponsor_wallet_id: 'GSPONSOR',
        match_ratio: 1.0,
        max_match_amount: 1000,
        campaign_id: null
      });

      const results = await MatchingProgramService.processMatchingDonation({
        id: 36, amount: 50, campaign_id: null
      });

      expect(results.length).toBe(1);
    });

    test('should not match when webhook delivery fails (non-blocking)', async () => {
      jest.spyOn(WebhookService, 'deliver').mockRejectedValue(new Error('Webhook failed'));

      await MatchingProgramService.create({
        sponsor_wallet_id: 'GSPONSOR',
        match_ratio: 1.0,
        max_match_amount: 50,
        campaign_id: null
      });

      // Should not throw even if webhook fails
      const results = await MatchingProgramService.processMatchingDonation({
        id: 37, amount: 50, campaign_id: null
      });

      expect(results.length).toBe(1);
    });
  });
});
