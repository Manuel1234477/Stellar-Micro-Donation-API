'use strict';

/**
 * Tests: GeographicStrategy, HighestNeedStrategy, CampaignUrgencyStrategy
 *
 * Covers the three routing strategies that are not exercised by the existing
 * smart-donation-routing.test.js suite, matching its describe/it style.
 */

const GeographicStrategy = require('../../src/services/routing/GeographicStrategy');
const HighestNeedStrategy = require('../../src/services/routing/HighestNeedStrategy');
const CampaignUrgencyStrategy = require('../../src/services/routing/CampaignUrgencyStrategy');
const { ValidationError, BusinessLogicError } = require('../../src/utils/errors');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a lat/lon pair for a point that is approximately `km` kilometres north
 * of the origin (0°N, 0°E) — useful for constructing recipients at known distances.
 */
function coordsNorthOf(km) {
  // 1 degree of latitude ≈ 111.195 km
  return { latitude: km / 111.195, longitude: 0 };
}

// ─── GeographicStrategy ───────────────────────────────────────────────────────

describe('GeographicStrategy', () => {
  const strategy = new GeographicStrategy();

  it('selects the nearest recipient', () => {
    // near (~111 km north) and far (~555 km north)
    const pool = [
      { id: 'far',  ...coordsNorthOf(555) },
      { id: 'near', ...coordsNorthOf(111) },
    ];
    const { selectedId } = strategy.select(pool, { donorLat: 0, donorLon: 0 });
    expect(selectedId).toBe('near');
  });

  it('excludes recipients without coordinates', () => {
    const pool = [
      { id: 'no-coords', latitude: null, longitude: null },
      { id: 'has-coords', ...coordsNorthOf(100) },
    ];
    const { selectedId, excludedIds } = strategy.select(pool, { donorLat: 0, donorLon: 0 });
    expect(selectedId).toBe('has-coords');
    expect(excludedIds).toContain('no-coords');
  });

  it('excludes recipient with only latitude defined', () => {
    const pool = [
      { id: 'partial', latitude: 10, longitude: null },
      { id: 'full', ...coordsNorthOf(200) },
    ];
    const { selectedId, excludedIds } = strategy.select(pool, { donorLat: 0, donorLon: 0 });
    expect(selectedId).toBe('full');
    expect(excludedIds).toContain('partial');
  });

  it('excludes recipient with only longitude defined', () => {
    const pool = [
      { id: 'partial', latitude: null, longitude: 10 },
      { id: 'full', ...coordsNorthOf(50) },
    ];
    const { selectedId, excludedIds } = strategy.select(pool, { donorLat: 0, donorLon: 0 });
    expect(selectedId).toBe('full');
    expect(excludedIds).toContain('partial');
  });

  it('tiebreaks by lexicographically smallest id when distances are equal', () => {
    // Two recipients placed at exactly the same lat/lon → identical distance to donor.
    const sharedCoords = coordsNorthOf(100);
    const pool = [
      { id: 'bravo', ...sharedCoords },
      { id: 'alpha', ...sharedCoords },
    ];
    const { selectedId } = strategy.select(pool, { donorLat: 0, donorLon: 0 });
    expect(selectedId).toBe('alpha');
  });

  it('works when the donor is at (0, 0) and the nearest recipient is exactly at (0, 0)', () => {
    const pool = [
      { id: 'at-origin', latitude: 0, longitude: 0 },
      { id: 'far-away', ...coordsNorthOf(500) },
    ];
    const { selectedId } = strategy.select(pool, { donorLat: 0, donorLon: 0 });
    expect(selectedId).toBe('at-origin');
  });

  it('returns no excluded IDs when all recipients have coordinates', () => {
    const pool = [
      { id: 'A', ...coordsNorthOf(10) },
      { id: 'B', ...coordsNorthOf(20) },
    ];
    const { excludedIds } = strategy.select(pool, { donorLat: 0, donorLon: 0 });
    expect(excludedIds).toEqual([]);
  });

  it('throws ValidationError when donor latitude is missing', () => {
    const pool = [{ id: 'r1', ...coordsNorthOf(100) }];
    expect(() => strategy.select(pool, { donorLat: null, donorLon: 0 }))
      .toThrow(ValidationError);
  });

  it('throws ValidationError when donor longitude is missing', () => {
    const pool = [{ id: 'r1', ...coordsNorthOf(100) }];
    expect(() => strategy.select(pool, { donorLat: 0, donorLon: null }))
      .toThrow(ValidationError);
  });

  it('throws ValidationError when both donor coordinates are missing', () => {
    const pool = [{ id: 'r1', ...coordsNorthOf(100) }];
    expect(() => strategy.select(pool, { donorLat: undefined, donorLon: undefined }))
      .toThrow(ValidationError);
  });

  it('throws BusinessLogicError when no recipient has coordinates', () => {
    const pool = [
      { id: 'r1', latitude: null, longitude: null },
      { id: 'r2', latitude: null, longitude: null },
    ];
    expect(() => strategy.select(pool, { donorLat: 0, donorLon: 0 }))
      .toThrow(BusinessLogicError);
  });

  it('throws BusinessLogicError on empty pool', () => {
    expect(() => strategy.select([], { donorLat: 0, donorLon: 0 }))
      .toThrow(BusinessLogicError);
  });

  it('handles a single eligible recipient', () => {
    const pool = [{ id: 'only', ...coordsNorthOf(300) }];
    const { selectedId, excludedIds } = strategy.select(pool, { donorLat: 0, donorLon: 0 });
    expect(selectedId).toBe('only');
    expect(excludedIds).toEqual([]);
  });

  it('handles a mix of eligible and ineligible recipients, picking nearest eligible', () => {
    const pool = [
      { id: 'no-coords-1', latitude: null, longitude: null },
      { id: 'close',       ...coordsNorthOf(50)  },
      { id: 'no-coords-2', latitude: null, longitude: null },
      { id: 'medium',      ...coordsNorthOf(200) },
    ];
    const { selectedId, excludedIds } = strategy.select(pool, { donorLat: 0, donorLon: 0 });
    expect(selectedId).toBe('close');
    expect(excludedIds).toContain('no-coords-1');
    expect(excludedIds).toContain('no-coords-2');
    expect(excludedIds).not.toContain('close');
  });
});

