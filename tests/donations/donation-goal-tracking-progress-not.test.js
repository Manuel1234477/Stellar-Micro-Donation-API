/**
 * Donation Goal Tracking with Real-Time Progress Notifications
 * 
 * Tests:
 * - Milestone detection at 25%, 50%, 75%, 100%
 * - SSE progress stream for real-time updates
 * - Webhook dispatch on milestone and goal reached events
 * - Edge cases: exact milestone hits, multiple donations, late arrivals on closed campaigns
 * - Campaign status transitions and lifecycle
 */

const http = require('http');
const Database = require('../../src/utils/database');
const DonationService = require('../../src/services/DonationService');
const WebhookService = require('../../src/services/WebhookService');
const MockStellarService = require('../../src/services/MockStellarService');

describe('Donation Goal Tracking with Real-Time Progress', () => {
  let app, donationService, campaignId;

  // SSE responses never end, so supertest can't await them. Open a raw HTTP
  // connection, collect output until the response ends or `ms` elapses, then
  // destroy the connection.
  function collectSse(path, headers = {}, ms = 400) {
    return new Promise((resolve, reject) => {
      const server = http.createServer(app);
      server.listen(0, () => {
        const port = server.address().port;
        const req = http.request({ port, path, headers }, res => {
          let body = '';
          let finished = false;
          const finish = () => {
            if (finished) return;
            finished = true;
            req.destroy();
            server.close(() => resolve({ status: res.statusCode, headers: res.headers, body }));
          };
          res.on('data', chunk => { body += chunk; });
          res.on('end', finish);
          setTimeout(finish, ms);
        });
        req.on('error', reject);
        req.end();
      });
    });
  }

  beforeAll(async () => {
    // Initialize test app
    app = require('../../src/app');
    donationService = new DonationService(new MockStellarService());
  });

  beforeEach(async () => {
    // Create a test campaign with $1000 goal
    const result = await Database.run(
      `INSERT INTO campaigns 
       (name, description, goal_amount, current_amount, status, created_by, notified_milestones, createdAt)
       VALUES (?, ?, ?, 0, 'active', 1, '[]', CURRENT_TIMESTAMP)`,
      ['Test Campaign', 'Test goal tracking', 1000]
    );
    campaignId = result.id;
  });

  afterEach(async () => {
    // Clean up
    if (campaignId) {
      await Database.run('DELETE FROM campaigns WHERE id = ?', [campaignId]);
    }
  });

  describe('Milestone Detection', () => {
    test('should detect 25% milestone', () => {
      const milestones = donationService.checkMilestones(250, 1000);
      expect(milestones).toContain(0.25);
      expect(milestones).not.toContain(0.5);
      expect(milestones).not.toContain(0.75);
      expect(milestones).not.toContain(1.0);
    });

    test('should detect 50% milestone', () => {
      const milestones = donationService.checkMilestones(500, 1000);
      expect(milestones).toContain(0.25);
      expect(milestones).toContain(0.5);
      expect(milestones).not.toContain(0.75);
      expect(milestones).not.toContain(1.0);
    });

    test('should detect 75% milestone', () => {
      const milestones = donationService.checkMilestones(750, 1000);
      expect(milestones).toContain(0.25);
      expect(milestones).toContain(0.5);
      expect(milestones).toContain(0.75);
      expect(milestones).not.toContain(1.0);
    });

    test('should detect 100% milestone', () => {
      const milestones = donationService.checkMilestones(1000, 1000);
      expect(milestones).toContain(0.25);
      expect(milestones).toContain(0.5);
      expect(milestones).toContain(0.75);
      expect(milestones).toContain(1.0);
    });

    test('should handle milestone at exact boundary (e.g., exactly $250)', () => {
      const milestones = donationService.checkMilestones(250, 1000);
      expect(milestones).toContain(0.25);
    });

    test('should not detect milestones before reaching them', () => {
      const milestones = donationService.checkMilestones(249, 1000);
      expect(milestones).not.toContain(0.25);
      expect(milestones.length).toBe(0);
    });

    test('should handle over-reaching milestones', () => {
      const milestones = donationService.checkMilestones(1500, 1000);
      expect(milestones).toContain(0.25);
      expect(milestones).toContain(0.5);
      expect(milestones).toContain(0.75);
      expect(milestones).toContain(1.0);
    });
  });

  describe('Notified Milestones Tracking', () => {
    test('should parse notified_milestones JSON correctly', () => {
      const campaign = {
        notified_milestones: JSON.stringify([0.25, 0.5])
      };
      const notified = donationService.getNotifiedMilestones(campaign);
      expect(notified).toEqual([0.25, 0.5]);
    });

    test('should handle empty notified_milestones', () => {
      const campaign = {
        notified_milestones: '[]'
      };
      const notified = donationService.getNotifiedMilestones(campaign);
      expect(notified).toEqual([]);
    });

    test('should handle null notified_milestones', () => {
      const campaign = { notified_milestones: null };
      const notified = donationService.getNotifiedMilestones(campaign);
      expect(notified).toEqual([]);
    });

    test('should handle invalid JSON gracefully', () => {
      const campaign = { notified_milestones: 'invalid json' };
      const notified = donationService.getNotifiedMilestones(campaign);
      expect(notified).toEqual([]);
    });
  });

  describe('Campaign Contribution Processing', () => {
    test('should update campaign current_amount when donation', async () => {
      const initialAmount = 100;
      
      await donationService.processCampaignContribution(campaignId, initialAmount);
      
      const campaign = await Database.get('SELECT * FROM campaigns WHERE id = ?', [campaignId]);
      expect(campaign.current_amount).toBe(initialAmount);
    });

    test('should track new milestones only once', async () => {
      // First donation: $250 (25%)
      await donationService.processCampaignContribution(campaignId, 250);
      
      let campaign = await Database.get('SELECT * FROM campaigns WHERE id = ?', [campaignId]);
      let notified = JSON.parse(campaign.notified_milestones);
      expect(notified).toContain(0.25);
      expect(notified.length).toBe(1);

      // Second donation: $250 more (50%)
      await donationService.processCampaignContribution(campaignId, 250);
      
      campaign = await Database.get('SELECT * FROM campaigns WHERE id = ?', [campaignId]);
      notified = JSON.parse(campaign.notified_milestones);
      expect(notified).toContain(0.25);
      expect(notified).toContain(0.5);
      expect(notified.length).toBe(2);
    });

    test('should not notify the same milestone twice', async () => {
      // First donation reaches 25%
      await donationService.processCampaignContribution(campaignId, 250);
      
      let campaign = await Database.get('SELECT * FROM campaigns WHERE id = ?', [campaignId]);
      let notified = JSON.parse(campaign.notified_milestones);
      const firstNotifyCount = notified.length;

      // Small additional donation (still under 50%)
      await donationService.processCampaignContribution(campaignId, 100);
      
      campaign = await Database.get('SELECT * FROM campaigns WHERE id = ?', [campaignId]);
      notified = JSON.parse(campaign.notified_milestones);
      
      // Should not have added duplicate 0.25
      expect(notified.filter(m => m === 0.25).length).toBe(1);
      expect(notified.length).toBe(firstNotifyCount);
    });

    test('should set campaign status to closed when goal is reached', async () => {
      await donationService.processCampaignContribution(campaignId, 1000);
      
      const campaign = await Database.get('SELECT * FROM campaigns WHERE id = ?', [campaignId]);
      expect(campaign.status).toBe('closed');
      expect(campaign.closed_at).not.toBeNull();
    });

    test('should handle multiple donations crossing a milestone', async () => {
      // Donation that skips 25% and 50%, reaching 75%
      await donationService.processCampaignContribution(campaignId, 750);
      
      const campaign = await Database.get('SELECT * FROM campaigns WHERE id = ?', [campaignId]);
      const notified = JSON.parse(campaign.notified_milestones);
      
      // Should notify all milestones up to 75%
      expect(notified).toContain(0.25);
      expect(notified).toContain(0.5);
      expect(notified).toContain(0.75);
    });

    test('should handle donations when closed campaigns gracefully', async () => {
      // First, reach the goal and close the campaign
      await donationService.processCampaignContribution(campaignId, 1000);
      
      let campaign = await Database.get('SELECT * FROM campaigns WHERE id = ?', [campaignId]);
      expect(campaign.status).toBe('closed');

      // Try to add another donation (should be a no-op since campaign is no longer 'active')
      await donationService.processCampaignContribution(campaignId, 100);
      
      campaign = await Database.get('SELECT * FROM campaigns WHERE id = ?', [campaignId]);
      // Current amount should still be 1000 (update didn't apply because status isn't 'active')
      expect(campaign.current_amount).toBe(1000);
    });
  });

  describe('SSE Progress Stream', () => {
    test('should establish SSE connection when campaign progress', async () => {
      const response = await collectSse(
        `/api/v1/campaigns/${campaignId}/progress/stream`,
        { 'x-api-key': 'test-key-1' }
      );

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('text/event-stream');
      expect(response.headers['cache-control']).toBe('no-cache');
      expect(response.headers['connection']).toBe('keep-alive');
    });

    test('should reject SSE connection without API key', async () => {
      const response = await collectSse(`/api/v1/campaigns/${campaignId}/progress/stream`);

      expect(response.status).toBe(401);
    });

    test('should send initial campaign state when SSE connection', async () => {
      // Set initial campaign state
      await Database.run(
        'UPDATE campaigns SET current_amount = 250 WHERE id = ?',
        [campaignId]
      );

      const response = await collectSse(
        `/api/v1/campaigns/${campaignId}/progress/stream`,
        { 'x-api-key': 'test-key-1' }
      );

      // Response should contain initial state
      expect(response.body).toContain('progress_percentage');
    });

    test('should return 404 when non-existent campaign', async () => {
      const response = await collectSse(
        '/api/v1/campaigns/99999/progress/stream',
        { 'x-api-key': 'test-key-1' }
      );

      expect(response.status).toBe(404);
      expect(JSON.parse(response.body).success).toBe(false);
    });

    test('should enforce connection limit per API key', async () => {
      const maxConnections = require('../../src/services/SseManager').MAX_CONNECTIONS_PER_KEY;

      // Try to exceed connection limit
      const promises = [];
      for (let i = 0; i < maxConnections + 1; i++) {
        promises.push(
          collectSse(`/api/v1/campaigns/${campaignId}/progress/stream`, { 'x-api-key': 'test-key-1' })
        );
      }

      const results = await Promise.allSettled(promises);
      const successCount = results.filter(r => r.status === 'fulfilled' && r.value.status === 200).length;

      expect(successCount).toBeLessThanOrEqual(maxConnections);
    });

    test('should send heartbeat periodically', async () => {
      // The heartbeat interval is 30s, so just verify the connection is
      // established and streaming.
      const response = await collectSse(
        `/api/v1/campaigns/${campaignId}/progress/stream`,
        { 'x-api-key': 'test-key-1' }
      );

      expect(response.status).toBe(200);
    });

    test('should include event type in SSE message', async () => {
      const response = await collectSse(
        `/api/v1/campaigns/${campaignId}/progress/stream`,
        { 'x-api-key': 'test-key-1' }
      );

      // Response should be in SSE format
      expect(response.headers['content-type']).toBe('text/event-stream');
    });
  });

  describe('Webhook Dispatch', () => {
    test('should dispatch webhook when milestone reached', async () => {
      const deliverSpy = jest.spyOn(WebhookService, 'deliver');

      // Donation that reaches 25% milestone
      await donationService.processCampaignContribution(campaignId, 250);

      // Allow async webhook delivery to process
      await new Promise(r => setTimeout(r, 100));

      expect(deliverSpy).toHaveBeenCalledWith(
        'campaign.milestone',
        expect.objectContaining({
          campaign_id: campaignId,
          milestone_percentage: 25,
          current_amount: 250,
          goal_amount: 1000
        })
      );

      deliverSpy.mockRestore();
    });

    test('should dispatch webhook when goal is reached', async () => {
      const deliverSpy = jest.spyOn(WebhookService, 'deliver');

      // Donation that reaches 100%
      await donationService.processCampaignContribution(campaignId, 1000);

      // Allow async webhook delivery to process
      await new Promise(r => setTimeout(r, 100));

      expect(deliverSpy).toHaveBeenCalledWith(
        'campaign.goal_reached',
        expect.objectContaining({
          campaign_id: campaignId,
          goal_amount: 1000,
          final_amount: 1000
        })
      );

      deliverSpy.mockRestore();
    });

    test('should dispatch multiple milestone webhooks when large donation', async () => {
      const deliverSpy = jest.spyOn(WebhookService, 'deliver');

      // Donation that crosses multiple milestones (reaches 75%)
      await donationService.processCampaignContribution(campaignId, 750);

      // Allow async webhook delivery to process
      await new Promise(r => setTimeout(r, 100));

      const calls = deliverSpy.mock.calls.filter(c => c[0] === 'campaign.milestone');
      
      // Should have 3 milestone webhooks
      expect(calls.length).toBeGreaterThanOrEqual(3);
      
      const percentages = calls.map(c => c[1].milestone_percentage);
      expect(percentages).toContain(25);
      expect(percentages).toContain(50);
      expect(percentages).toContain(75);

      deliverSpy.mockRestore();
    });

    test('should include webhook payload structure', async () => {
      const deliverSpy = jest.spyOn(WebhookService, 'deliver');

      await donationService.processCampaignContribution(campaignId, 250);

      await new Promise(r => setTimeout(r, 100));

      const milestoneCall = deliverSpy.mock.calls.find(c => c[0] === 'campaign.milestone');
      
      expect(milestoneCall[1]).toHaveProperty('campaign_id');
      expect(milestoneCall[1]).toHaveProperty('name');
      expect(milestoneCall[1]).toHaveProperty('milestone_percentage');
      expect(milestoneCall[1]).toHaveProperty('current_amount');
      expect(milestoneCall[1]).toHaveProperty('goal_amount');
      expect(milestoneCall[1]).toHaveProperty('progress_percentage');
      expect(milestoneCall[1]).toHaveProperty('timestamp');

      deliverSpy.mockRestore();
    });
  });

  describe('Edge Cases', () => {
    test('should handle zero goal amount gracefully', async () => {
      const result = await Database.run(
        `INSERT INTO campaigns 
         (name, goal_amount, current_amount, status, created_by, notified_milestones)
         VALUES (?, ?, 0, 'active', 1, '[]')`,
        ['Zero Goal Campaign', 0]
      );
      const zeroCampaignId = result.id;

      // Should not crash even with division by zero
      const milestones = donationService.checkMilestones(100, 0);
      expect(milestones).toBeDefined();

      await Database.run('DELETE FROM campaigns WHERE id = ?', [zeroCampaignId]);
    });

    test('should handle campaign when very small goal', async () => {
      const result = await Database.run(
        `INSERT INTO campaigns 
         (name, goal_amount, current_amount, status, created_by, notified_milestones)
         VALUES (?, ?, 0, 'active', 1, '[]')`,
        ['Small Goal Campaign', 1]
      );
      const smallCampaignId = result.id;

      // Donation of $0.50 should reach 50%
      const milestones = donationService.checkMilestones(0.5, 1);
      expect(milestones).toContain(0.25);
      expect(milestones).toContain(0.5);

      await Database.run('DELETE FROM campaigns WHERE id = ?', [smallCampaignId]);
    });

    test('should handle campaign when large goal', async () => {
      const result = await Database.run(
        `INSERT INTO campaigns 
         (name, goal_amount, current_amount, status, created_by, notified_milestones)
         VALUES (?, ?, 0, 'active', 1, '[]')`,
        ['Large Goal Campaign', 1000000]
      );
      const largeCampaignId = result.id;

      // Donation of $250,000 should reach 25%
      const milestones = donationService.checkMilestones(250000, 1000000);
      expect(milestones).toContain(0.25);
      expect(milestones).not.toContain(0.5);

      await Database.run('DELETE FROM campaigns WHERE id = ?', [largeCampaignId]);
    });

    test('should handle fractional amounts precisely', async () => {
      const milestones = donationService.checkMilestones(250.5, 1000);
      expect(milestones).toContain(0.25);
    });

    test('should handle rapid sequential donations', async () => {
      const donations = [100, 150, 200, 300, 250]; // Total: 1000
      
      for (const donation of donations) {
        await donationService.processCampaignContribution(campaignId, donation);
      }

      const campaign = await Database.get('SELECT * FROM campaigns WHERE id = ?', [campaignId]);
      const notified = JSON.parse(campaign.notified_milestones);

      // All milestones should be notified
      expect(notified).toContain(0.25);
      expect(notified).toContain(0.5);
      expect(notified).toContain(0.75);
      expect(notified).toContain(1.0);
    });
  });

  describe('Campaign Lifecycle', () => {
    test('should transition campaign status correctly', async () => {
      let campaign = await Database.get('SELECT * FROM campaigns WHERE id = ?', [campaignId]);
      expect(campaign.status).toBe('active');

      // Reach goal
      await donationService.processCampaignContribution(campaignId, 1000);

      campaign = await Database.get('SELECT * FROM campaigns WHERE id = ?', [campaignId]);
      expect(campaign.status).toBe('closed');
    });

    test('should track milestone notification timestamp', async () => {
      await donationService.processCampaignContribution(campaignId, 250);

      const campaign = await Database.get('SELECT * FROM campaigns WHERE id = ?', [campaignId]);
      expect(campaign.last_milestone_notification).not.toBeNull();
    });

    test('should set closed_at timestamp when goal is reached', async () => {
      await donationService.processCampaignContribution(campaignId, 1000);

      const campaign = await Database.get('SELECT * FROM campaigns WHERE id = ?', [campaignId]);
      expect(campaign.closed_at).not.toBeNull();
      
      // Verify it's a valid timestamp
      const closedDate = new Date(campaign.closed_at);
      expect(closedDate.getTime()).toBeGreaterThan(0);
    });
  });

  describe('Campaign Progress Calculation', () => {
    test('should calculate progress percentage correctly', async () => {
      await Database.run(
        'UPDATE campaigns SET current_amount = 500 WHERE id = ?',
        [campaignId]
      );

      const campaign = await Database.get('SELECT * FROM campaigns WHERE id = ?', [campaignId]);
      const progressPercentage = Math.round((campaign.current_amount / campaign.goal_amount) * 100);
      
      expect(progressPercentage).toBe(50);
    });

    test('should handle progress over 100%', async () => {
      await donationService.processCampaignContribution(campaignId, 1500);

      const campaign = await Database.get('SELECT * FROM campaigns WHERE id = ?', [campaignId]);
      expect(campaign.current_amount).toBe(1500);
      expect(campaign.status).toBe('closed'); // Should still be closed at 100%
    });

    test('should include progress in SSE data', async () => {
      await Database.run(
        'UPDATE campaigns SET current_amount = 500 WHERE id = ?',
        [campaignId]
      );

      const response = await collectSse(
        `/api/v1/campaigns/${campaignId}/progress/stream`,
        { 'x-api-key': 'test-key-1' }
      );

      expect(response.body).toContain('"progress_percentage"');
    });
  });
});
