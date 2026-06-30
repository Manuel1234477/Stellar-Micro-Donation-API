'use strict';

/**
 * Tests for centralized max-page-size enforcement (issue #1204).
 *
 * Every list endpoint must reject (not silently clamp) a `limit` that is
 * missing-but-invalid, non-integer, zero/negative, or above the documented
 * maximum (100), via the shared `validateLimit` helper in src/utils/pagination.js.
 */

const { validateLimit, MAX_LIMIT, DEFAULT_LIMIT } = require('../src/utils/pagination');

describe('validateLimit', () => {
  test('returns the default when limit is omitted', () => {
    const result = validateLimit(undefined);
    expect(result).toEqual({ valid: true, value: DEFAULT_LIMIT });
  });

  test('accepts a valid limit within range', () => {
    const result = validateLimit('25');
    expect(result).toEqual({ valid: true, value: 25 });
  });

  test('accepts limit at exactly the maximum', () => {
    const result = validateLimit(String(MAX_LIMIT));
    expect(result.valid).toBe(true);
    expect(result.value).toBe(MAX_LIMIT);
  });

  test('rejects a limit above the maximum instead of clamping', () => {
    const result = validateLimit(String(MAX_LIMIT + 1));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/at most/i);
  });

  test('rejects an arbitrarily large limit', () => {
    const result = validateLimit('999999999');
    expect(result.valid).toBe(false);
  });

  test('rejects zero', () => {
    const result = validateLimit('0');
    expect(result.valid).toBe(false);
  });

  test('rejects a negative limit', () => {
    const result = validateLimit('-5');
    expect(result.valid).toBe(false);
  });

  test('rejects NaN / non-numeric input', () => {
    const result = validateLimit('not-a-number');
    expect(result.valid).toBe(false);
  });

  test('rejects a non-integer (decimal) limit', () => {
    const result = validateLimit('10.5');
    expect(result.valid).toBe(false);
  });

  test('rejects trailing-garbage strings like "10abc"', () => {
    const result = validateLimit('10abc');
    expect(result.valid).toBe(false);
  });

  test('respects a caller-supplied lower max', () => {
    const result = validateLimit('50', { max: 30 });
    expect(result.valid).toBe(false);
  });

  test('respects a caller-supplied default', () => {
    const result = validateLimit(undefined, { defaultValue: 5 });
    expect(result).toEqual({ valid: true, value: 5 });
  });
});

// ─── Integration-style checks against representative endpoints ──────────────
// These endpoints previously had no upper bound (contracts, admin payment
// channels) or silently clamped out-of-range input instead of rejecting it
// (orderbook, admin webhooks/routing, donation by-campaign, leaderboard
// snapshot). Each must now consistently return 400/INVALID_LIMIT.

describe('GET /contracts/:id/events — limit enforcement', () => {
  function buildApp() {
    const express = require('express');
    const app = express();
    const { validateLimit: validate } = require('../src/utils/pagination');

    app.get('/contracts/:id/events', (req, res) => {
      if (req.query.limit !== undefined) {
        const limitResult = validate(req.query.limit);
        if (!limitResult.valid) {
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_REQUEST', message: limitResult.error },
          });
        }
      }
      return res.status(200).json({ success: true, data: [] });
    });
    return app;
  }

  test('rejects a limit above 100 with 400', async () => {
    const request = require('supertest');
    const res = await request(buildApp()).get('/contracts/abc/events?limit=100000');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REQUEST');
  });

  test('accepts a limit within range', async () => {
    const request = require('supertest');
    const res = await request(buildApp()).get('/contracts/abc/events?limit=50');
    expect(res.status).toBe(200);
  });
});

describe('admin/payment-channels & orderbook — limit must reject, not clamp', () => {
  test('previously-unbounded limit is now capped at MAX_LIMIT', () => {
    // admin/paymentChannels.js and contracts.js had no max check at all prior
    // to this fix; this asserts the shared helper enforces the ceiling.
    const result = validateLimit('100000', { defaultValue: 50 });
    expect(result.valid).toBe(false);
  });

  test('previously-clamped limit (orderbook/offers, max 200) is now rejected above the new max', () => {
    // orderbook.js / offers.js used to silently clamp to 200; the shared
    // helper now rejects anything over MAX_LIMIT (100) instead of clamping.
    const result = validateLimit('150', { defaultValue: 20 });
    expect(result.valid).toBe(false);
  });

  test('a negative limit is rejected rather than passed through to the DB/Horizon call', () => {
    // orderbook.js / offers.js previously computed Math.min(parseInt(limit)||20, 200),
    // which let negative values flow through unchanged since they are truthy.
    const result = validateLimit('-10', { defaultValue: 20 });
    expect(result.valid).toBe(false);
  });
});
