'use strict';

const express = require('express');
const request = require('supertest');
const Cache = require('../../src/utils/cache');
const StatsService = require('../../src/services/StatsService');

// Mock StatsService
jest.mock('../../src/services/StatsService');

describe('Stats Rate Limiting and Caching', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    Cache.clear();
    
    // We need a fresh app to reset express-rate-limit state between tests
    app = express();
    app.use(express.json());
    
    // Mock API key middleware
    app.use((req, res, next) => {
      req.apiKey = { id: 'test-api-key', rateLimit: 30 };
      next();
    });

    // Mock Permission middleware
    const statsRouter = require('../../src/routes/stats');
    app.use('/stats', statsRouter);
  });

  describe('Rate Limiting', () => {
    it('allows up to 30 requests per minute', async () => {
      StatsService.getDailyStats.mockReturnValue([]);
      
      for (let i = 0; i < 30; i++) {
        const res = await request(app)
          .get('/stats/daily?startDate=2023-01-01&endDate=2023-01-02');
        expect(res.status).toBe(200);
        expect(res.headers['x-ratelimit-limit']).toBe('30');
        expect(parseInt(res.headers['x-ratelimit-remaining'])).toBeLessThanOrEqual(30 - (i + 1));
      }

      const res429 = await request(app)
        .get('/stats/daily?startDate=2023-01-01&endDate=2023-01-02');
      expect(res429.status).toBe(429);
      expect(res429.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(res429.headers['retry-after']).toBeDefined();
    }, 15000); // Increase timeout for loop
  });

  describe('Caching', () => {
    it('caches results for 60 seconds', async () => {
      const mockData = { some: 'stats' };
      StatsService.getDailyStats.mockReturnValue(mockData);

      // First request - hits DB
      const res1 = await request(app)
        .get('/stats/daily?startDate=2023-01-01&endDate=2023-01-02');
      expect(res1.status).toBe(200);
      expect(res1.headers['x-cache-age']).toBe('0');
      expect(StatsService.getDailyStats).toHaveBeenCalledTimes(1);

      // Second request - hits cache
      const res2 = await request(app)
        .get('/stats/daily?startDate=2023-01-01&endDate=2023-01-02');
      expect(res2.status).toBe(200);
      expect(parseInt(res2.headers['x-cache-age'])).toBeGreaterThanOrEqual(0);
      expect(StatsService.getDailyStats).toHaveBeenCalledTimes(1); // Still 1
    });

    it('expires cache after TTL', async () => {
      const mockData = { some: 'stats' };
      StatsService.getDailyStats.mockReturnValue(mockData);

      // First request
      await request(app).get('/stats/daily?startDate=2023-01-01&endDate=2023-01-02');
      expect(StatsService.getDailyStats).toHaveBeenCalledTimes(1);

      // Manually clear cache to simulate expiry
      Cache.clear();

      // Third request - hits DB again
      await request(app).get('/stats/daily?startDate=2023-01-01&endDate=2023-01-02');
      expect(StatsService.getDailyStats).toHaveBeenCalledTimes(2);
    });

    it('caches per query parameters', async () => {
      StatsService.getDailyStats.mockReturnValue({ data: 'val' });

      // Query A
      await request(app).get('/stats/daily?startDate=2023-01-01&endDate=2023-01-02');
      expect(StatsService.getDailyStats).toHaveBeenCalledTimes(1);

      // Query B (different query)
      await request(app).get('/stats/daily?startDate=2023-01-01&endDate=2023-01-03');
      expect(StatsService.getDailyStats).toHaveBeenCalledTimes(2);
    });

    it('avoids caching error responses', async () => {
      StatsService.getDailyStats.mockImplementation(() => {
        throw new Error('DB Error');
      });

      // First request fails
      const res1 = await request(app).get('/stats/daily?startDate=2023-01-01&endDate=2023-01-02');
      expect(res1.status).toBe(500);

      // Fix DB
      StatsService.getDailyStats.mockReturnValue({ data: 'ok' });

      // Second request should hit DB (not cached error)
      const res2 = await request(app).get('/stats/daily?startDate=2023-01-01&endDate=2023-01-02');
      expect(res2.status).toBe(200);
      expect(res2.headers['x-cache-age']).toBe('0');
      expect(StatsService.getDailyStats).toHaveBeenCalledTimes(2);
    });
  });

  describe('Combined Behavior', () => {
    it('cached responses still count toward rate limits', async () => {
      StatsService.getDailyStats.mockReturnValue([]);
      
      // Send 30 requests. First is DB hit, others are cache hits.
      for (let i = 0; i < 30; i++) {
        await request(app).get('/stats/daily?startDate=2023-01-01&endDate=2023-01-02');
      }
      
      const res429 = await request(app).get('/stats/daily?startDate=2023-01-01&endDate=2023-01-02');
      expect(res429.status).toBe(429);
      expect(StatsService.getDailyStats).toHaveBeenCalledTimes(1); // Only first request hit DB
    });
  });
});
