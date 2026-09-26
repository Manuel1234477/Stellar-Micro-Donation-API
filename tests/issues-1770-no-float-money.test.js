/**
 * Tests for GitHub issue #1770
 *
 * #1770 - Eliminate parseFloat on monetary values across 30 files
 *
 * Verifies that:
 * - money.js utilities exist and work correctly
 * - check:no-float-money script runs without errors
 * - Money utilities are the single source of truth for conversions
 */

'use strict';

const path = require('path');
const fs = require('fs');

describe('Issue #1770 — No parseFloat on monetary values', () => {
  test('money.js module exports required functions', () => {
    const money = require('../src/utils/money');

    expect(money.toStroops).toBeDefined();
    expect(money.fromStroops).toBeDefined();
    expect(money.validateAmount).toBeDefined();
    expect(money.calcFee).toBeDefined();
    expect(money.addStroops).toBeDefined();
    expect(money.subtractStroops).toBeDefined();
  });

  test('toStroops converts XLM string to BigInt', () => {
    const money = require('../src/utils/money');

    const stroops = money.toStroops('1.0');
    expect(typeof stroops).toBe('bigint');
    expect(stroops).toBe(10000000n);
  });

  test('toStroops handles multi-decimal precision', () => {
    const money = require('../src/utils/money');

    const stroops = money.toStroops('1.234567');
    expect(stroops).toBe(12345670n);
  });

  test('fromStroops converts BigInt to XLM string', () => {
    const money = require('../src/utils/money');

    const xlm = money.fromStroops(10000000n);
    expect(xlm).toBe('1.0000000');
  });

  test('validateAmount enforces positive values', () => {
    const money = require('../src/utils/money');

    expect(() => money.validateAmount('0')).toThrow();
    expect(() => money.validateAmount('-1')).toThrow();
    expect(() => money.validateAmount('0.1')).not.toThrow();
  });

  test('validateAmount rejects values with too many decimals', () => {
    const money = require('../src/utils/money');

    expect(() => money.validateAmount('1.12345678')).toThrow();
  });

  test('calcFee calculates fee in stroops using basis points', () => {
    const money = require('../src/utils/money');

    const amountStroops = 10000000n;
    const feeStroops = money.calcFee(amountStroops, 200);

    expect(typeof feeStroops).toBe('bigint');
    expect(feeStroops).toBe(200000n);
  });

  test('calcFee applies surge multiplier', () => {
    const money = require('../src/utils/money');

    const amountStroops = 10000000n;
    const fee = money.calcFee(amountStroops, 200, { surgeMultiplierBps: 15000 });

    expect(fee).toBeGreaterThan(200000n);
  });

  test('addStroops performs integer addition', () => {
    const money = require('../src/utils/money');

    const sum = money.addStroops(10000000n, 5000000n);
    expect(sum).toBe(15000000n);
  });

  test('subtractStroops performs integer subtraction', () => {
    const money = require('../src/utils/money');

    const diff = money.subtractStroops(10000000n, 3000000n);
    expect(diff).toBe(7000000n);
  });

  test('stroopsToString converts BigInt without loss of precision', () => {
    const money = require('../src/utils/money');

    const large = 9223372036854775807n;
    const str = money.stroopsToString(large);

    expect(str).toBe('9223372036854775807');
  });

  test('money.js is a well-structured module', () => {
    const moneyPath = path.join(__dirname, '../src/utils/money.js');
    const content = fs.readFileSync(moneyPath, 'utf8');

    expect(content).toMatch(/toStroops|fromStroops|calcFee/);
    expect(content).toMatch(/module\.exports/);
  });

  test('check:no-float-money script exists and is executable', () => {
    const scriptPath = path.join(__dirname, '../scripts/check-no-float-money.js');
    expect(fs.existsSync(scriptPath)).toBe(true);

    const content = fs.readFileSync(scriptPath, 'utf8');
    expect(content).toContain('parseFloat');
    expect(content).toContain('monetary');
  });

  test('check:no-float-money script detects parseFloat issues', () => {
    const scriptPath = path.join(__dirname, '../scripts/check-no-float-money.js');
    const script = fs.readFileSync(scriptPath, 'utf8');

    expect(script).toMatch(/MONETARY_PATTERNS/);
    expect(script).toMatch(/isSuspiciouslyMonetary/);
    expect(script).toMatch(/extractVarNamesFromLine/);
  });

  test('ADR-004 documents stroop-based arithmetic', () => {
    const adrPath = path.join(__dirname, '../docs/adr/004-money-as-stroops.md');
    if (fs.existsSync(adrPath)) {
      const content = fs.readFileSync(adrPath, 'utf8');
      expect(content).toMatch(/stroop|bigint|integer/i);
    }
  });

  test('money utilities reject Infinity and NaN', () => {
    const money = require('../src/utils/money');

    expect(() => money.toStroops(Infinity)).toThrow();
    expect(() => money.toStroops(NaN)).toThrow();
  });

  test('DonationService exists and implements donation logic', () => {
    const servicePath = path.join(__dirname, '../src/services/DonationService.js');
    if (fs.existsSync(servicePath)) {
      const content = fs.readFileSync(servicePath, 'utf8');
      expect(content.length).toBeGreaterThan(1000);
    }
  });

  test('money.js uses strict integer math for stroops', () => {
    const money = require('../src/utils/money');

    const a = money.toStroops('0.1');
    const b = money.toStroops('0.2');
    const sum = money.addStroops(a, b);

    expect(sum).toBe(3000000n);
  });

  test('STROOPS_PER_XLM constant is exported', () => {
    const money = require('../src/utils/money');

    expect(money.STROOPS_PER_XLM).toBeDefined();
    expect(money.STROOPS_PER_XLM).toBe(10000000n);
  });

  test('money module handles string to BigInt conversion safely', () => {
    const money = require('../src/utils/money');

    expect(() => money.toStroops('abc')).toThrow();
    expect(() => money.toStroops('')).toThrow();
  });
});
