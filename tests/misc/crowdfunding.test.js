'use strict';

/**
 * tests/crowdfunding.test.js
 *
 * Tests for all-or-nothing crowdfunding with escrow.
 * Uses an in-memory SQLite database — no live Stellar network required.
 */

const Database = require('../../src/utils/database');
const CrowdfundingService = require('../../src/services/CrowdfundingService');

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function createUser(publicKey = `GTEST${Date.now()}${Math.random()}`) {
  const r = await Database.run(
    `INSERT INTO users (publicKey) VALUES (?)`,
    [publicKey]
  );
  return r.id;
}

async function createCampaign({ fundingModel = 'all-or-nothing', goalAmount = 100, endDate = null, status = 'active' } = {}) {
  const r = await Database.run(
    `INSERT INTO campaigns (name, goal_amount, current_amount, status, funding_model, end_date)
     VALUES (?, ?, 0, ?, ?, ?)`,
    [`Test Campaign ${Date.now()}`, goalAmount, status, fundingModel, endDate]
  );
  return r.id;
}

// ─── Setup / Teardown ────────────────────────────────────────────────────────

beforeAll(async () => {
  await Database.initialize();
});

afterAll(async () => {
  await Database.close();
});

beforeEach(async () => {
  await Database.run('DELETE FROM escrow_pledges');
  await Database.run('DELETE FROM campaigns');
  await Database.run('DELETE FROM users');
});

// ─── pledge() ────────────────────────────────────────────────────────────────

describe('CrowdfundingService.pledge()', () => {
  test('holds funds in escrow for all-or-nothing campaign', async () => {
    const donorId = await createUser();
    const campaignId = await createCampaign({ fundingModel: 'all-or-nothing', goalAmount: 100 });

    const result = await CrowdfundingService.pledge(campaignId, donorId, 40);

    expect(result.status).toBe('held');
    expect(result.amount).toBe(40);
    expect(result.campaignId).toBe(campaignId);

    const pledge = await Database.get('SELECT * FROM escrow_pledges WHERE id = ?', [result.pledgeId]);
    expect(pledge.status).toBe('held');
    expect(pledge.amount).toBe(40);
  });

  test('updates campaign current_amount after pledge', async () => {
    const donorId = await createUser();
    const campaignId = await createCampaign({ fundingModel: 'all-or-nothing', goalAmount: 100 });

    await CrowdfundingService.pledge(campaignId, donorId, 60);

    const campaign = await Database.get('SELECT current_amount FROM campaigns WHERE id = ?', [campaignId]);
    expect(campaign.current_amount).toBe(60);
  });

  test('accumulates multiple pledges', async () => {
    const donor1 = await createUser();
    const donor2 = await createUser();
    const campaignId = await createCampaign({ fundingModel: 'all-or-nothing', goalAmount: 100 });

    await CrowdfundingService.pledge(campaignId, donor1, 40);
    await CrowdfundingService.pledge(campaignId, donor2, 35);

    const campaign = await Database.get('SELECT current_amount FROM campaigns WHERE id = ?', [campaignId]);
    expect(campaign.current_amount).toBe(75);
  });

  test('rejects pledge on non-all-or-nothing campaign', async () => {
    const donorId = await createUser();
    const campaignId = await createCampaign({ fundingModel: 'keep-what-you-raise' });

    await expect(CrowdfundingService.pledge(campaignId, donorId, 10))
      .rejects.toMatchObject({ message: 'Campaign is not all-or-nothing', status: 400 });
  });

  test('rejects pledge on non-active campaign', async () => {
    const donorId = await createUser();
    const campaignId = await createCampaign({ fundingModel: 'all-or-nothing', status: 'completed' });

    await expect(CrowdfundingService.pledge(campaignId, donorId, 10))
      .rejects.toMatchObject({ status: 400 });
  });

  test('rejects pledge after deadline', async () => {
    const donorId = await createUser();
    const pastDate = new Date(Date.now() - 86400000).toISOString(); // yesterday
    const campaignId = await createCampaign({ fundingModel: 'all-or-nothing', endDate: pastDate });

    await expect(CrowdfundingService.pledge(campaignId, donorId, 10))
      .rejects.toMatchObject({ message: 'Campaign deadline has passed', status: 400 });
  });

  test('rejects pledge on unknown campaign', async () => {
    const donorId = await createUser();
    await expect(CrowdfundingService.pledge(99999, donorId, 10))
      .rejects.toMatchObject({ status: 404 });
  });
});