// ─── HighestNeedStrategy ──────────────────────────────────────────────────────

describe('HighestNeedStrategy', () => {
  const strategy = new HighestNeedStrategy();

  it('selects the recipient with the lowest total donations', () => {
    const pool = [
      { id: 'rich',  },
      { id: 'poor',  },
      { id: 'mid',   },
    ];
    const donationTotals = new Map([
      ['rich', 1000],
      ['poor', 10],
      ['mid',  500],
    ]);
    const { selectedId } = strategy.select(pool, { donationTotals });
    expect(selectedId).toBe('poor');
  });

  it('treats missing totals as 0 (most needy)', () => {
    const pool = [{ id: 'has-total' }, { id: 'no-total' }];
    const donationTotals = new Map([['has-total', 5]]);
    const { selectedId } = strategy.select(pool, { donationTotals });
    // 'no-total' defaults to 0 which is less than 5
    expect(selectedId).toBe('no-total');
  });

  it('tiebreaks by lexicographically smallest id when totals are equal', () => {
    const pool = [{ id: 'zebra' }, { id: 'apple' }, { id: 'mango' }];
    const donationTotals = new Map([
      ['zebra', 100],
      ['apple', 100],
      ['mango', 100],
    ]);
    const { selectedId } = strategy.select(pool, { donationTotals });
    expect(selectedId).toBe('apple');
  });

  it('tiebreaks correctly when totals are equal and ids are numeric strings', () => {
    const pool = [{ id: '20' }, { id: '3' }, { id: '10' }];
    // All equal totals; lex order: '10' < '20' < '3'
    const donationTotals = new Map([['20', 50], ['3', 50], ['10', 50]]);
    const { selectedId } = strategy.select(pool, { donationTotals });
    expect(selectedId).toBe('10');
  });

  it('never throws even on empty pool', () => {
    const donationTotals = new Map();
    expect(() => strategy.select([], { donationTotals })).not.toThrow();
    const { selectedId } = strategy.select([], { donationTotals });
    expect(selectedId).toBeNull();
  });

  it('returns no excluded IDs', () => {
    const pool = [{ id: 'A' }, { id: 'B' }];
    const donationTotals = new Map([['A', 10], ['B', 20]]);
    const { excludedIds } = strategy.select(pool, { donationTotals });
    expect(excludedIds).toEqual([]);
  });

  it('works with a single recipient', () => {
    const pool = [{ id: 'ONLY' }];
    const donationTotals = new Map([['ONLY', 42]]);
    const { selectedId } = strategy.select(pool, { donationTotals });
    expect(selectedId).toBe('ONLY');
  });

  it('works when all recipients have a total of 0', () => {
    const pool = [{ id: 'c' }, { id: 'a' }, { id: 'b' }];
    const donationTotals = new Map([['c', 0], ['a', 0], ['b', 0]]);
    // All tied at 0 — lex smallest should win
    const { selectedId } = strategy.select(pool, { donationTotals });
    expect(selectedId).toBe('a');
  });

  it('selects the correct winner when needy recipient is not first in list', () => {
    const pool = [
      { id: 'wealthy' },
      { id: 'moderate' },
      { id: 'needy' },
    ];
    const donationTotals = new Map([
      ['wealthy', 9999],
      ['moderate', 500],
      ['needy', 1],
    ]);
    expect(strategy.select(pool, { donationTotals }).selectedId).toBe('needy');
  });
});

// ─── CampaignUrgencyStrategy ──────────────────────────────────────────────────

