'use strict';

const express = require('express');
const request = require('supertest');
const Transaction = require('../../src/routes/models/transaction');
const Wallet = require('../../src/routes/models/wallet');
const LeaderboardSSE = require('../../src/services/LeaderboardSSE');
const { TRANSACTION_STATES } = require('../../src/utils/transactionStateMachine');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function confirmedTx(donor, recipient, amount, daysAgo = 0) {
  const ts = new Date();
  ts.setDate(ts.getDate() - daysAgo);
  return Transaction.create({
    donor, recipient, amount,
    status: TRANSACTION_STATES.CONFIRMED,
    timestamp: ts.toISOString(),
  });
}

function buildApp() {
  const app = express();
  app.use(express.json());

  // snapshot
  app.get('/leaderboard/snapshot', (req, res) => {
    const window = req.query.window || 'all-time';
    if (!LeaderboardSSE.WINDOWS.includes(window)) {
      return res.status(400).json({ success: false, error: { message: `window must be one of: ${LeaderboardSSE.WINDOWS.join(', ')}` } });
    }
    const limit = parseInt(req.query.limit, 10) || 10;
    res.json({ success: true, data: LeaderboardSSE.getSnapshot(window, limit) });
  });

  // stream (SSE)
  app.get('/leaderboard/stream', (req, res) => {
    const window = req.query.window || 'all-time';
    if (!LeaderboardSSE.WINDOWS.includes(window)) {
      return res.status(400).json({ success: false, error: { message: 'invalid window' } });
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    const snapshot = LeaderboardSSE.getSnapshot(window);
    res.write(`data: ${JSON.stringify({ type: 'rank_change', window, donors: snapshot.donors, recipients: snapshot.recipients })}\n\n`);
    res.end();
  });

  // leaderboard-visibility
  app.patch('/wallets/:id/leaderboard-visibility', (req, res) => {
    const { visible } = req.body || {};
    if (typeof visible !== 'boolean') {
      return res.status(400).json({ success: false, error: { message: "'visible' must be a boolean" } });
    }
    const wallet = Wallet.getById(parseInt(req.params.id, 10));
    if (!wallet) return res.status(404).json({ success: false, error: { message: 'Wallet not found' } });
    const updated = Wallet.update(wallet.id, { leaderboard_visibility: visible });
    res.json({ success: true, data: { id: updated.id, leaderboard_visibility: updated.leaderboard_visibility } });
  });

  return app;
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  Transaction._clearAllData();
  Wallet._clearAllData();
  // Clear leaderboard cache between tests
  const StatsService = require('../../src/routes/services/StatsService');
  StatsService.invalidateLeaderboardCache();
});

// ─── WINDOWS constant ─────────────────────────────────────────────────────────

describe('WINDOWS', () => {
  it('includes daily, weekly, and all-time', () => {
    expect(LeaderboardSSE.WINDOWS).toContain('daily');
    expect(LeaderboardSSE.WINDOWS).toContain('weekly');
    expect(LeaderboardSSE.WINDOWS).toContain('all-time');
  });
});

// ─── computeLeaderboard ───────────────────────────────────────────────────────

