'use strict';

/**
 * #2110 — GET /stats/leaderboard must reject unbounded or invalid `limit`.
 */
const express = require('express');
const request = require('supertest');
const {
  parseStatsLimit,
  validateStatsLimit,
  STATS_DEFAULT_LIMIT,
  STATS_MAX_LIMIT,
} = require('../../src/routes/stats');

function buildApp() {
  const app = express();
  app.get('/leaderboard', validateStatsLimit, (req, res) => {
    res.json({ success: true, limit: req.statsLimit });
  });
  return app;
}

describe('stats leaderboard limit validation (#2110)', () => {
  describe('parseStatsLimit', () => {
    it('defaults when omitted', () => {
      expect(parseStatsLimit(undefined)).toEqual({ valid: true, value: STATS_DEFAULT_LIMIT });
    });

    it('accepts values within range', () => {
      expect(parseStatsLimit('1').value).toBe(1);
      expect(parseStatsLimit('50').value).toBe(50);
      expect(parseStatsLimit(String(STATS_MAX_LIMIT)).value).toBe(STATS_MAX_LIMIT);
    });

    it.each(['0', '-1', 'abc', '1e9', '1000000000', '10.5', String(STATS_MAX_LIMIT + 1)])(
      'rejects %s',
      (value) => {
        expect(parseStatsLimit(value).valid).toBe(false);
      }
    );
  });

  describe('middleware', () => {
    const app = buildApp();

    it('uses default limit when omitted', async () => {
      const res = await request(app).get('/leaderboard');
      expect(res.status).toBe(200);
      expect(res.body.limit).toBe(STATS_DEFAULT_LIMIT);
    });

    it('passes a valid limit through', async () => {
      const res = await request(app).get('/leaderboard?limit=25');
      expect(res.status).toBe(200);
      expect(res.body.limit).toBe(25);
    });

    it.each(['0', '-1', 'abc', '1e9'])('returns 400 for limit=%s', async (value) => {
      const res = await request(app).get(`/leaderboard?limit=${encodeURIComponent(value)}`);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_LIMIT');
    });
  });
});
