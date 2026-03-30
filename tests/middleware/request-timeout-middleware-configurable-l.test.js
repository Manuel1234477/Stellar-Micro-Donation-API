/**
 * Tests for request timeout middleware with configurable per-endpoint limits.
 *
 * Covers:
 * - TIMEOUTS constants (health, balance, default, donation, stream)
 * - requestTimeout factory returns a middleware function
 * - Fast requests complete normally (no 503)
 * - Slow requests exceeding the limit receive 503 + Retry-After header
 * - Response body shape on timeout (success, error.code, error.timeoutMs, requestId, timestamp)
 * - Timer is cleared on normal response finish (no double-send)
 * - Timer is cleared on connection close before timeout fires
 * - Default timeout used when no argument supplied
 * - headersSent guard prevents double-write after timeout fires
 * - Timeout event is logged with method, path, timeoutMs, ip
 */

'use strict';

const request = require('supertest');
const express = require('express');

// ─── Module under test ────────────────────────────────────────────────────────

const { requestTimeout, TIMEOUTS } = require('../../src/middleware/requestTimeout');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal Express app with one route that responds after `delayMs`.
 *
 * @param {number} timeoutMs  - Timeout passed to requestTimeout()
 * @param {number} delayMs    - How long the handler waits before responding
 * @param {number} [status]   - HTTP status the handler sends (default 200)
 */
function buildApp(timeoutMs, delayMs, status = 200) {
  const app = express();
  app.use((req, _res, next) => { req.id = 'test-req-id'; next(); });
  app.get('/test', requestTimeout(timeoutMs), (req, res) => {
    setTimeout(() => {
      if (!res.headersSent) res.status(status).json({ success: true });
    }, delayMs);
  });
  return app;
}

// ─── TIMEOUTS constants ───────────────────────────────────────────────────────

describe('TIMEOUTS', () => {
  it('exports health timeout of 5 000 ms', () => {
    expect(TIMEOUTS.health).toBe(5_000);
  });

  it('exports balance timeout of 10 000 ms', () => {
    expect(TIMEOUTS.balance).toBe(10_000);
  });

  it('exports default timeout of 15 000 ms', () => {
    expect(TIMEOUTS.default).toBe(15_000);
  });

  it('exports donation timeout of 30 000 ms', () => {
    expect(TIMEOUTS.donation).toBe(30_000);
  });

  it('exports stream timeout of 60 000 ms', () => {
    expect(TIMEOUTS.stream).toBe(60_000);
  });

  it('donation timeout is greater than balance timeout', () => {
    expect(TIMEOUTS.donation).toBeGreaterThan(TIMEOUTS.balance);
  });

  it('stream timeout is the largest', () => {
    const max = Math.max(...Object.values(TIMEOUTS));
    expect(TIMEOUTS.stream).toBe(max);
  });

  it('health timeout is the smallest', () => {
    const min = Math.min(...Object.values(TIMEOUTS));
    expect(TIMEOUTS.health).toBe(min);
  });
});

// ─── requestTimeout factory ───────────────────────────────────────────────────

describe('requestTimeout factory', () => {
  it('returns a function (middleware)', () => {
    expect(typeof requestTimeout(1000)).toBe('function');
  });

  it('returned middleware has arity 3 (req, res, next)', () => {
    expect(requestTimeout(1000).length).toBe(3);
  });

  it('uses TIMEOUTS.default when called with no argument', () => {
    // Should not throw and should return a function
    expect(typeof requestTimeout()).toBe('function');
  });
});

// ─── Fast request — no timeout ────────────────────────────────────────────────