describe('computeLeaderboard', () => {
  it('returns donors and recipients for all-time window', () => {
    confirmedTx('alice', 'charity1', 10);
    confirmedTx('bob', 'charity1', 5);
    const result = LeaderboardSSE.computeLeaderboard('all-time');
    expect(result.window).toBe('all-time');
    expect(Array.isArray(result.donors)).toBe(true);
    expect(Array.isArray(result.recipients)).toBe(true);
  });

  it('returns donors and recipients for daily window', () => {
    confirmedTx('alice', 'charity1', 10, 0); // today
    confirmedTx('bob', 'charity1', 5, 2);    // 2 days ago — outside daily window
    const StatsService = require('../../src/routes/services/StatsService');
    StatsService.invalidateLeaderboardCache();
    const result = LeaderboardSSE.computeLeaderboard('daily');
    expect(result.window).toBe('daily');
    // alice should appear, bob should not (outside window)
    const donorNames = result.donors.map(d => d.donor);
    expect(donorNames).toContain('alice');
  });

  it('returns donors and recipients for weekly window', () => {
    confirmedTx('alice', 'charity1', 10, 3); // 3 days ago — within weekly
    const StatsService = require('../../src/routes/services/StatsService');
    StatsService.invalidateLeaderboardCache();
    const result = LeaderboardSSE.computeLeaderboard('weekly');
    expect(result.window).toBe('weekly');
    const donorNames = result.donors.map(d => d.donor);
    expect(donorNames).toContain('alice');
  });

  it('throws for an invalid window', () => {
    expect(() => LeaderboardSSE.computeLeaderboard('monthly')).toThrow(/Invalid window/);
  });

  it('anonymizes opted-out donors', () => {
    const wallet = Wallet.create({ address: 'alice' });
    Wallet.update(wallet.id, { leaderboard_visibility: false });
    confirmedTx('alice', 'charity1', 10);
    const StatsService = require('../../src/routes/services/StatsService');
    StatsService.invalidateLeaderboardCache();
    const result = LeaderboardSSE.computeLeaderboard('all-time');
    const donorNames = result.donors.map(d => d.donor);
    expect(donorNames).not.toContain('alice');
    expect(donorNames).toContain(LeaderboardSSE.ANON_NAME);
  });

  it('anonymizes opted-out recipients', () => {
    const wallet = Wallet.create({ address: 'charity1' });
    Wallet.update(wallet.id, { leaderboard_visibility: false });
    confirmedTx('alice', 'charity1', 10);
    const StatsService = require('../../src/routes/services/StatsService');
    StatsService.invalidateLeaderboardCache();
    const result = LeaderboardSSE.computeLeaderboard('all-time');
    const recipientNames = result.recipients.map(r => r.recipient);
    expect(recipientNames).not.toContain('charity1');
    expect(recipientNames).toContain(LeaderboardSSE.ANON_NAME);
  });

  it('does not anonymize opted-in donors', () => {
    const wallet = Wallet.create({ address: 'alice' });
    Wallet.update(wallet.id, { leaderboard_visibility: true });
    confirmedTx('alice', 'charity1', 10);
    const StatsService = require('../../src/routes/services/StatsService');
    StatsService.invalidateLeaderboardCache();
    const result = LeaderboardSSE.computeLeaderboard('all-time');
    expect(result.donors.map(d => d.donor)).toContain('alice');
  });
});

// ─── getSnapshot ──────────────────────────────────────────────────────────────

describe('getSnapshot', () => {
  it('returns generatedAt timestamp', () => {
    const snap = LeaderboardSSE.getSnapshot('all-time');
    expect(snap.generatedAt).toBeDefined();
    expect(new Date(snap.generatedAt).getTime()).not.toBeNaN();
  });

  it('returns correct window field', () => {
    expect(LeaderboardSSE.getSnapshot('daily').window).toBe('daily');
    expect(LeaderboardSSE.getSnapshot('weekly').window).toBe('weekly');
    expect(LeaderboardSSE.getSnapshot('all-time').window).toBe('all-time');
  });
});

// ─── GET /leaderboard/snapshot ────────────────────────────────────────────────

describe('GET /leaderboard/snapshot', () => {
  const app = buildApp();

  it('returns 200 for all-time window', async () => {
    const res = await request(app).get('/leaderboard/snapshot?window=all-time');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.window).toBe('all-time');
    expect(Array.isArray(res.body.data.donors)).toBe(true);
    expect(Array.isArray(res.body.data.recipients)).toBe(true);
  });

  it('returns 200 for daily window', async () => {
    const res = await request(app).get('/leaderboard/snapshot?window=daily');
    expect(res.status).toBe(200);
    expect(res.body.data.window).toBe('daily');
  });

  it('returns 200 for weekly window', async () => {
    const res = await request(app).get('/leaderboard/snapshot?window=weekly');
    expect(res.status).toBe(200);
    expect(res.body.data.window).toBe('weekly');
  });

  it('returns 400 for invalid window', async () => {
    const res = await request(app).get('/leaderboard/snapshot?window=monthly');
    expect(res.status).toBe(400);
  });

  it('anonymizes opted-out donors in snapshot', async () => {
    const wallet = Wallet.create({ address: 'alice' });
    Wallet.update(wallet.id, { leaderboard_visibility: false });
    confirmedTx('alice', 'charity1', 10);
    const StatsService = require('../../src/routes/services/StatsService');
    StatsService.invalidateLeaderboardCache();
    const res = await request(app).get('/leaderboard/snapshot?window=all-time');
    const names = res.body.data.donors.map(d => d.donor);
    expect(names).not.toContain('alice');
    expect(names).toContain(LeaderboardSSE.ANON_NAME);
  });
});

