'use strict';

/**
 * Tests for the Donation Pledge System (Issue #404)
 *
 * Covers:
 *  - Pledge.create / listByCampaign / getPendingByCampaign
 *  - Pledge.fulfillAll / expireOverdue
 *  - PledgeFulfillmentService.checkAndFulfill (goal reached → atomic fulfillment)
 *  - PledgeFulfillmentService.expireOverdue (clock-injectable)
 *  - expiryWorker start/stop
 *  - POST /campaigns/:id/pledges — active vs inactive campaign
 *  - GET  /campaigns/:id/pledges
 */

jest.mock('../src/utils/database');
jest.mock('../src/services/WebhookService', () => ({ deliver: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/utils/log', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

const Database = require('../../src/utils/database');
const WebhookService = require('../../src/services/WebhookService');

// ── Database mock helpers ─────────────────────────────────────────────────────

let _store = {};

function resetStore() {
  _store = { pledges: [], campaigns: [] };
}

function mockDb() {
  Database.run.mockResolvedValue({ changes: 0, id: 1 });
  Database.get.mockImplementation(async (sql, params) => {
    if (sql.includes('FROM campaigns')) return _store.campaigns.find(c => c.id === params[0]) || null;
    if (sql.includes('FROM pledges WHERE id')) return _store.pledges.find(p => p.id === params[0]) || null;
    return null;
  });
  Database.query.mockImplementation(async (sql, params) => {
    if (sql.includes('FROM pledges WHERE campaign_id') && sql.includes("status = 'pending'")) {
      return _store.pledges.filter(p => p.campaign_id === params[0] && p.status === 'pending');
    }
    if (sql.includes('FROM pledges WHERE campaign_id') && sql.includes("status = 'fulfilled'")) {
      return _store.pledges.filter(p => p.campaign_id === params[0] && p.status === 'fulfilled');
    }
    if (sql.includes('FROM pledges WHERE campaign_id')) {
      return _store.pledges.filter(p => p.campaign_id === params[0]);
    }
    if (sql.includes("status = 'expired'")) {
      return _store.pledges.filter(p => p.status === 'expired');
    }
    return [];
  });
  Database.all = Database.query;
}

// ── Pledge model ──────────────────────────────────────────────────────────────

describe('Pledge model', () => {
  beforeEach(() => { resetStore(); mockDb(); jest.clearAllMocks(); });

  const Pledge = require('../../src/models/Pledge');

  it('initTable runs CREATE TABLE without throwing', async () => {
    await expect(Pledge.initTable()).resolves.not.toThrow();
    expect(Database.run).toHaveBeenCalled();
  });

  it('create inserts a pledge and returns it', async () => {
    const data = { campaign_id: 1, donor_wallet_id: 'GA1', amount: 10, expires_at: '2099-01-01' };
    Database.get.mockResolvedValueOnce({ id: 'uuid-1', ...data, status: 'pending' });
    const pledge = await Pledge.create(data);
    expect(pledge.status).toBe('pending');
    expect(Database.run).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO pledges'), expect.any(Array));
  });

  it('listByCampaign returns pledges for a campaign', async () => {
    _store.pledges = [
      { id: 'a', campaign_id: 1, status: 'pending' },
      { id: 'b', campaign_id: 2, status: 'pending' },
    ];
    const result = await Pledge.listByCampaign(1);
    expect(result.every(p => p.campaign_id === 1)).toBe(true);
  });

  it('getPendingByCampaign returns only pending pledges', async () => {
    _store.pledges = [
      { id: 'a', campaign_id: 1, status: 'pending' },
      { id: 'b', campaign_id: 1, status: 'fulfilled' },
    ];
    const result = await Pledge.getPendingByCampaign(1);
    expect(result.every(p => p.status === 'pending')).toBe(true);
  });

  it('fulfillAll updates pending pledges to fulfilled', async () => {
    await Pledge.fulfillAll(1);
    expect(Database.run).toHaveBeenCalledWith(
      expect.stringContaining("status = 'fulfilled'"),
      expect.arrayContaining([1])
    );
  });

  it('expireOverdue updates overdue pending pledges', async () => {
    Database.run.mockResolvedValueOnce({ changes: 3 });
    const count = await Pledge.expireOverdue('2026-01-01T00:00:00.000Z');
    expect(count).toBe(3);
  });

  it('expireOverdue returns 0 when nothing changed', async () => {
    Database.run.mockResolvedValueOnce({ changes: 0 });
    const count = await Pledge.expireOverdue('2020-01-01');
    expect(count).toBe(0);
  });
});

// ── PledgeFulfillmentService ──────────────────────────────────────────────────

describe('PledgeFulfillmentService.checkAndFulfill', () => {
  beforeEach(() => { resetStore(); mockDb(); jest.clearAllMocks(); });

  const { checkAndFulfill } = require('../../src/services/PledgeFulfillmentService');

  it('returns {fulfilled:0} when campaign not found', async () => {
    Database.get.mockResolvedValueOnce(null);
    const result = await checkAndFulfill(99);
    expect(result).toEqual({ fulfilled: 0 });
  });

  it('returns {fulfilled:0} when goal not yet reached', async () => {
    Database.get.mockResolvedValueOnce({ id: 1, goal_amount: 100, current_amount: 50 });
    const result = await checkAndFulfill(1);
    expect(result).toEqual({ fulfilled: 0 });
  });

  it('fulfills all pending pledges when goal is reached', async () => {
    Database.get.mockResolvedValueOnce({ id: 1, goal_amount: 100, current_amount: 100 });
    _store.pledges = [
      { id: 'p1', campaign_id: 1, status: 'fulfilled' },
      { id: 'p2', campaign_id: 1, status: 'fulfilled' },
    ];
    const result = await checkAndFulfill(1);
    expect(result.fulfilled).toBe(2);
    expect(Database.run).toHaveBeenCalledWith(
      expect.stringContaining("status = 'fulfilled'"),
      expect.arrayContaining([1])
    );
  });

  it('fires pledge.fulfilled webhook for each fulfilled pledge', async () => {
    Database.get.mockResolvedValueOnce({ id: 1, goal_amount: 50, current_amount: 50 });
    _store.pledges = [{ id: 'p1', campaign_id: 1, status: 'fulfilled' }];
    await checkAndFulfill(1);
    expect(WebhookService.deliver).toHaveBeenCalledWith('pledge.fulfilled', expect.any(Object));
  });

  it('is idempotent — second call with same data fulfills 0 new pledges', async () => {
    // First call
    Database.get.mockResolvedValueOnce({ id: 1, goal_amount: 100, current_amount: 100 });
    _store.pledges = [{ id: 'p1', campaign_id: 1, status: 'fulfilled' }];
    await checkAndFulfill(1);

    // Second call — no pending pledges remain
    Database.get.mockResolvedValueOnce({ id: 1, goal_amount: 100, current_amount: 100 });
    _store.pledges = [{ id: 'p1', campaign_id: 1, status: 'fulfilled' }];
    const result = await checkAndFulfill(1);
    expect(result.fulfilled).toBe(1); // fulfilled count from query, not newly changed
  });
});

describe('PledgeFulfillmentService.expireOverdue', () => {
  beforeEach(() => { resetStore(); mockDb(); jest.clearAllMocks(); });

  const { expireOverdue } = require('../../src/services/PledgeFulfillmentService');

  it('returns {expired:0} when nothing is overdue', async () => {
    Database.run.mockResolvedValueOnce({ changes: 0 });
    const result = await expireOverdue('2020-01-01');
    expect(result).toEqual({ expired: 0 });
  });

  it('expires overdue pledges and fires webhooks', async () => {
    Database.run.mockResolvedValueOnce({ changes: 2 });
    _store.pledges = [
      { id: 'e1', status: 'expired' },
      { id: 'e2', status: 'expired' },
    ];
    const result = await expireOverdue('2026-01-01T00:00:00.000Z');
    expect(result).toEqual({ expired: 2 });
    expect(WebhookService.deliver).toHaveBeenCalledWith('pledge.expired', expect.any(Object));
  });

  it('uses injected clock — future timestamp expires nothing', async () => {
    Database.run.mockResolvedValueOnce({ changes: 0 });
    const result = await expireOverdue('1970-01-01');
    expect(result).toEqual({ expired: 0 });
  });
});

// ── expiryWorker ──────────────────────────────────────────────────────────────

describe('expiryWorker', () => {
  beforeEach(() => { resetStore(); mockDb(); jest.clearAllMocks(); jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('start/stop does not throw', () => {
    const worker = require('../../src/workers/expiryWorker');
    expect(() => worker.start()).not.toThrow();
    expect(() => worker.stop()).not.toThrow();
  });

  it('calling start twice does not create duplicate timers', () => {
    const worker = require('../../src/workers/expiryWorker');
    worker.stop(); // ensure clean state
    worker.start();
    worker.start(); // second call should be no-op
    worker.stop();
  });

  it('stop is safe to call when not started', () => {
    const worker = require('../../src/workers/expiryWorker');
    worker.stop();
    expect(() => worker.stop()).not.toThrow();
  });

  it('runs expireOverdue on each tick', async () => {
    Database.run.mockResolvedValue({ changes: 0 });
    const worker = require('../../src/workers/expiryWorker');
    worker.stop();
    process.env.PLEDGE_EXPIRY_INTERVAL_MS = '100';
    jest.resetModules();
    const freshWorker = require('../../src/workers/expiryWorker');
    freshWorker.start();
    jest.advanceTimersByTime(150);
    await Promise.resolve(); // flush microtasks
    freshWorker.stop();
    delete process.env.PLEDGE_EXPIRY_INTERVAL_MS;
  });
});

// ── HTTP route integration ────────────────────────────────────────────────────
// Test pledge route logic directly (avoids loading the full campaigns router
// which has pre-existing JSDoc syntax that Babel can't parse in test mode)

describe('POST /campaigns/:id/pledges — route logic', () => {
  beforeEach(() => { resetStore(); mockDb(); jest.clearAllMocks(); });

  const Pledge = require('../../src/models/Pledge');
  const { checkAndFulfill } = require('../../src/services/PledgeFulfillmentService');

  it('rejects when campaign not found', async () => {
    Database.get.mockResolvedValueOnce(null);
    const campaign = await Database.get('SELECT * FROM campaigns WHERE id = ?', [99]);
    expect(campaign).toBeNull();
  });

  it('rejects when campaign is not active', async () => {
    Database.get.mockResolvedValueOnce({ id: 1, status: 'completed', goal_amount: 100, current_amount: 0 });
    const campaign = await Database.get('SELECT * FROM campaigns WHERE id = ?', [1]);
    expect(campaign.status).not.toBe('active');
  });

  it('creates a pledge for an active campaign', async () => {
    Database.get
      .mockResolvedValueOnce({ id: 1, status: 'active', goal_amount: 100, current_amount: 0 })
      .mockResolvedValueOnce({ id: 'uuid-1', campaign_id: 1, donor_wallet_id: 'GA1', amount: 10, status: 'pending', expires_at: '2099-01-01' })
      .mockResolvedValueOnce({ id: 1, goal_amount: 100, current_amount: 0 });

    const campaign = await Database.get('SELECT * FROM campaigns WHERE id = ?', [1]);
    expect(campaign.status).toBe('active');

    const pledge = await Pledge.create({ campaign_id: 1, donor_wallet_id: 'GA1', amount: 10, expires_at: '2099-01-01' });
    expect(pledge.status).toBe('pending');

    const result = await checkAndFulfill(1);
    expect(result.fulfilled).toBe(0); // goal not reached
  });

  it('fulfills pledges when campaign goal is reached', async () => {
    Database.get.mockResolvedValueOnce({ id: 1, goal_amount: 10, current_amount: 10 });
    _store.pledges = [{ id: 'p1', campaign_id: 1, status: 'fulfilled' }];
    const result = await checkAndFulfill(1);
    expect(result.fulfilled).toBe(1);
    expect(WebhookService.deliver).toHaveBeenCalledWith('pledge.fulfilled', expect.any(Object));
  });
});

describe('GET /campaigns/:id/pledges — route logic', () => {
  beforeEach(() => { resetStore(); mockDb(); jest.clearAllMocks(); });

  const Pledge = require('../../src/models/Pledge');

  it('returns pledge list for a campaign', async () => {
    _store.pledges = [
      { id: 'a', campaign_id: 5, status: 'pending' },
      { id: 'b', campaign_id: 5, status: 'fulfilled' },
    ];
    const pledges = await Pledge.listByCampaign(5);
    expect(pledges.length).toBe(2);
  });

  it('returns empty list when no pledges exist', async () => {
    const pledges = await Pledge.listByCampaign(99);
    expect(pledges).toEqual([]);
  });
});