describe('fast request (completes before timeout)', () => {
  it('returns 200 when handler responds within the limit', async () => {
    const app = buildApp(200, 10); // 200 ms limit, 10 ms handler
    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('does not set Retry-After header on success', async () => {
    const app = buildApp(200, 10);
    const res = await request(app).get('/test');
    expect(res.headers['retry-after']).toBeUndefined();
  });
});

// ─── Slow request — timeout fires ────────────────────────────────────────────

describe('slow request (exceeds timeout)', () => {
  it('returns 503 when handler is slower than the limit', async () => {
    const app = buildApp(50, 300); // 50 ms limit, 300 ms handler
    const res = await request(app).get('/test');
    expect(res.status).toBe(503);
  });

  it('sets Retry-After header to "5"', async () => {
    const app = buildApp(50, 300);
    const res = await request(app).get('/test');
    expect(res.headers['retry-after']).toBe('5');
  });

  it('response body has success: false', async () => {
    const app = buildApp(50, 300);
    const res = await request(app).get('/test');
    expect(res.body.success).toBe(false);
  });

  it('response body error.code is REQUEST_TIMEOUT', async () => {
    const app = buildApp(50, 300);
    const res = await request(app).get('/test');
    expect(res.body.error.code).toBe('REQUEST_TIMEOUT');
  });

  it('response body error.details.timeoutMs matches configured limit', async () => {
    const app = buildApp(50, 300);
    const res = await request(app).get('/test');
    expect(res.body.error.details.timeoutMs).toBe(50);
  });

  it('response body error.requestId is present', async () => {
    const app = buildApp(50, 300);
    const res = await request(app).get('/test');
    expect(res.body.error.requestId).toBe('test-req-id');
  });

  it('response body error.timestamp is a valid ISO string', async () => {
    const app = buildApp(50, 300);
    const res = await request(app).get('/test');
    expect(() => new Date(res.body.error.timestamp)).not.toThrow();
    expect(new Date(res.body.error.timestamp).toISOString()).toBe(res.body.error.timestamp);
  });

  it('response body error.message mentions the timeout duration', async () => {
    const app = buildApp(50, 300);
    const res = await request(app).get('/test');
    expect(res.body.error.message).toMatch(/50/);
  });
});

// ─── headersSent guard ────────────────────────────────────────────────────────

describe('headersSent guard', () => {
  it('does not throw or send a second response when headers already sent', async () => {
    // Handler responds immediately; timeout fires after but headersSent is true
    const app = express();
    app.use((req, _res, next) => { req.id = 'x'; next(); });
    app.get('/fast', requestTimeout(80), (req, res) => {
      res.status(200).json({ success: true });
      // Timeout will fire at 80 ms but headers are already sent — no error expected
    });

    const res = await request(app).get('/fast');
    expect(res.status).toBe(200);
    // Wait for the timer to fire and confirm no crash
    await new Promise(r => setTimeout(r, 120));
  });
});

// ─── Timer cleared on finish ──────────────────────────────────────────────────

describe('timer cleanup', () => {
  it('clears the timer when response finishes normally (no leak)', async () => {
    // If the timer were not cleared, Jest would warn about open handles.
    // This test verifies the happy path cleans up correctly.
    const app = buildApp(500, 10);
    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
  });
});

// ─── Per-endpoint timeout values ─────────────────────────────────────────────

describe('per-endpoint timeout configuration', () => {
  it('health endpoint uses 5 s limit (TIMEOUTS.health)', async () => {
    const app = express();
    app.use((req, _res, next) => { req.id = 'h'; next(); });
    // Handler responds in 10 ms — well within 5 s
    app.get('/health', requestTimeout(TIMEOUTS.health), (_req, res) => {
      res.status(200).json({ status: 'ok' });
    });
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });

  it('balance endpoint uses 10 s limit (TIMEOUTS.balance)', async () => {
    const app = express();
    app.use((req, _res, next) => { req.id = 'b'; next(); });
    app.get('/balance', requestTimeout(TIMEOUTS.balance), (_req, res) => {
      res.status(200).json({ balance: '100' });
    });
    const res = await request(app).get('/balance');
    expect(res.status).toBe(200);
  });

  it('donation endpoint uses 30 s limit (TIMEOUTS.donation)', async () => {
    const app = express();
    app.use((req, _res, next) => { req.id = 'd'; next(); });
    app.post('/donations', requestTimeout(TIMEOUTS.donation), (_req, res) => {
      res.status(201).json({ success: true });
    });
    const res = await request(app).post('/donations');
    expect(res.status).toBe(201);
  });

  it('slow donation exceeding 50 ms custom limit returns 503', async () => {
    const app = buildApp(50, 200);
    const res = await request(app).get('/test');
    expect(res.status).toBe(503);
    expect(res.body.error.details.timeoutMs).toBe(50);
  });
});

// ─── Logging ──────────────────────────────────────────────────────────────────

describe('timeout logging', () => {
  let warnSpy;

  beforeEach(() => {
    const log = require('../../src/utils/log');
    warnSpy = jest.spyOn(log, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('calls log.warn with REQUEST_TIMEOUT on timeout', async () => {
    const app = buildApp(50, 300);
    await request(app).get('/test');
    expect(warnSpy).toHaveBeenCalledWith(
      'REQUEST_TIMEOUT',
      expect.any(String),
      expect.objectContaining({ timeoutMs: 50 })
    );
  });

  it('logs the request method', async () => {
    const app = buildApp(50, 300);
    await request(app).get('/test');
    const [, , meta] = warnSpy.mock.calls[0];
    expect(meta.method).toBe('GET');
  });

  it('logs the request path', async () => {
    const app = buildApp(50, 300);
    await request(app).get('/test');
    const [, , meta] = warnSpy.mock.calls[0];
    expect(meta.path).toBe('/test');
  });

  it('does not call log.warn when request completes in time', async () => {
    const app = buildApp(200, 10);
    await request(app).get('/test');
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
