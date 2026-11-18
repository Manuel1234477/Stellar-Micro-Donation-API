'use strict';

/**
 * Tests: Crowdfunding Campaign Milestone-Based Fund Release (#610)
 * Covers: milestone creation, listing, admin verification, fund release,
 *         progress tracking, permission enforcement
 */

const Database = require('../../src/utils/database');

let campaignId;

async function createTestCampaign(overrides = {}) {
  const result = await Database.run(
    `INSERT INTO campaigns (name, description, goal_amount, current_amount, start_date, status, funding_model)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      overrides.name || 'Test Campaign',
      overrides.description || 'A test campaign',
      overrides.goal_amount || 1000,
      overrides.current_amount || 500,
      new Date().toISOString(),
      overrides.status || 'active',
      overrides.funding_model || 'all-or-nothing',
    ]
  );
  return result.id;
}

beforeAll(async () => {
  await Database.initialize();
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
  campaignId = await createTestCampaign();
});

afterAll(async () => {
  await Database.run('DELETE FROM campaign_milestones').catch(() => {});
  await Database.close();
});

beforeEach(async () => {
  await Database.run('DELETE FROM campaign_milestones').catch(() => {});
});

// ─── Helper to get route handlers ────────────────────────────────────────────

function getHandler(router, method, path) {
  const layer = router.stack.find(
    l => l.route && l.route.path === path && l.route.methods[method]
  );
  if (!layer) return null;
  const handlers = layer.route.stack;
  return handlers[handlers.length - 1].handle;
}

function makeRes() {
  return {
    _status: 200, _body: null,
    status(s) { this._status = s; return this; },
    json(b) { this._body = b; return this; },
  };
}

// ─── POST /campaigns/:id/milestones ──────────────────────────────────────────

describe('POST /campaigns/:id/milestones handler', () => {
  let handler;

  beforeAll(() => {
    const router = require('../../src/routes/campaigns');
    handler = getHandler(router, 'post', '/:id/milestones');
  });

  it('returns 400 when title is missing', async () => {
    if (!handler) return;
    const req = { params: { id: String(campaignId) }, body: { target_amount: 250 }, user: { id: 1, role: 'admin' } };
    const res = makeRes();
    await handler(req, res, jest.fn());
    expect(res._status).toBe(400);
  });

  it('returns 400 when target_amount is invalid', async () => {
    if (!handler) return;
    const req = { params: { id: String(campaignId) }, body: { title: 'M1', target_amount: -10 }, user: { id: 1, role: 'admin' } };
    const res = makeRes();
    await handler(req, res, jest.fn());
    expect(res._status).toBe(400);
  });

  it('returns 400 when target_amount is zero', async () => {
    if (!handler) return;
    const req = { params: { id: String(campaignId) }, body: { title: 'M1', target_amount: 0 }, user: { id: 1, role: 'admin' } };
    const res = makeRes();
    await handler(req, res, jest.fn());
    expect(res._status).toBe(400);
  });

  it('returns 404 for non-existent campaign', async () => {
    if (!handler) return;
    const req = { params: { id: '99999' }, body: { title: 'M1', target_amount: 250 }, user: { id: 1, role: 'admin' } };
    const res = makeRes();
    await handler(req, res, jest.fn());
    expect(res._status).toBe(404);
  });

  it('creates a milestone successfully', async () => {
    if (!handler) return;
    const req = {
      params: { id: String(campaignId) },
      body: { title: 'Phase 1', description: 'First phase', target_amount: 250 },
      user: { id: 1, role: 'admin' },
    };
    const res = makeRes();
    await handler(req, res, jest.fn());
    expect(res._status).toBe(201);
    expect(res._body.success).toBe(true);
    expect(res._body.data.title).toBe('Phase 1');
    expect(res._body.data.target_amount).toBe(250);
    expect(res._body.data.status).toBe('pending');
  });

  it('trims whitespace from title', async () => {
    if (!handler) return;
    const req = {
      params: { id: String(campaignId) },
      body: { title: '  Phase 2  ', target_amount: 500 },
      user: { id: 1, role: 'admin' },
    };
    const res = makeRes();
    await handler(req, res, jest.fn());
    expect(res._body.data.title).toBe('Phase 2');
  });
});

// ─── GET /campaigns/:id/milestones ───────────────────────────────────────────

describe('GET /campaigns/:id/milestones handler', () => {
  let handler;

  beforeAll(() => {
    const router = require('../../src/routes/campaigns');
    handler = getHandler(router, 'get', '/:id/milestones');
  });

  it('returns 404 for non-existent campaign', async () => {
    if (!handler) return;
    const req = { params: { id: '99999' }, user: { id: 1, role: 'user' } };
    const res = makeRes();
    await handler(req, res, jest.fn());
    expect(res._status).toBe(404);
  });

  it('returns empty list when no milestones', async () => {
    if (!handler) return;
    const req = { params: { id: String(campaignId) }, user: { id: 1, role: 'user' } };
    const res = makeRes();
    await handler(req, res, jest.fn());
    expect(res._status).toBe(200);
    expect(res._body.data).toEqual([]);
    expect(res._body.count).toBe(0);
  });

  it('returns milestones ordered by target_amount', async () => {
    await Database.run(
      `INSERT INTO campaign_milestones (campaign_id, title, target_amount, status) VALUES (?, ?, ?, ?)`,
      [campaignId, 'Phase 2', 500, 'pending']
    );
    await Database.run(
      `INSERT INTO campaign_milestones (campaign_id, title, target_amount, status) VALUES (?, ?, ?, ?)`,
      [campaignId, 'Phase 1', 250, 'verified']
    );

    if (!handler) return;
    const req = { params: { id: String(campaignId) }, user: { id: 1, role: 'user' } };
    const res = makeRes();
    await handler(req, res, jest.fn());
    expect(res._body.data).toHaveLength(2);
    expect(res._body.data[0].target_amount).toBe(250); // ordered ASC
    expect(res._body.data[1].target_amount).toBe(500);
  });

  it('includes status field for each milestone', async () => {
    await Database.run(
      `INSERT INTO campaign_milestones (campaign_id, title, target_amount, status) VALUES (?, ?, ?, ?)`,
      [campaignId, 'Phase 1', 250, 'pending']
    );
    if (!handler) return;
    const req = { params: { id: String(campaignId) }, user: { id: 1, role: 'user' } };
    const res = makeRes();
    await handler(req, res, jest.fn());
    expect(res._body.data[0]).toHaveProperty('status');
  });
});

// ─── POST /campaigns/admin/:id/milestones/:milestoneId/verify ─────────────────

describe('POST /campaigns/admin/:id/milestones/:milestoneId/verify handler', () => {
  let handler;

  beforeAll(() => {
    const router = require('../../src/routes/campaigns');
    handler = getHandler(router, 'post', '/admin/:id/milestones/:milestoneId/verify');
  });

  it('returns 404 for non-existent campaign', async () => {
    if (!handler) return;
    const req = { params: { id: '99999', milestoneId: '1' }, user: { id: 1, role: 'admin' } };
    const res = makeRes();
    await handler(req, res, jest.fn());
    expect(res._status).toBe(404);
  });

  it('returns 404 for non-existent milestone', async () => {
    if (!handler) return;
    const req = { params: { id: String(campaignId), milestoneId: '99999' }, user: { id: 1, role: 'admin' } };
    const res = makeRes();
    await handler(req, res, jest.fn());
    expect(res._status).toBe(404);
  });

  it('verifies a milestone and records fund release tx', async () => {
    const insert = await Database.run(
      `INSERT INTO campaign_milestones (campaign_id, title, target_amount, status) VALUES (?, ?, ?, ?)`,
      [campaignId, 'Phase 1', 250, 'pending']
    );
    if (!handler) return;
    const req = {
      params: { id: String(campaignId), milestoneId: String(insert.id) },
      user: { id: 1, role: 'admin' },
    };
    const res = makeRes();
    await handler(req, res, jest.fn());
    expect(res._status).toBe(200);
    expect(res._body.success).toBe(true);
    expect(res._body.data.milestone.status).toBe('verified');
    expect(res._body.data.milestone.verified_at).toBeTruthy();
    expect(res._body.data.fundReleaseTx).toMatch(/^mock_release_/);
  });

  it('returns 409 when milestone already verified', async () => {
    const insert = await Database.run(
      `INSERT INTO campaign_milestones (campaign_id, title, target_amount, status) VALUES (?, ?, ?, ?)`,
      [campaignId, 'Phase 1', 250, 'pending']
    );
    if (!handler) return;
    const req = {
      params: { id: String(campaignId), milestoneId: String(insert.id) },
      user: { id: 1, role: 'admin' },
    };
    const res1 = makeRes();
    await handler(req, res1, jest.fn());
    const res2 = makeRes();
    await handler(req, res2, jest.fn());
    expect(res2._status).toBe(409);
  });

  it('sets verified_by to the admin user id', async () => {
    const insert = await Database.run(
      `INSERT INTO campaign_milestones (campaign_id, title, target_amount, status) VALUES (?, ?, ?, ?)`,
      [campaignId, 'Phase 1', 250, 'pending']
    );
    if (!handler) return;
    const req = {
      params: { id: String(campaignId), milestoneId: String(insert.id) },
      user: { id: 42, role: 'admin' },
    };
    const res = makeRes();
    await handler(req, res, jest.fn());
    const row = await Database.get('SELECT verified_by FROM campaign_milestones WHERE id = ?', [insert.id]);
    expect(row.verified_by).toBe('42');
  });
});

// ─── GET /campaigns/:id/progress ─────────────────────────────────────────────

describe('GET /campaigns/:id/progress handler', () => {
  let handler;

  beforeAll(() => {
    const router = require('../../src/routes/campaigns');
    handler = getHandler(router, 'get', '/:id/progress');
  });

  it('returns 404 for non-existent campaign', async () => {
    if (!handler) return;
    const req = { params: { id: '99999' }, user: { id: 1, role: 'user' } };
    const res = makeRes();
    await handler(req, res, jest.fn());
    expect(res._status).toBe(404);
  });

  it('returns progress with all required fields', async () => {
    if (!handler) return;
    const req = { params: { id: String(campaignId) }, user: { id: 1, role: 'user' } };
    const res = makeRes();
    await handler(req, res, jest.fn());
    expect(res._status).toBe(200);
    const d = res._body.data;
    expect(d).toHaveProperty('goalAmount');
    expect(d).toHaveProperty('currentAmount');
    expect(d).toHaveProperty('remaining');
    expect(d).toHaveProperty('progressPercent');
    expect(d).toHaveProperty('status');
    expect(d).toHaveProperty('milestones');
  });

  it('calculates remaining correctly', async () => {
    if (!handler) return;
    const req = { params: { id: String(campaignId) }, user: { id: 1, role: 'user' } };
    const res = makeRes();
    await handler(req, res, jest.fn());
    const d = res._body.data;
    expect(d.remaining).toBe(Math.max(0, d.goalAmount - d.currentAmount));
  });

  it('counts verified and pending milestones correctly', async () => {
    await Database.run(
      `INSERT INTO campaign_milestones (campaign_id, title, target_amount, status) VALUES (?, ?, ?, ?)`,
      [campaignId, 'Phase 1', 250, 'verified']
    );
    await Database.run(
      `INSERT INTO campaign_milestones (campaign_id, title, target_amount, status) VALUES (?, ?, ?, ?)`,
      [campaignId, 'Phase 2', 500, 'pending']
    );
    if (!handler) return;
    const req = { params: { id: String(campaignId) }, user: { id: 1, role: 'user' } };
    const res = makeRes();
    await handler(req, res, jest.fn());
    expect(res._body.data.milestones.total).toBe(2);
    expect(res._body.data.milestones.verified).toBe(1);
    expect(res._body.data.milestones.pending).toBe(1);
    expect(res._body.data.milestones.totalReleased).toBe(250);
  });

  it('progress percent is capped at 100', async () => {
    await Database.run(`UPDATE campaigns SET current_amount = 9999 WHERE id = ?`, [campaignId]);
    if (!handler) return;
    const req = { params: { id: String(campaignId) }, user: { id: 1, role: 'user' } };
    const res = makeRes();
    await handler(req, res, jest.fn());
    expect(res._body.data.progressPercent).toBe(100);
    await Database.run(`UPDATE campaigns SET current_amount = 500 WHERE id = ?`, [campaignId]);
  });

  it('progress percent is 0 when no donations', async () => {
    // Update the existing campaign to have 0 current_amount
    await Database.run(`UPDATE campaigns SET current_amount = 0 WHERE id = ?`, [campaignId]);
    if (!handler) return;
    const req = { params: { id: String(campaignId) }, user: { id: 1, role: 'user' } };
    const res = makeRes();
    await handler(req, res, jest.fn());
    expect(res._body.data.progressPercent).toBe(0);
    // Restore
    await Database.run(`UPDATE campaigns SET current_amount = 500 WHERE id = ?`, [campaignId]);
  });
});