// ─── settle() — goal met ──────────────────────────────────────────────────────

describe('CrowdfundingService.settle() — goal met', () => {
  test('releases funds when goal is reached', async () => {
    const donor1 = await createUser();
    const donor2 = await createUser();
    const campaignId = await createCampaign({ fundingModel: 'all-or-nothing', goalAmount: 100 });

    await CrowdfundingService.pledge(campaignId, donor1, 60);
    await CrowdfundingService.pledge(campaignId, donor2, 50);

    const result = await CrowdfundingService.settle(campaignId);

    expect(result.outcome).toBe('released');
    expect(result.totalAmount).toBe(110);
    expect(result.count).toBe(2);
  });

  test('marks all pledges as released', async () => {
    const donorId = await createUser();
    const campaignId = await createCampaign({ fundingModel: 'all-or-nothing', goalAmount: 50 });

    await CrowdfundingService.pledge(campaignId, donorId, 50);
    await CrowdfundingService.settle(campaignId);

    const pledges = await Database.query(
      'SELECT status FROM escrow_pledges WHERE campaign_id = ?', [campaignId]
    );
    expect(pledges.every(p => p.status === 'released')).toBe(true);
  });

  test('marks campaign status as released', async () => {
    const donorId = await createUser();
    const campaignId = await createCampaign({ fundingModel: 'all-or-nothing', goalAmount: 50 });

    await CrowdfundingService.pledge(campaignId, donorId, 50);
    await CrowdfundingService.settle(campaignId);

    const campaign = await Database.get('SELECT status FROM campaigns WHERE id = ?', [campaignId]);
    expect(campaign.status).toBe('released');
  });
});

// ─── settle() — goal not met (refund) ────────────────────────────────────────

describe('CrowdfundingService.settle() — deadline passed without goal', () => {
  test('refunds all donors when goal is not met', async () => {
    const donor1 = await createUser();
    const donor2 = await createUser();
    const campaignId = await createCampaign({ fundingModel: 'all-or-nothing', goalAmount: 100 });

    await CrowdfundingService.pledge(campaignId, donor1, 30);
    await CrowdfundingService.pledge(campaignId, donor2, 20);

    const result = await CrowdfundingService.settle(campaignId);

    expect(result.outcome).toBe('refunded');
    expect(result.totalAmount).toBe(50);
    expect(result.count).toBe(2);
  });

  test('marks all pledges as refunded', async () => {
    const donorId = await createUser();
    const campaignId = await createCampaign({ fundingModel: 'all-or-nothing', goalAmount: 100 });

    await CrowdfundingService.pledge(campaignId, donorId, 40);
    await CrowdfundingService.settle(campaignId);

    const pledges = await Database.query(
      'SELECT status FROM escrow_pledges WHERE campaign_id = ?', [campaignId]
    );
    expect(pledges.every(p => p.status === 'refunded')).toBe(true);
  });

  test('marks campaign status as refunded', async () => {
    const donorId = await createUser();
    const campaignId = await createCampaign({ fundingModel: 'all-or-nothing', goalAmount: 100 });

    await CrowdfundingService.pledge(campaignId, donorId, 40);
    await CrowdfundingService.settle(campaignId);

    const campaign = await Database.get('SELECT status FROM campaigns WHERE id = ?', [campaignId]);
    expect(campaign.status).toBe('refunded');
  });

  test('refunds when no pledges at all', async () => {
    const campaignId = await createCampaign({ fundingModel: 'all-or-nothing', goalAmount: 100 });

    const result = await CrowdfundingService.settle(campaignId);

    expect(result.outcome).toBe('refunded');
    expect(result.totalAmount).toBe(0);
    expect(result.count).toBe(0);
  });
});

// ─── settle() — idempotency ───────────────────────────────────────────────────

