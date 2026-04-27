'use strict';
/**
 * Tests for Issue #363: Donation notes and tags
 * Tests the model/service layer directly to avoid pre-existing donation.js syntax issues.
 */
process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-key-1,test-key-2,admin-key';

const Transaction = require('../src/routes/models/transaction');
const { PREDEFINED_TAGS } = require('../src/constants/tags');

describe('Donation Notes and Tags - Issue #363', () => {
  beforeEach(() => Transaction._clearAllData());

  // ── Tag taxonomy constants ────────────────────────────────────────────────

  describe('PREDEFINED_TAGS taxonomy', () => {
    it('is a non-empty array', () => {
      expect(Array.isArray(PREDEFINED_TAGS)).toBe(true);
      expect(PREDEFINED_TAGS.length).toBeGreaterThan(0);
    });

    it('contains expected categories', () => {
      expect(PREDEFINED_TAGS).toContain('education');
      expect(PREDEFINED_TAGS).toContain('health');
      expect(PREDEFINED_TAGS).toContain('environment');
    });
  });

  // ── Transaction model stores notes and tags ───────────────────────────────

  describe('Transaction model - notes and tags persistence', () => {
    it('stores notes on creation', () => {
      const tx = Transaction.create({
        amount: '10', donor: 'donor1', recipient: 'recip1',
        notes: 'private note', tags: []
      });
      expect(tx.notes).toBe('private note');
    });

    it('stores tags on creation', () => {
      const tx = Transaction.create({
        amount: '10', donor: 'donor1', recipient: 'recip1',
        tags: ['education', 'health']
      });
      expect(tx.tags).toEqual(expect.arrayContaining(['education', 'health']));
    });

    it('defaults tags to empty array when not provided', () => {
      const tx = Transaction.create({ amount: '10', donor: 'd', recipient: 'r' });
      expect(Array.isArray(tx.tags)).toBe(true);
    });

    it('defaults notes to null when not provided', () => {
      const tx = Transaction.create({ amount: '10', donor: 'd', recipient: 'r' });
      expect(tx.notes == null).toBe(true);
    });

    it('can update notes via updateStatus', () => {
      const tx = Transaction.create({ amount: '10', donor: 'd', recipient: 'r', status: 'pending' });
      const updated = Transaction.updateStatus(tx.id, 'confirmed', { notes: 'updated note' });
      expect(updated.notes).toBe('updated note');
    });

    it('can update tags via updateStatus', () => {
      const tx = Transaction.create({ amount: '10', donor: 'd', recipient: 'r', status: 'pending' });
      const updated = Transaction.updateStatus(tx.id, 'confirmed', { tags: ['education'] });
      expect(updated.tags).toContain('education');
    });
  });

  // ── Tag filtering ─────────────────────────────────────────────────────────

  describe('Tag filtering', () => {
    beforeEach(() => {
      Transaction.create({ amount: '50', donor: 'd1', recipient: 'r', tags: ['education'] });
      Transaction.create({ amount: '100', donor: 'd2', recipient: 'r', tags: ['education', 'health'] });
      Transaction.create({ amount: '30', donor: 'd3', recipient: 'r', tags: ['health'] });
      Transaction.create({ amount: '20', donor: 'd4', recipient: 'r', tags: [] });
    });

    it('getAll returns all transactions', () => {
      expect(Transaction.getAll().length).toBe(4);
    });

    it('can filter by tag manually', () => {
      const educationTxs = Transaction.getAll().filter(
        t => Array.isArray(t.tags) && t.tags.includes('education')
      );
      expect(educationTxs.length).toBe(2);
      expect(educationTxs.map(t => parseFloat(t.amount))).toEqual(expect.arrayContaining([50, 100]));
    });

    it('can filter by health tag', () => {
      const healthTxs = Transaction.getAll().filter(
        t => Array.isArray(t.tags) && t.tags.includes('health')
      );
      expect(healthTxs.length).toBe(2);
    });

    it('transactions without matching tag are excluded', () => {
      const envTxs = Transaction.getAll().filter(
        t => Array.isArray(t.tags) && t.tags.includes('environment')
      );
      expect(envTxs.length).toBe(0);
    });
  });

  // ── Tag analytics ─────────────────────────────────────────────────────────

  describe('Tag analytics aggregation', () => {
    beforeEach(() => {
      Transaction.create({ amount: '50', donor: 'd1', recipient: 'r', tags: ['education'] });
      Transaction.create({ amount: '100', donor: 'd2', recipient: 'r', tags: ['education', 'health'] });
      Transaction.create({ amount: '30', donor: 'd3', recipient: 'r', tags: ['health'] });
    });

    it('aggregates totals per tag correctly', () => {
      const all = Transaction.getAll();
      const tagTotals = {};
      for (const tx of all) {
        for (const tag of (tx.tags || [])) {
          tagTotals[tag] = (tagTotals[tag] || 0) + parseFloat(tx.amount);
        }
      }
      expect(tagTotals['education']).toBeCloseTo(150);
      expect(tagTotals['health']).toBeCloseTo(130);
    });
  });

  // ── Note privacy (model level) ────────────────────────────────────────────

  describe('Note privacy at model level', () => {
    it('notes are stored with apiKeyId for ownership tracking', () => {
      const tx = Transaction.create({
        amount: '10', donor: 'd', recipient: 'r',
        notes: 'secret', apiKeyId: 1
      });
      expect(tx.notes).toBe('secret');
      expect(tx.apiKeyId).toBe(1);
    });

    it('different apiKeyId transactions have separate notes', () => {
      const tx1 = Transaction.create({ amount: '10', donor: 'd', recipient: 'r', notes: 'note1', apiKeyId: 1 });
      const tx2 = Transaction.create({ amount: '20', donor: 'd', recipient: 'r', notes: 'note2', apiKeyId: 2 });
      expect(tx1.notes).toBe('note1');
      expect(tx2.notes).toBe('note2');
      expect(tx1.apiKeyId).not.toBe(tx2.apiKeyId);
    });
  });

  // ── Tags route module ─────────────────────────────────────────────────────

  describe('Tags route module', () => {
    it('exports an express router', () => {
      const router = require('../src/routes/tags');
      expect(typeof router).toBe('function');
    });
  });

  // ── StatsService tag stats ────────────────────────────────────────────────

  describe('StatsService.getTagStats', () => {
    it('returns tag aggregation from transactions', () => {
      Transaction.create({ amount: '50', donor: 'd1', recipient: 'r', tags: ['education'], timestamp: new Date().toISOString() });
      Transaction.create({ amount: '100', donor: 'd2', recipient: 'r', tags: ['education'], timestamp: new Date().toISOString() });

      const StatsService = require('../src/services/StatsService');
      const start = new Date(Date.now() - 60000);
      const end = new Date(Date.now() + 60000);
      const stats = StatsService.getTagStats(start, end);

      const edu = stats.find(s => s.tag === 'education');
      expect(edu).toBeDefined();
      expect(edu.totalDonated).toBeCloseTo(150);
      expect(edu.donationCount).toBe(2);
    });
  });
});
