'use strict';

/**
 * Unit tests for:
 *   #1158 — validateXLMAmount (string-based, 7dp precision, positivity)
 *   #1159 — rounding policy reproducibility (roundHalfEven, convertToXLMWithMeta)
 */

const { validateXLMAmount, STROOPS_PER_XLM } = require('../../src/utils/validationHelpers');
const { roundHalfEven, convertToXLMWithMeta, ROUNDING_POLICY_VERSION } = require('../../src/utils/currencyConversion');

// ─── #1158: validateXLMAmount ────────────────────────────────────────────────

describe('validateXLMAmount (#1158)', () => {
  // Valid cases
  test('accepts integer string', () => {
    const r = validateXLMAmount('10');
    expect(r.valid).toBe(true);
    expect(r.xlm).toBe(10);
    expect(r.stroops).toBe(100_000_000);
  });

  test('accepts decimal string up to 7 dp', () => {
    const r = validateXLMAmount('1.2345678');
    // regex allows 1–7 dp; "1.2345678" is 7 dp
    expect(r.valid).toBe(true);
    expect(r.xlm).toBe(1.2345678);
    expect(r.stroops).toBe(12_345_678);
  });

  test('accepts numeric input', () => {
    const r = validateXLMAmount(5);
    expect(r.valid).toBe(true);
    expect(r.xlm).toBe(5);
  });

  test('returns stroops as integer', () => {
    const r = validateXLMAmount('0.0000001');
    expect(r.valid).toBe(true);
    expect(r.stroops).toBe(1);
  });

  // Acceptance criteria rejections
  test('rejects more than 7 decimal places', () => {
    const r = validateXLMAmount('1.00000001');
    expect(r.valid).toBe(false);
    expect(r.code).toBe('INVALID_AMOUNT_FORMAT');
  });

  test('rejects negative value string', () => {
    const r = validateXLMAmount('-1');
    expect(r.valid).toBe(false);
  });

  test('rejects zero', () => {
    const r = validateXLMAmount('0');
    expect(r.valid).toBe(false);
    expect(r.code).toBe('AMOUNT_TOO_LOW');
  });

  test('allows zero when allowZero=true', () => {
    expect(validateXLMAmount('0', { allowZero: true }).valid).toBe(true);
  });

  test('rejects scientific notation "1e3"', () => {
    expect(validateXLMAmount('1e3').valid).toBe(false);
  });

  test('rejects "NaN"', () => {
    expect(validateXLMAmount('NaN').valid).toBe(false);
  });

  test('rejects "Infinity"', () => {
    expect(validateXLMAmount('Infinity').valid).toBe(false);
  });

  test('rejects NaN number', () => {
    expect(validateXLMAmount(NaN).valid).toBe(false);
  });

  test('rejects Infinity number', () => {
    expect(validateXLMAmount(Infinity).valid).toBe(false);
  });

  test('rejects leading junk "  1.5abc"', () => {
    // trim removes spaces; abc makes regex fail
    expect(validateXLMAmount('1.5abc').valid).toBe(false);
  });

  test('rejects empty string', () => {
    expect(validateXLMAmount('').valid).toBe(false);
  });

  test('rejects null', () => {
    expect(validateXLMAmount(null).valid).toBe(false);
  });

  test('enforces min bound', () => {
    expect(validateXLMAmount('0.5', { min: 1 }).valid).toBe(false);
    expect(validateXLMAmount('1.0', { min: 1 }).valid).toBe(true);
  });

  test('enforces max bound', () => {
    expect(validateXLMAmount('10001', { max: 10000 }).valid).toBe(false);
    expect(validateXLMAmount('10000', { max: 10000 }).valid).toBe(true);
  });

  test('stroops match STROOPS_PER_XLM constant', () => {
    const r = validateXLMAmount('1');
    expect(r.stroops).toBe(STROOPS_PER_XLM);
  });
});

// ─── #1159: rounding policy ──────────────────────────────────────────────────

describe('roundHalfEven (#1159)', () => {
  test('rounds down when diff < 0.5', () => {
    expect(roundHalfEven(1.00000014, 7)).toBe(1.0000001);
  });

  test('rounds up when diff > 0.5', () => {
    expect(roundHalfEven(1.00000016, 7)).toBe(1.0000002);
  });

  test('rounds to even on exact half — even floor', () => {
    // floor digit is even → stay
    expect(roundHalfEven(1.0000002_5, 7)).toBe(1.0000002);
  });

  test('rounds to even on exact half — odd floor', () => {
    // floor digit is odd → round up to even
    expect(roundHalfEven(1.0000003_5, 7)).toBe(1.0000004);
  });

  test('handles integer input', () => {
    expect(roundHalfEven(5, 7)).toBe(5);
  });
});

describe('convertToXLMWithMeta (#1159)', () => {
  const RATE = 0.1; // 1 USD = 0.1 XLM

  test('converted XLM is reproducible from stored source + rate', () => {
    const meta = convertToXLMWithMeta(10, 'USD', RATE);
    // Reproduce: roundHalfEven(sourceAmount * rateXLMperUnit, 7)
    const reproduced = roundHalfEven(meta.sourceAmount * meta.rateXLMperUnit, 7);
    expect(reproduced).toBe(meta.xlm);
  });

  test('returns full provenance fields', () => {
    const meta = convertToXLMWithMeta(25, 'EUR', 0.09, '2026-01-01T00:00:00.000Z');
    expect(meta.sourceAmount).toBe(25);
    expect(meta.sourceCurrency).toBe('EUR');
    expect(meta.rateXLMperUnit).toBe(0.09);
    expect(meta.rateTimestamp).toBe('2026-01-01T00:00:00.000Z');
    expect(meta.roundingPolicy).toBe('ROUND_HALF_EVEN');
    expect(meta.policyVersion).toBe(ROUNDING_POLICY_VERSION);
  });

  test('stroops equal xlm * 10_000_000 rounded', () => {
    const meta = convertToXLMWithMeta(1, 'USD', 0.12345678);
    expect(meta.stroops).toBe(Math.round(meta.xlm * 10_000_000));
  });

  test('normalises currency to uppercase', () => {
    const meta = convertToXLMWithMeta(1, 'usd', 0.1);
    expect(meta.sourceCurrency).toBe('USD');
  });

  test('throws on non-positive rate', () => {
    expect(() => convertToXLMWithMeta(1, 'USD', 0)).toThrow();
    expect(() => convertToXLMWithMeta(1, 'USD', -0.1)).toThrow();
  });

  test('throws on negative source amount', () => {
    expect(() => convertToXLMWithMeta(-1, 'USD', 0.1)).toThrow();
  });

  test('same inputs always produce same output', () => {
    const a = convertToXLMWithMeta(7.5, 'USD', 0.13, '2026-06-01T00:00:00.000Z');
    const b = convertToXLMWithMeta(7.5, 'USD', 0.13, '2026-06-01T00:00:00.000Z');
    expect(a.xlm).toBe(b.xlm);
    expect(a.stroops).toBe(b.stroops);
  });
});