describe('CampaignUrgencyStrategy', () => {
  const strategy = new CampaignUrgencyStrategy();

  // Fixed reference time for all tests
  const NOW = new Date('2025-06-15T12:00:00.000Z');
  const future1h  = new Date(NOW.getTime() + 1 * 60 * 60 * 1000).toISOString(); // 1 hour ahead
  const future24h = new Date(NOW.getTime() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours ahead
  const future72h = new Date(NOW.getTime() + 72 * 60 * 60 * 1000).toISOString(); // 72 hours ahead
  const past1h    = new Date(NOW.getTime() - 1 * 60 * 60 * 1000).toISOString();  // 1 hour ago

  it('selects the recipient with the nearest future deadline', () => {
    const pool = [
      { id: 'urgent', campaignDeadline: future1h  },
      { id: 'soon',   campaignDeadline: future24h },
      { id: 'later',  campaignDeadline: future72h },
    ];
    const { selectedId } = strategy.select(pool, { now: NOW });
    expect(selectedId).toBe('urgent');
  });

  it('excludes recipients whose deadline has already passed', () => {
    const pool = [
      { id: 'expired', campaignDeadline: past1h   },
      { id: 'active',  campaignDeadline: future1h },
    ];
    const { selectedId, excludedIds } = strategy.select(pool, { now: NOW });
    expect(selectedId).toBe('active');
    expect(excludedIds).toContain('expired');
  });

  it('excludes recipients with no deadline set (null)', () => {
    const pool = [
      { id: 'no-deadline', campaignDeadline: null     },
      { id: 'has-deadline', campaignDeadline: future24h },
    ];
    const { selectedId, excludedIds } = strategy.select(pool, { now: NOW });
    expect(selectedId).toBe('has-deadline');
    expect(excludedIds).toContain('no-deadline');
  });

  it('excludes recipients with no deadline set (undefined)', () => {
    const pool = [
      { id: 'no-deadline'  },
      { id: 'has-deadline', campaignDeadline: future24h },
    ];
    const { selectedId, excludedIds } = strategy.select(pool, { now: NOW });
    expect(selectedId).toBe('has-deadline');
    expect(excludedIds).toContain('no-deadline');
  });

  it('tiebreaks by lexicographically smallest id when deadlines are identical', () => {
    const sharedDeadline = future24h;
    const pool = [
      { id: 'zulu',  campaignDeadline: sharedDeadline },
      { id: 'alpha', campaignDeadline: sharedDeadline },
      { id: 'mike',  campaignDeadline: sharedDeadline },
    ];
    const { selectedId } = strategy.select(pool, { now: NOW });
    expect(selectedId).toBe('alpha');
  });

  it('throws BusinessLogicError when all deadlines have passed', () => {
    const pool = [
      { id: 'r1', campaignDeadline: past1h },
      { id: 'r2', campaignDeadline: new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString() },
    ];
    expect(() => strategy.select(pool, { now: NOW })).toThrow(BusinessLogicError);
  });

  it('throws BusinessLogicError when all recipients have no deadline', () => {
    const pool = [
      { id: 'r1', campaignDeadline: null },
      { id: 'r2' },
    ];
    expect(() => strategy.select(pool, { now: NOW })).toThrow(BusinessLogicError);
  });

  it('throws BusinessLogicError on empty pool', () => {
    expect(() => strategy.select([], { now: NOW })).toThrow(BusinessLogicError);
  });

  it('handles a mix: some expired, some missing, one active — picks the active one', () => {
    const pool = [
      { id: 'expired',     campaignDeadline: past1h  },
      { id: 'no-deadline', campaignDeadline: null    },
      { id: 'active',      campaignDeadline: future1h },
    ];
    const { selectedId, excludedIds } = strategy.select(pool, { now: NOW });
    expect(selectedId).toBe('active');
    expect(excludedIds).toContain('expired');
    expect(excludedIds).toContain('no-deadline');
    expect(excludedIds).not.toContain('active');
  });

  it('works with a single active recipient', () => {
    const pool = [{ id: 'ONLY', campaignDeadline: future24h }];
    const { selectedId } = strategy.select(pool, { now: NOW });
    expect(selectedId).toBe('ONLY');
  });

  it('returns no excluded IDs when all recipients are active', () => {
    const pool = [
      { id: 'A', campaignDeadline: future1h  },
      { id: 'B', campaignDeadline: future24h },
    ];
    const { excludedIds } = strategy.select(pool, { now: NOW });
    expect(excludedIds).toEqual([]);
  });

  it('accepts now as a string (ISO) as well as a Date object', () => {
    const pool = [{ id: 'r1', campaignDeadline: future24h }];
    const resultWithDate   = strategy.select(pool, { now: NOW });
    const resultWithString = strategy.select(pool, { now: NOW.toISOString() });
    expect(resultWithDate.selectedId).toBe(resultWithString.selectedId);
  });

  it('selects closest deadline when nearest recipient is not first in list', () => {
    const pool = [
      { id: 'later',   campaignDeadline: future72h },
      { id: 'medium',  campaignDeadline: future24h },
      { id: 'urgentX', campaignDeadline: future1h  },
    ];
    const { selectedId } = strategy.select(pool, { now: NOW });
    expect(selectedId).toBe('urgentX');
  });
});
