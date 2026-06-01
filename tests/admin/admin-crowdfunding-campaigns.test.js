'use strict';

/**
 * Tests: Admin Crowdfunding Campaign Management Endpoints
 *
 * Covers:
 *   GET    /admin/crowdfunding/campaigns              — list all campaigns
 *   POST   /admin/crowdfunding/campaigns              — create campaign with milestones
 *   PATCH  /admin/crowdfunding/campaigns/:id          — update campaign details
 *   POST   /admin/crowdfunding/campaigns/:id/close    — close + trigger milestone payouts
 *   GET    /admin/crowdfunding/campaigns/:id/milestones — list milestones with reached status
 *
 * Auth: admin role required; 401 without key, 403 with non-admin key.
 */

const request = require('supertest');
const crypto = require('crypto');

describe('Admin Crowdfunding Campaign Management', () => {
  let app;
  let Database;
  let adminKey;
  let userKey;

  beforeAll(async () => {
    jest.resetModules();
    process.env.ENCRYPTION_KEY = 'test-encryption-key-32-bytes-long!';
    process.env.MOCK_STELLAR = 'true';
    process.env.NODE_ENV = 'test';

    app = require('../../src/routes/app');
    Database = require('../../src/utils/database');

    // Ensure campaign_milestones table exists (may not be migrated in test DB)
    await Database.run(`
      CREATE TABLE IF NOT EXISTS campaign_milestones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        target_amount REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        verified_at DATETIME,
        verified_by TEXT,
        fund_release_tx TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Ensure campaigns table has recipient_public_key column (may not exist in older schema)
    try {
      await Database.run('ALTER TABLE campaigns ADD COLUMN recipient_public_key TEXT');
    } catch (_) { /* column already exists */ }

    // Clean up any leftover test keys
    await Database.run(
      "DELETE FROM api_keys WHERE name IN ('admin-cf-test', 'user-cf-test')"
    );

    // Create admin key
    await Database.run(
      `INSERT INTO api_keys (name, key_hash, role, is_active, created_at)
       VALUES (?, ?, ?, 1, datetime('now'))`,
      ['admin-cf-test', crypto.createHash('sha256').update('admin-key-cf').digest('hex'), 'admin']
    );
    adminKey = 'admin-key-cf';

    // Create non-admin (user) key
    await Database.run(
      `INSERT INTO api_keys (name, key_hash, role, is_active, created_at)
       VALUES (?, ?, ?, 1, datetime('now'))`,
      ['user-cf-test', crypto.createHash('sha256').update('user-key-cf').digest('hex'), 'user']
    );
    userKey = 'user-key-cf';
  });

  afterAll(async () => {
    await Database.run(
      "DELETE FROM api_keys WHERE name IN ('admin-cf-test', 'user-cf-test')"
    );
  });

  // ─── Auth enforcement ──────────────────────────────────────────────────────

  describe('Authentication and authorization', () => {
    it('returns 401 when no API key is provided', async () => {
      const res = await request(app)
        .get('/admin/crowdfunding/campaigns')
        .expect(401);
      expect(res.body).toHaveProperty('success', false);
    });

    it('returns 403 when a non-admin key is used', async () => {
      const res = await request(app)
        .get('/admin/crowdfunding/campaigns')
        .set('X-API-Key', userKey)
        .expect(403);
      expect(res.body).toHaveProperty('success', false);
    });

    it('allows admin access to list endpoint', async () => {
      const res = await request(app)
        .get('/admin/crowdfunding/campaigns')
        .set('X-API-Key', adminKey)
        .expect(200);
      expect(res.body).toHaveProperty('success', true);
    });
  });

  // ─── GET /admin/crowdfunding/campaigns ────────────────────────────────────

  describe('GET /admin/crowdfunding/campaigns', () => {
    it('returns a list with success and count fields', async () => {
      const res = await request(app)
        .get('/admin/crowdfunding/campaigns')
        .set('X-API-Key', adminKey)
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('count');
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('each campaign includes progressPercent and milestones summary', async () => {
      // Create a campaign to ensure at least one exists
      await request(app)
        .post('/admin/crowdfunding/campaigns')
        .set('X-API-Key', adminKey)
        .send({
          name: 'Progress Test Campaign',
          goal: 1000,
          deadline: new Date(Date.now() + 86400000 * 30).toISOString(),
          recipientPublicKey: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
        })
        .expect(201);

      const res = await request(app)
        .get('/admin/crowdfunding/campaigns')
        .set('X-API-Key', adminKey)
        .expect(200);

      const campaign = res.body.data.find(c => c.name === 'Progress Test Campaign');
      expect(campaign).toBeDefined();
      expect(campaign).toHaveProperty('progressPercent');
      expect(campaign).toHaveProperty('milestones');
      expect(campaign.milestones).toHaveProperty('total');
      expect(campaign.milestones).toHaveProperty('reached');
    });

    it('supports status=active filter', async () => {
      const res = await request(app)
        .get('/admin/crowdfunding/campaigns?status=active')
        .set('X-API-Key', adminKey)
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
      // All returned campaigns should not be closed
      for (const c of res.body.data) {
        expect(['closed', 'expired', 'released', 'refunded']).not.toContain(c.status);
      }
    });
  });

  // ─── POST /admin/crowdfunding/campaigns ───────────────────────────────────

  describe('POST /admin/crowdfunding/campaigns', () => {
    it('creates a campaign without milestones', async () => {
      const res = await request(app)
        .post('/admin/crowdfunding/campaigns')
        .set('X-API-Key', adminKey)
        .send({
          name: 'Simple Campaign',
          description: 'No milestones',
          goal: 500,
          deadline: new Date(Date.now() + 86400000 * 14).toISOString(),
          recipientPublicKey: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
        })
        .expect(201);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data.name).toBe('Simple Campaign');
      expect(res.body.data.goal_amount).toBe(500);
      expect(res.body.data.status).toBe('active');
      expect(Array.isArray(res.body.data.milestones)).toBe(true);
      expect(res.body.data.milestones).toHaveLength(0);
    });

    it('creates a campaign with milestones', async () => {
      const res = await request(app)
        .post('/admin/crowdfunding/campaigns')
        .set('X-API-Key', adminKey)
        .send({
          name: 'Milestone Campaign',
          goal: 1000,
          deadline: new Date(Date.now() + 86400000 * 30).toISOString(),
          recipientPublicKey: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
          milestones: [
            { amount: 250, description: 'Phase 1 - Initial setup' },
            { amount: 500, description: 'Phase 2 - Development' },
            { amount: 1000, description: 'Phase 3 - Launch' },
          ],
        })
        .expect(201);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data.milestones).toHaveLength(3);
      expect(res.body.data.milestones[0].target_amount).toBe(250);
      expect(res.body.data.milestones[1].target_amount).toBe(500);
      expect(res.body.data.milestones[2].target_amount).toBe(1000);
      // All milestones start as pending
      for (const m of res.body.data.milestones) {
        expect(m.status).toBe('pending');
      }
    });

    it('returns 400 when name is missing', async () => {
      const res = await request(app)
        .post('/admin/crowdfunding/campaigns')
        .set('X-API-Key', adminKey)
        .send({
          goal: 500,
          deadline: new Date(Date.now() + 86400000).toISOString(),
          recipientPublicKey: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
        })
        .expect(400);

      expect(res.body).toHaveProperty('success', false);
    });

    it('returns 400 when goal is missing', async () => {
      const res = await request(app)
        .post('/admin/crowdfunding/campaigns')
        .set('X-API-Key', adminKey)
        .send({
          name: 'Bad Campaign',
          deadline: new Date(Date.now() + 86400000).toISOString(),
          recipientPublicKey: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
        })
        .expect(400);

      expect(res.body).toHaveProperty('success', false);
    });

    it('returns 400 when deadline is missing', async () => {
      const res = await request(app)
        .post('/admin/crowdfunding/campaigns')
        .set('X-API-Key', adminKey)
        .send({
          name: 'Bad Campaign',
          goal: 500,
          recipientPublicKey: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
        })
        .expect(400);

      expect(res.body).toHaveProperty('success', false);
    });

    it('returns 400 when recipientPublicKey is missing', async () => {
      const res = await request(app)
        .post('/admin/crowdfunding/campaigns')
        .set('X-API-Key', adminKey)
        .send({
          name: 'Bad Campaign',
          goal: 500,
          deadline: new Date(Date.now() + 86400000).toISOString(),
        })
        .expect(400);

      expect(res.body).toHaveProperty('success', false);
    });

    it('returns 403 for non-admin key', async () => {
      const res = await request(app)
        .post('/admin/crowdfunding/campaigns')
        .set('X-API-Key', userKey)
        .send({
          name: 'Unauthorized Campaign',
          goal: 500,
          deadline: new Date(Date.now() + 86400000).toISOString(),
          recipientPublicKey: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
        })
        .expect(403);

      expect(res.body).toHaveProperty('success', false);
    });
  });

  // ─── PATCH /admin/crowdfunding/campaigns/:id ──────────────────────────────

  describe('PATCH /admin/crowdfunding/campaigns/:id', () => {
    let campaignId;

    beforeEach(async () => {
      const res = await request(app)
        .post('/admin/crowdfunding/campaigns')
        .set('X-API-Key', adminKey)
        .send({
          name: 'Updatable Campaign',
          goal: 800,
          deadline: new Date(Date.now() + 86400000 * 7).toISOString(),
          recipientPublicKey: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
        });
      campaignId = res.body.data.id;
    });

    it('updates the campaign name', async () => {
      const res = await request(app)
        .patch(`/admin/crowdfunding/campaigns/${campaignId}`)
        .set('X-API-Key', adminKey)
        .send({ name: 'Renamed Campaign' })
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data.name).toBe('Renamed Campaign');
    });

    it('updates the campaign description', async () => {
      const res = await request(app)
        .patch(`/admin/crowdfunding/campaigns/${campaignId}`)
        .set('X-API-Key', adminKey)
        .send({ description: 'Updated description' })
        .expect(200);

      expect(res.body.data.description).toBe('Updated description');
    });

    it('extends the deadline', async () => {
      const newDeadline = new Date(Date.now() + 86400000 * 60).toISOString();
      const res = await request(app)
        .patch(`/admin/crowdfunding/campaigns/${campaignId}`)
        .set('X-API-Key', adminKey)
        .send({ deadline: newDeadline })
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data.end_date).toBeTruthy();
    });

    it('adjusts the goal', async () => {
      const res = await request(app)
        .patch(`/admin/crowdfunding/campaigns/${campaignId}`)
        .set('X-API-Key', adminKey)
        .send({ goal: 1200 })
        .expect(200);

      expect(res.body.data.goal_amount).toBe(1200);
    });

    it('returns 404 for a non-existent campaign', async () => {
      const res = await request(app)
        .patch('/admin/crowdfunding/campaigns/999999')
        .set('X-API-Key', adminKey)
        .send({ name: 'Ghost' })
        .expect(404);

      expect(res.body).toHaveProperty('success', false);
    });

    it('returns 400 when no updatable fields are provided', async () => {
      const res = await request(app)
        .patch(`/admin/crowdfunding/campaigns/${campaignId}`)
        .set('X-API-Key', adminKey)
        .send({})
        .expect(400);

      expect(res.body).toHaveProperty('success', false);
    });

    it('returns 400 when trying to update a closed campaign', async () => {
      // Close the campaign first
      await request(app)
        .post(`/admin/crowdfunding/campaigns/${campaignId}/close`)
        .set('X-API-Key', adminKey)
        .expect(200);

      const res = await request(app)
        .patch(`/admin/crowdfunding/campaigns/${campaignId}`)
        .set('X-API-Key', adminKey)
        .send({ name: 'Should Fail' })
        .expect(400);

      expect(res.body).toHaveProperty('success', false);
    });

    it('returns 403 for non-admin key', async () => {
      const res = await request(app)
        .patch(`/admin/crowdfunding/campaigns/${campaignId}`)
        .set('X-API-Key', userKey)
        .send({ name: 'Unauthorized' })
        .expect(403);

      expect(res.body).toHaveProperty('success', false);
    });
  });

  // ─── POST /admin/crowdfunding/campaigns/:id/close ─────────────────────────

  describe('POST /admin/crowdfunding/campaigns/:id/close', () => {
    it('closes a campaign with no milestones', async () => {
      const createRes = await request(app)
        .post('/admin/crowdfunding/campaigns')
        .set('X-API-Key', adminKey)
        .send({
          name: 'Close No Milestones',
          goal: 500,
          deadline: new Date(Date.now() + 86400000).toISOString(),
          recipientPublicKey: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
        });
      const id = createRes.body.data.id;

      const res = await request(app)
        .post(`/admin/crowdfunding/campaigns/${id}/close`)
        .set('X-API-Key', adminKey)
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data.campaign.status).toBe('closed');
      expect(res.body.data.milestonesTriggered).toBe(0);
      expect(res.body.data.payouts).toHaveLength(0);
    });

    it('triggers milestone payouts for reached milestones on close', async () => {
      // Create campaign with current_amount already at 600 (milestones at 250 and 500 are reached)
      const createRes = await request(app)
        .post('/admin/crowdfunding/campaigns')
        .set('X-API-Key', adminKey)
        .send({
          name: 'Close With Milestones',
          goal: 1000,
          deadline: new Date(Date.now() + 86400000 * 30).toISOString(),
          recipientPublicKey: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
          milestones: [
            { amount: 250, description: 'Phase 1' },
            { amount: 500, description: 'Phase 2' },
            { amount: 1000, description: 'Phase 3 - not reached' },
          ],
        });
      const id = createRes.body.data.id;

      // Simulate donations bringing current_amount to 600
      await Database.run('UPDATE campaigns SET current_amount = 600 WHERE id = ?', [id]);

      const res = await request(app)
        .post(`/admin/crowdfunding/campaigns/${id}/close`)
        .set('X-API-Key', adminKey)
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data.campaign.status).toBe('closed');
      // Milestones at 250 and 500 are reached; 1000 is not
      expect(res.body.data.milestonesTriggered).toBe(2);
      expect(res.body.data.payouts).toHaveLength(2);

      // Each payout should have a fund release tx
      for (const payout of res.body.data.payouts) {
        expect(payout.fundReleaseTx).toMatch(/^mock_release_/);
        expect(payout.status).toBe('verified');
      }
    });

    it('does not re-trigger already verified milestones on close', async () => {
      const createRes = await request(app)
        .post('/admin/crowdfunding/campaigns')
        .set('X-API-Key', adminKey)
        .send({
          name: 'Close Already Verified',
          goal: 1000,
          deadline: new Date(Date.now() + 86400000 * 30).toISOString(),
          recipientPublicKey: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
          milestones: [
            { amount: 250, description: 'Phase 1' },
          ],
        });
      const id = createRes.body.data.id;
      const milestoneId = createRes.body.data.milestones[0].id;

      // Pre-verify the milestone
      await Database.run(
        "UPDATE campaign_milestones SET status = 'verified', verified_at = CURRENT_TIMESTAMP WHERE id = ?",
        [milestoneId]
      );
      await Database.run('UPDATE campaigns SET current_amount = 300 WHERE id = ?', [id]);

      const res = await request(app)
        .post(`/admin/crowdfunding/campaigns/${id}/close`)
        .set('X-API-Key', adminKey)
        .expect(200);

      // Already verified milestone should not be re-triggered
      expect(res.body.data.milestonesTriggered).toBe(0);
    });

    it('is idempotent — closing an already-closed campaign returns success', async () => {
      const createRes = await request(app)
        .post('/admin/crowdfunding/campaigns')
        .set('X-API-Key', adminKey)
        .send({
          name: 'Idempotent Close',
          goal: 500,
          deadline: new Date(Date.now() + 86400000).toISOString(),
          recipientPublicKey: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
        });
      const id = createRes.body.data.id;

      await request(app)
        .post(`/admin/crowdfunding/campaigns/${id}/close`)
        .set('X-API-Key', adminKey)
        .expect(200);

      // Second close should also succeed
      const res = await request(app)
        .post(`/admin/crowdfunding/campaigns/${id}/close`)
        .set('X-API-Key', adminKey)
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data.campaign.status).toBe('closed');
    });

    it('returns 404 for a non-existent campaign', async () => {
      const res = await request(app)
        .post('/admin/crowdfunding/campaigns/999999/close')
        .set('X-API-Key', adminKey)
        .expect(404);

      expect(res.body).toHaveProperty('success', false);
    });

    it('returns 403 for non-admin key', async () => {
      const createRes = await request(app)
        .post('/admin/crowdfunding/campaigns')
        .set('X-API-Key', adminKey)
        .send({
          name: 'Auth Close Test',
          goal: 500,
          deadline: new Date(Date.now() + 86400000).toISOString(),
          recipientPublicKey: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
        });
      const id = createRes.body.data.id;

      const res = await request(app)
        .post(`/admin/crowdfunding/campaigns/${id}/close`)
        .set('X-API-Key', userKey)
        .expect(403);

      expect(res.body).toHaveProperty('success', false);
    });
  });

  // ─── GET /admin/crowdfunding/campaigns/:id/milestones ─────────────────────

  describe('GET /admin/crowdfunding/campaigns/:id/milestones', () => {
    it('returns milestones with reached/unreached status', async () => {
      const createRes = await request(app)
        .post('/admin/crowdfunding/campaigns')
        .set('X-API-Key', adminKey)
        .send({
          name: 'Milestone Status Campaign',
          goal: 1000,
          deadline: new Date(Date.now() + 86400000 * 30).toISOString(),
          recipientPublicKey: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
          milestones: [
            { amount: 250, description: 'Phase 1' },
            { amount: 500, description: 'Phase 2' },
            { amount: 1000, description: 'Phase 3' },
          ],
        });
      const id = createRes.body.data.id;

      // Set current_amount to 400 — Phase 1 (250) reached, Phase 2 (500) not yet
      await Database.run('UPDATE campaigns SET current_amount = 400 WHERE id = ?', [id]);

      const res = await request(app)
        .get(`/admin/crowdfunding/campaigns/${id}/milestones`)
        .set('X-API-Key', adminKey)
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('count', 3);
      expect(Array.isArray(res.body.data)).toBe(true);

      const [m1, m2, m3] = res.body.data;
      expect(m1.target_amount).toBe(250);
      expect(m1.reached).toBe(true);

      expect(m2.target_amount).toBe(500);
      expect(m2.reached).toBe(false);

      expect(m3.target_amount).toBe(1000);
      expect(m3.reached).toBe(false);
    });

    it('returns campaign info alongside milestones', async () => {
      const createRes = await request(app)
        .post('/admin/crowdfunding/campaigns')
        .set('X-API-Key', adminKey)
        .send({
          name: 'Campaign Info Test',
          goal: 500,
          deadline: new Date(Date.now() + 86400000 * 7).toISOString(),
          recipientPublicKey: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
          milestones: [{ amount: 250, description: 'Half way' }],
        });
      const id = createRes.body.data.id;

      const res = await request(app)
        .get(`/admin/crowdfunding/campaigns/${id}/milestones`)
        .set('X-API-Key', adminKey)
        .expect(200);

      expect(res.body).toHaveProperty('campaign');
      expect(res.body.campaign.id).toBe(id);
    });

    it('returns empty milestones list for a campaign with no milestones', async () => {
      const createRes = await request(app)
        .post('/admin/crowdfunding/campaigns')
        .set('X-API-Key', adminKey)
        .send({
          name: 'No Milestones Campaign',
          goal: 500,
          deadline: new Date(Date.now() + 86400000).toISOString(),
          recipientPublicKey: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
        });
      const id = createRes.body.data.id;

      const res = await request(app)
        .get(`/admin/crowdfunding/campaigns/${id}/milestones`)
        .set('X-API-Key', adminKey)
        .expect(200);

      expect(res.body.count).toBe(0);
      expect(res.body.data).toHaveLength(0);
    });

    it('returns 404 for a non-existent campaign', async () => {
      const res = await request(app)
        .get('/admin/crowdfunding/campaigns/999999/milestones')
        .set('X-API-Key', adminKey)
        .expect(404);

      expect(res.body).toHaveProperty('success', false);
    });

    it('returns 403 for non-admin key', async () => {
      const createRes = await request(app)
        .post('/admin/crowdfunding/campaigns')
        .set('X-API-Key', adminKey)
        .send({
          name: 'Auth Milestone Test',
          goal: 500,
          deadline: new Date(Date.now() + 86400000).toISOString(),
          recipientPublicKey: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
        });
      const id = createRes.body.data.id;

      const res = await request(app)
        .get(`/admin/crowdfunding/campaigns/${id}/milestones`)
        .set('X-API-Key', userKey)
        .expect(403);

      expect(res.body).toHaveProperty('success', false);
    });
  });
});