// ─── GET /leaderboard/stream ──────────────────────────────────────────────────

describe('GET /leaderboard/stream', () => {
  const app = buildApp();

  it('returns SSE content-type', async () => {
    const res = await request(app).get('/leaderboard/stream?window=all-time');
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
  });

  it('sends initial rank_change event', async () => {
    confirmedTx('alice', 'charity1', 10);
    const StatsService = require('../../src/routes/services/StatsService');
    StatsService.invalidateLeaderboardCache();
    const res = await request(app).get('/leaderboard/stream?window=all-time');
    const parsed = JSON.parse(res.text.replace(/^data: /, '').trim());
    expect(parsed.type).toBe('rank_change');
    expect(parsed.window).toBe('all-time');
    expect(Array.isArray(parsed.donors)).toBe(true);
  });

  it('returns 400 for invalid window', async () => {
    const res = await request(app).get('/leaderboard/stream?window=monthly');
    expect(res.status).toBe(400);
  });

  it('defaults to all-time when window not specified', async () => {
    const res = await request(app).get('/leaderboard/stream');
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    const parsed = JSON.parse(res.text.replace(/^data: /, '').trim());
    expect(parsed.window).toBe('all-time');
  });
});

// ─── PATCH /wallets/:id/leaderboard-visibility ────────────────────────────────

describe('PATCH /wallets/:id/leaderboard-visibility', () => {
  const app = buildApp();

  it('sets leaderboard_visibility to false (opt out)', async () => {
    const wallet = Wallet.create({ address: 'alice' });
    const res = await request(app)
      .patch(`/wallets/${wallet.id}/leaderboard-visibility`)
      .send({ visible: false });
    expect(res.status).toBe(200);
    expect(res.body.data.leaderboard_visibility).toBe(false);
  });

  it('sets leaderboard_visibility to true (opt in)', async () => {
    const wallet = Wallet.create({ address: 'alice' });
    Wallet.update(wallet.id, { leaderboard_visibility: false });
    const res = await request(app)
      .patch(`/wallets/${wallet.id}/leaderboard-visibility`)
      .send({ visible: true });
    expect(res.status).toBe(200);
    expect(res.body.data.leaderboard_visibility).toBe(true);
  });

  it('returns 400 when visible is not a boolean', async () => {
    const wallet = Wallet.create({ address: 'alice' });
    const res = await request(app)
      .patch(`/wallets/${wallet.id}/leaderboard-visibility`)
      .send({ visible: 'yes' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown wallet', async () => {
    const res = await request(app)
      .patch('/wallets/99999/leaderboard-visibility')
      .send({ visible: false });
    expect(res.status).toBe(404);
  });

  it('opted-out wallet is anonymized in subsequent leaderboard', async () => {
    const wallet = Wallet.create({ address: 'alice' });
    confirmedTx('alice', 'charity1', 10);
    const StatsService = require('../../src/routes/services/StatsService');
    StatsService.invalidateLeaderboardCache();

    await request(app)
      .patch(`/wallets/${wallet.id}/leaderboard-visibility`)
      .send({ visible: false });

    StatsService.invalidateLeaderboardCache();
    const snap = LeaderboardSSE.getSnapshot('all-time');
    expect(snap.donors.map(d => d.donor)).not.toContain('alice');
    expect(snap.donors.map(d => d.donor)).toContain(LeaderboardSSE.ANON_NAME);
  });
});