describe('CrowdfundingService.settle() — idempotency', () => {
  test('calling settle twice returns same outcome (released)', async () => {
    const donorId = await createUser();
    const campaignId = await createCampaign({ fundingModel: 'all-or-nothing', goalAmount: 50 });

    await CrowdfundingService.pledge(campaignId, donorId, 50);
    const first = await CrowdfundingService.settle(campaignId);
    const second = await CrowdfundingService.settle(campaignId);

    expect(second.outcome).toBe(first.outcome);
    expect(second.totalAmount).toBe(first.totalAmount);
  });

  test('calling settle twice returns same outcome (refunded)', async () => {
    const donorId = await createUser();
    const campaignId = await createCampaign({ fundingModel: 'all-or-nothing', goalAmount: 100 });

    await CrowdfundingService.pledge(campaignId, donorId, 10);
    const first = await CrowdfundingService.settle(campaignId);
    const second = await CrowdfundingService.settle(campaignId);

    expect(second.outcome).toBe(first.outcome);
  });

  test('rejects settle on non-all-or-nothing campaign', async () => {
    const campaignId = await createCampaign({ fundingModel: 'keep-what-you-raise' });

    await expect(CrowdfundingService.settle(campaignId))
      .rejects.toMatchObject({ status: 400 });
  });
});

// ─── getEscrowState() ─────────────────────────────────────────────────────────

describe('CrowdfundingService.getEscrowState()', () => {
  test('returns correct escrow state with held pledges', async () => {
    const donor1 = await createUser();
    const donor2 = await createUser();
    const campaignId = await createCampaign({ fundingModel: 'all-or-nothing', goalAmount: 100 });

    await CrowdfundingService.pledge(campaignId, donor1, 40);
    await CrowdfundingService.pledge(campaignId, donor2, 30);

    const state = await CrowdfundingService.getEscrowState(campaignId);

    expect(state.totalHeld).toBe(70);
    expect(state.pledges).toHaveLength(2);
    expect(state.goalMet).toBe(false);
    expect(state.campaign.id).toBe(campaignId);
  });

  test('goalMet is true when current_amount >= goal_amount', async () => {
    const donorId = await createUser();
    const campaignId = await createCampaign({ fundingModel: 'all-or-nothing', goalAmount: 50 });

    await CrowdfundingService.pledge(campaignId, donorId, 50);

    const state = await CrowdfundingService.getEscrowState(campaignId);
    expect(state.goalMet).toBe(true);
  });

  test('totalHeld excludes released/refunded pledges', async () => {
    const donorId = await createUser();
    const campaignId = await createCampaign({ fundingModel: 'all-or-nothing', goalAmount: 50 });

    await CrowdfundingService.pledge(campaignId, donorId, 50);
    await CrowdfundingService.settle(campaignId); // marks pledges as 'released'

    const state = await CrowdfundingService.getEscrowState(campaignId);
    expect(state.totalHeld).toBe(0); // nothing held after settlement
  });

  test('throws 404 for unknown campaign', async () => {
    await expect(CrowdfundingService.getEscrowState(99999))
      .rejects.toMatchObject({ status: 404 });
  });
});

// ─── keep-what-you-raise unchanged ───────────────────────────────────────────

describe('keep-what-you-raise model', () => {
  test('pledge is rejected — escrow only applies to all-or-nothing', async () => {
    const donorId = await createUser();
    const campaignId = await createCampaign({ fundingModel: 'keep-what-you-raise', goalAmount: 100 });

    await expect(CrowdfundingService.pledge(campaignId, donorId, 50))
      .rejects.toMatchObject({ status: 400 });
  });

  test('settle is rejected — escrow only applies to all-or-nothing', async () => {
    const campaignId = await createCampaign({ fundingModel: 'keep-what-you-raise', goalAmount: 100 });

    await expect(CrowdfundingService.settle(campaignId))
      .rejects.toMatchObject({ status: 400 });
  });

  test('keep-what-you-raise campaigns are unaffected by crowdfunding service', async () => {
    // Verify a KWYR campaign can still be created and queried normally
    const campaignId = await createCampaign({ fundingModel: 'keep-what-you-raise', goalAmount: 100 });
    const campaign = await Database.get('SELECT * FROM campaigns WHERE id = ?', [campaignId]);

    expect(campaign.funding_model).toBe('keep-what-you-raise');
    expect(campaign.status).toBe('active');
  });
});
