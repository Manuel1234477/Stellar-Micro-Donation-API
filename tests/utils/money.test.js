'use strict';
/**
 * tests/utils/money.test.js
 *
 * Unit tests for src/utils/money.js
 * Covers:
 *  - toStroops / fromStroops round-trip precision
 *  - Floating-point values that IEEE-754 gets wrong
 *  - calcFee: basic bps math, min clamp, max clamp, surge multiplier
 *  - Impact-report reconciliation: per-SDG subtotals sum exactly to grand total
 */

const {
  toStroops,
  fromStroops,
  calcFee,
  addStroops,
  subtractStroops,
  STROOPS_PER_XLM,
} = require('../../src/utils/money');

// ─── toStroops ────────────────────────────────────────────────────────────────

describe('toStroops', () => {
  test('converts integer XLM string', () => {
    expect(toStroops('1')).toBe(10_000_000n);
    expect(toStroops('10')).toBe(100_000_000n);
  });

  test('converts 7-decimal XLM string exactly', () => {
    expect(toStroops('1.0000001')).toBe(10_000_001n);
    expect(toStroops('0.0000001')).toBe(1n);
  });

  test('truncates beyond 7 decimal places', () => {
    // "0.10000005" — 8th decimal is truncated, not rounded
    expect(toStroops('0.10000005')).toBe(toStroops('0.1000000'));
  });

  test('handles float input with known IEEE-754 representation issues', () => {
    // 0.1 + 0.2 in float = 0.30000000000000004, but as a string "0.1" is exact
    const a = toStroops('0.1');   // 1_000_000n
    const b = toStroops('0.2');   // 2_000_000n
    expect(a + b).toBe(toStroops('0.3'));  // 3_000_000n — no drift
  });

  test('rejects negative value', () => {
    expect(() => toStroops('-1')).toThrow();
    expect(() => toStroops('-0.5')).toThrow();
  });

  test('rejects non-numeric string', () => {
    expect(() => toStroops('abc')).toThrow();
  });

  test('accepts numeric input (number type)', () => {
    expect(toStroops(1)).toBe(10_000_000n);
    expect(toStroops(0.5)).toBe(5_000_000n);
  });
});

// ─── fromStroops ──────────────────────────────────────────────────────────────

describe('fromStroops', () => {
  test('converts to 7-decimal string', () => {
    expect(fromStroops(10_000_000n)).toBe('1.0000000');
    expect(fromStroops(1n)).toBe('0.0000001');
    expect(fromStroops(0n)).toBe('0.0000000');
  });

  test('round-trips with toStroops', () => {
    const amounts = ['0.0000001', '1.2345678', '999.9999999', '0.1000000'];
    for (const amt of amounts) {
      expect(fromStroops(toStroops(amt))).toBe(amt);
    }
  });

  test('throws for non-bigint input', () => {
    expect(() => fromStroops(1000000)).toThrow();
    expect(() => fromStroops('1000000')).toThrow();
  });
});

// ─── addStroops / subtractStroops ─────────────────────────────────────────────

describe('addStroops / subtractStroops', () => {
  test('adds two stroop values', () => {
    expect(addStroops(1n, 2n)).toBe(3n);
    expect(addStroops(0n, 10_000_000n)).toBe(10_000_000n);
  });

  test('subtracts stroop values', () => {
    expect(subtractStroops(10_000_000n, 1n)).toBe(9_999_999n);
  });

  test('accumulates large number of small amounts without drift', () => {
    // 10,000,000 × 0.0000001 XLM = 1 XLM exactly
    const ONE_STROOP = 1n;
    let total = 0n;
    for (let i = 0; i < 10_000_000; i++) {
      total = addStroops(total, ONE_STROOP);
    }
    expect(total).toBe(STROOPS_PER_XLM);
    expect(fromStroops(total)).toBe('1.0000000');
  });
});

// ─── calcFee ─────────────────────────────────────────────────────────────────

