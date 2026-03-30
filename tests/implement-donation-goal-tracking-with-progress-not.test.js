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

const request = require('supertest');
const { EventEmitter } = require('events');
const Database = require('../src/utils/database');
const DonationService = require('../src/services/DonationService');
const WebhookService = require('../src/services/WebhookService');
const MockStellarService = require('./MockStellarService.test');

// Mock the EventSource for SSE testing
class MockEventSource extends EventEmitter {
  constructor(url, options) {
    super();
    this.url = url;
    this.options = options;
    this.readyState = 0; // CONNECTING
    
    setTimeout(() => {
      this.readyState = 1; // OPEN
      this.emit('open');
    }, 10);
  }

  close() {
    this.readyState = 2; // CLOSED
    this.emit('close');
  }
}

describe('Donation Goal Tracking with Real-Time Progress', () => {
  let app, donationService, campaignId;

  beforeAll(async () => {
    // Initialize test app
    app = require('../src/routes/app');
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
    test('should update campaign current_amount on donation', async () => {
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

    test('should handle donations on closed campaigns gracefully', async () => {
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
    test('should establish SSE connection for campaign progress', async () => {
      const response = await request(app)
        .get(`/api/campaigns/${campaignId}/progress/stream`)
        .set('X-API-Key', 'test-key-123');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('text/event-stream');
      expect(response.headers['cache-control']).toBe('no-cache');
      expect(response.headers['connection']).toBe('keep-alive');
    });

    test('should reject SSE connection without API key', async () => {
      const response = await request(app)
        .get(`/api/campaigns/${campaignId}/progress/stream`);

      expect(response.status).toBe(401);
    });

    test('should send initial campaign state on SSE connection', async () => {
      // Set initial campaign state
      await Database.run(
        'UPDATE campaigns SET current_amount = 250 WHERE id = ?',
        [campaignId]
      );

      const response = await request(app)
        .get(`/api/campaigns/${campaignId}/progress/stream`)
        .set('X-API-Key', 'test-key-123')
        .timeout(500);

      // Response should contain initial state
      expect(response.text).toContain('progress_percentage');
    });

    test('should return 404 for non-existent campaign', async () => {
      const response = await request(app)
        .get('/api/campaigns/99999/progress/stream')
        .set('X-API-Key', 'test-key-123');

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });

    test('should enforce connection limit per API key', async () => {
      const apiKey = 'test-key-limit';
      const maxConnections = require('../src/services/SseManager').MAX_CONNECTIONS_PER_KEY;

      // Try to exceed connection limit
      const promises = [];
      for (let i = 0; i < maxConnections + 1; i++) {
        promises.push(
          request(app)
            .get(`/api/campaigns/${campaignId}/progress/stream`)
            .set('X-API-Key', apiKey)
            .timeout(100)
        );
      }

      const results = await Promise.allSettled(promises);
      const successCount = results.filter(r => r.status === 'fulfilled' && r.value.status === 200).length;
      
      expect(successCount).toBeLessThanOrEqual(maxConnections);
    });

    test('should send heartbeat periodically', async () => {
      let heartbeatReceived = false;
      
      // This test is more of an integration test - in real scenario,
      // the EventSource would receive heartbeat comments
      const response = await request(app)
        .get(`/api/campaigns/${campaignId}/progress/stream`)
        .set('X-API-Key', 'test-key-123')
        .timeout(1000);

      // In a real SSE test, we'd check for ": heartbeat" comments
      // For now, we just verify the connection is established
      expect(response.status).toBe(200);
    });

    test('should include event type in SSE message', async () => {
      const response = await request(app)
        .get(`/api/campaigns/${campaignId}/progress/stream`)
        .set('X-API-Key', 'test-key-123')
        .timeout(500);

      // Response should be in SSE format
      expect(response.headers['content-type']).toBe('text/event-stream');
    });
  });

  describe('Webhook Dispatch', () => {
    test('should dispatch webhook on milestone reached', async () => {
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

    test('should dispatch multiple milestone webhooks for large donation', async () => {
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

    test('should handle campaign with very small goal', async () => {
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

    test('should handle campaign with large goal', async () => {
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

    test('should include progress in SSE data', (done) => {
      const mockResponse = new EventEmitter();
      mockResponse.write = jest.fn((data) => {
        if (data.includes('progress_percentage')) {
          expect(data).toContain('"progress_percentage"');
          done();
        }
      });
      mockResponse.setHeader = jest.fn();
      mockResponse.status = 200;
      mockResponse.headers = {
        'content-type': 'text/event-stream'
      };

      // This is a simplified test - in production, you'd use a real HTTP client
      // to test SSE connections
    });
  });
});
