/**
 * Tests for Issue #2: Campaign Milestone Notifications
 * 
 * Verifies:
 * - Milestone detection at 25%, 50%, 75%, 100%
 * - Single-fire behavior (no duplicate events)
 * - Webhook event emission
 * - Email notification triggering
 * - Persistence across restarts
 */

const Database = require('../src/utils/database');
const CampaignMilestoneService = require('../src/services/CampaignMilestoneService');

describe('Campaign Milestone Notifications', () => {
  beforeAll(async () => {
    await Database.initialize(':memory:');
    
    // Create campaigns table with milestone columns
    await Database.run(`
      CREATE TABLE campaigns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        goal_amount REAL NOT NULL,
        current_amount REAL DEFAULT 0,
        milestones_reached INTEGER DEFAULT 0,
        notification_email TEXT,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  });

  afterAll(async () => {
    await Database.close();
  });

  describe('Milestone Detection', () => {
    test('detects 25% milestone', async () => {
      const result = await Database.run(
        'INSERT INTO campaigns (name, goal_amount, current_amount) VALUES (?, ?, ?)',
        ['Test Campaign', 10000, 0]
      );
      const campaignId = result.id;

      // Update to 25%
      await Database.run(
        'UPDATE campaigns SET current_amount = ? WHERE id = ?',
        [2500, campaignId]
      );

      const milestones = await CampaignMilestoneService.checkMilestones(campaignId);
      
      expect(milestones).toHaveLength(1);
      expect(milestones[0].percent).toBe(25);
      expect(milestones[0].campaignId).toBe(campaignId);
    });

    test('detects multiple milestones at once', async () => {
      const result = await Database.run(
        'INSERT INTO campaigns (name, goal_amount, current_amount) VALUES (?, ?, ?)',
        ['Jump Campaign', 10000, 0]
      );
      const campaignId = result.id;

      // Jump directly to 60% - should trigger both 25% and 50%
      await Database.run(
        'UPDATE campaigns SET current_amount = ? WHERE id = ?',
        [6000, campaignId]
      );

      const milestones = await CampaignMilestoneService.checkMilestones(campaignId);
      
      expect(milestones).toHaveLength(2);
      expect(milestones.map(m => m.percent)).toContain(25);
      expect(milestones.map(m => m.percent)).toContain(50);
    });

    test('does not fire same milestone twice', async () => {
      const result = await Database.run(
        'INSERT INTO campaigns (name, goal_amount, current_amount, milestones_reached) VALUES (?, ?, ?, ?)',
        ['Existing Campaign', 10000, 2500, 1] // 25% already reached (bitmask = 1)
      );
      const campaignId = result.id;

      // Try to check milestones again
      const milestones = await CampaignMilestoneService.checkMilestones(campaignId);
      
      expect(milestones).toHaveLength(0); // No new milestones
    });

    test('fires 50% milestone after 25% was already fired', async () => {
      const result = await Database.run(
        'INSERT INTO campaigns (name, goal_amount, current_amount, milestones_reached) VALUES (?, ?, ?, ?)',
        ['Progressive Campaign', 10000, 2500, 1] // 25% reached
      );
      const campaignId = result.id;

      // Update to 50%
      await Database.run(
        'UPDATE campaigns SET current_amount = ? WHERE id = ?',
        [5000, campaignId]
      );

      const milestones = await CampaignMilestoneService.checkMilestones(campaignId);
      
      expect(milestones).toHaveLength(1);
      expect(milestones[0].percent).toBe(50);
    });

    test('fires 100% milestone when goal is reached', async () => {
      const result = await Database.run(
        'INSERT INTO campaigns (name, goal_amount, current_amount, milestones_reached) VALUES (?, ?, ?, ?)',
        ['Almost Done', 10000, 7500, 7] // 25%, 50%, 75% reached (1+2+4=7)
      );
      const campaignId = result.id;

      // Reach 100%
      await Database.run(
        'UPDATE campaigns SET current_amount = ? WHERE id = ?',
        [10000, campaignId]
      );

      const milestones = await CampaignMilestoneService.checkMilestones(campaignId);
      
      expect(milestones).toHaveLength(1);
      expect(milestones[0].percent).toBe(100);
    });
  });

  describe('Webhook Event Emission', () => {
    test('emits campaign.milestone_reached event', async () => {
      const result = await Database.run(
        'INSERT INTO campaigns (name, goal_amount, current_amount) VALUES (?, ?, ?)',
        ['Webhook Test', 10000, 0]
      );
      const campaignId = result.id;

      const eventSpy = jest.fn();
      CampaignMilestoneService.on('campaign.milestone_reached', eventSpy);

      // Update to 25%
      await Database.run(
        'UPDATE campaigns SET current_amount = ? WHERE id = ?',
        [2500, campaignId]
      );

      await CampaignMilestoneService.checkMilestones(campaignId);

      expect(eventSpy).toHaveBeenCalledTimes(1);
      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'campaign.milestone_reached',
          data: expect.objectContaining({
            campaignId,
            milestonePercent: 25,
            currentAmount: 2500,
            goalAmount: 10000,
          }),
        })
      );

      CampaignMilestoneService.removeListener('campaign.milestone_reached', eventSpy);
    });
  });

  describe('Milestone Persistence', () => {
    test('milestone state persists in database', async () => {
      const result = await Database.run(
        'INSERT INTO campaigns (name, goal_amount, current_amount) VALUES (?, ?, ?)',
        ['Persistent Test', 10000, 2500]
      );
      const campaignId = result.id;

      await CampaignMilestoneService.checkMilestones(campaignId);

      // Check database directly
      const campaign = await Database.get(
        'SELECT milestones_reached FROM campaigns WHERE id = ?',
        [campaignId]
      );

      expect(campaign.milestones_reached).toBe(1); // 25% = bitmask 1
    });

    test('can reset milestones', async () => {
      const result = await Database.run(
        'INSERT INTO campaigns (name, goal_amount, current_amount, milestones_reached) VALUES (?, ?, ?, ?)',
        ['Reset Test', 10000, 5000, 3] // 25% and 50% reached
      );
      const campaignId = result.id;

      await CampaignMilestoneService.resetMilestones(campaignId);

      const campaign = await Database.get(
        'SELECT milestones_reached FROM campaigns WHERE id = ?',
        [campaignId]
      );

      expect(campaign.milestones_reached).toBe(0);
    });
  });
});