describe('calcFee', () => {
  // 200 bps = 2 %
  const BPS_2PCT = 200n;

  test('basic 2% fee on 1 XLM = 0.02 XLM = 200_000 stroops', () => {
    const fee = calcFee(toStroops('1'), BPS_2PCT);
    expect(fee).toBe(200_000n);
    expect(fromStroops(fee)).toBe('0.0200000');
  });

  test('floors fractional stroop (platform favor)', () => {
    // 1 stroop × 200 bps / 10000 = 0.02 stroops → floor = 0
    expect(calcFee(1n, BPS_2PCT)).toBe(0n);

    // 5001 stroops × 200 / 10000 = 100.02 → floor = 100
    expect(calcFee(5001n, BPS_2PCT)).toBe(100n);
  });

  // ── minimum-fee clamp ────────────────────────────────────────────────────

  test('clamps to minFeeStroops when calculated fee is below minimum', () => {
    // Very small donation: 0.0000001 XLM = 1 stroop
    // 2% of 1 stroop = 0 (floor) → clamp to min = 100_000 stroops = 0.01 XLM
    const fee = calcFee(1n, BPS_2PCT, { minFeeStroops: 100_000n });
    expect(fee).toBe(100_000n);
  });

  test('does NOT clamp when fee exceeds minimum', () => {
    // 1 XLM donation, 2% = 200_000 stroops > 100_000 min
    const fee = calcFee(toStroops('1'), BPS_2PCT, { minFeeStroops: 100_000n });
    expect(fee).toBe(200_000n);
  });

  // ── maximum-fee clamp ────────────────────────────────────────────────────

  test('clamps to maxFeeStroops when calculated fee exceeds maximum', () => {
    // 1000 XLM × 2% = 20 XLM = 200_000_000 stroops → cap at 10 XLM = 100_000_000
    const fee = calcFee(toStroops('1000'), BPS_2PCT, { maxFeeStroops: 100_000_000n });
    expect(fee).toBe(100_000_000n);
  });

  test('does NOT clamp when fee is below maximum', () => {
    const fee = calcFee(toStroops('1'), BPS_2PCT, { maxFeeStroops: 100_000_000n });
    expect(fee).toBe(200_000n);
  });

  // ── min AND max both active ───────────────────────────────────────────────

  test('min and max clamp together without interference', () => {
    // fee = 50_000 stroops; min=100_000 → result 100_000 (still under max=200_000)
    const fee = calcFee(2_500_000n, BPS_2PCT, {
      minFeeStroops: 100_000n,
      maxFeeStroops: 200_000n,
    });
    expect(fee).toBe(100_000n);
  });

  // ── surge multiplier ─────────────────────────────────────────────────────

  test('surge multiplier 1.5× (15000 bps) doubles fee correctly', () => {
    // base bps = 200, surge = 15000 → effective = floor(200 * 15000 / 10000) = floor(300) = 300 bps
    // fee on 1 XLM = floor(10_000_000 * 300 / 10000) = 300_000
    const fee = calcFee(toStroops('1'), BPS_2PCT, { surgeMultiplierBps: 15000n });
    expect(fee).toBe(300_000n);
    expect(fromStroops(fee)).toBe('0.0300000');
  });

  test('surge multiplier 2× (20000 bps)', () => {
    // effective bps = floor(200 * 20000 / 10000) = 400 bps = 4%
    const fee = calcFee(toStroops('1'), BPS_2PCT, { surgeMultiplierBps: 20000n });
    expect(fee).toBe(400_000n);
  });

  test('surge multiplier with min clamp', () => {
    // 1 stroop, surge 2×, effective bps=400, fee=0 → clamp to min=100_000
    const fee = calcFee(1n, BPS_2PCT, {
      surgeMultiplierBps: 20000n,
      minFeeStroops: 100_000n,
    });
    expect(fee).toBe(100_000n);
  });

  test('throws for negative bps', () => {
    expect(() => calcFee(toStroops('1'), -1n)).toThrow();
  });

  test('throws for non-BigInt amountStroops', () => {
    expect(() => calcFee(1000000, 200n)).toThrow();
  });
});

// ─── Impact-report reconciliation ────────────────────────────────────────────

describe('impact report reconciliation', () => {
  /**
   * Simulate an SDG-breakdown scenario:
   *   - 3 SDG buckets, each receiving a set of donations
   *   - Grand total must equal the exact sum of per-SDG subtotals
   */
  test('per-SDG subtotals sum exactly to grand total (no drift)', () => {
    const sdgDonations = {
      sdg1: ['0.1', '0.2', '0.3'],           // = 0.6 XLM
      sdg2: ['0.0000001', '0.9999999'],       // = 1.0000000 XLM
      sdg3: ['100.1234567', '0.0000001'],     // = 100.1234568 XLM
    };

    const sdgTotals = {};
    let grandTotalStroops = 0n;

    for (const [sdg, amounts] of Object.entries(sdgDonations)) {
      let subtotalStroops = 0n;
      for (const amt of amounts) {
        subtotalStroops += toStroops(amt);
      }
      sdgTotals[sdg] = subtotalStroops;
      grandTotalStroops += subtotalStroops;
    }

    // Sub-totals summed independently must equal the grand total
    const sumOfSubtotals = Object.values(sdgTotals).reduce((acc, s) => acc + s, 0n);
    expect(sumOfSubtotals).toBe(grandTotalStroops);

    // Exact values
    expect(sdgTotals.sdg1).toBe(toStroops('0.6'));
    expect(sdgTotals.sdg2).toBe(toStroops('1.0000000'));
    expect(sdgTotals.sdg3).toBe(toStroops('100.1234568'));
  });

  test('large batch of small donations: no drift vs expected total', () => {
    // 1,000,000 donations of 0.0000001 XLM = exactly 0.1 XLM
    const AMOUNT = '0.0000001';
    const COUNT = 1_000_000;
    const expectedTotal = toStroops('0.1');

    let total = 0n;
    const stroop = toStroops(AMOUNT);
    for (let i = 0; i < COUNT; i++) {
      total += stroop;
    }

    expect(total).toBe(expectedTotal);
    expect(fromStroops(total)).toBe('0.1000000');
  });
});
