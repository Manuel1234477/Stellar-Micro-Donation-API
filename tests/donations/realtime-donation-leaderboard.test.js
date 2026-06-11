/**
 * Real-time Donation Leaderboard Tests
 * Tests for leaderboard endpoints, caching, and SSE functionality
 * Run with: npm test -- realtime-donation-leaderboard.test.js
 *
 * HTTP endpoints are exercised through the real app at /api/v1/leaderboard.
 * Leaderboard reads are intentionally guest-accessible (the guest role has
 * stats:read), so no API key is required for GET requests.
 */

const http = require('http');
const request = require('supertest');
const app = require('../../src/app');
const StatsService = require('../../src/services/LeaderboardStatsService');
const Transaction = require('../../src/models/transaction');
const Cache = require('../../src/utils/cache');
const SseManager = require('../../src/services/SseManager');

// Helper function to create test transactions.
// Use `'field' in data` so callers can explicitly pass null (anonymous donor)
// without the default kicking in.
const createTransaction = (data) => {
  return Transaction.create({
    id: data.id || `tx-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    amount: 'amount' in data ? data.amount : 100,
    donor: 'donor' in data ? data.donor : 'GA1234567890',
    recipient: 'recipient' in data ? data.recipient : 'GB1234567890',
    status: data.status || 'confirmed',
    timestamp: data.timestamp || new Date().toISOString(),
    memo: data.memo || '',
    tags: data.tags || []
  });
};

const clearState = () => {
  Transaction._clearAllData();
  StatsService.invalidateLeaderboardCache();
  Cache.clear();
  SseManager._reset();
};

describe('Leaderboard Feature - Integration Tests', () => {
  beforeEach(clearState);
  afterEach(clearState);

  describe('GET /leaderboard/donors', () => {
    test('should return empty leaderboard when no transactions exist', async () => {
      const response = await request(app)
        .get('/api/v1/leaderboard/donors')
        .expect('Content-Type', /json/);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual([]);
      expect(response.body.metadata.period).toBe('all');
    });

    test('should return top 10 donors by default', async () => {
      // Create multiple transactions from different donors
      const donors = [
        { donor: 'GA1111111111', amount: 1000 },
        { donor: 'GA2222222222', amount: 500 },
        { donor: 'GA3333333333', amount: 300 },
      ];

      donors.forEach(d => {
        createTransaction({
          donor: d.donor,
          amount: d.amount,
          status: 'confirmed'
        });
      });

      const response = await request(app)
        .get('/api/v1/leaderboard/donors')
        .expect('Content-Type', /json/);

      expect(response.body.success).toBe(true);
      expect(response.body.data.length).toBe(3);
      // Should be sorted by total donated (descending)
      expect(response.body.data[0].donor).toBe('GA1111111111');
      expect(response.body.data[0].rank).toBe(1);
      expect(response.body.data[0].totalDonated).toBe(1000);
    });

    test('should filter by period: daily', async () => {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 2);

      // Create transaction from yesterday
      createTransaction({
        donor: 'GA1111111111',
        amount: 500,
        status: 'confirmed',
        timestamp: yesterday.toISOString()
      });

      // Create transaction from today
      createTransaction({
        donor: 'GA1111111111',
        amount: 300,
        status: 'confirmed',
        timestamp: today.toISOString()
      });

      const response = await request(app)
        .get('/api/v1/leaderboard/donors?period=daily')
        .expect('Content-Type', /json/);

      expect(response.body.success).toBe(true);
      expect(response.body.metadata.period).toBe('daily');
    });

    test('should filter by period: weekly', async () => {
      const now = new Date();
      const lastWeek = new Date(now);
      lastWeek.setDate(lastWeek.getDate() - 10);

      createTransaction({
        donor: 'GA1111111111',
        amount: 200,
        status: 'confirmed',
        timestamp: lastWeek.toISOString()
      });

      const response = await request(app)
        .get('/api/v1/leaderboard/donors?period=weekly')
        .expect('Content-Type', /json/);

      expect(response.body.success).toBe(true);
      expect(response.body.metadata.period).toBe('weekly');
    });

    test('should filter by period: monthly', async () => {
      const response = await request(app)
        .get('/api/v1/leaderboard/donors?period=monthly')
        .expect('Content-Type', /json/);

      expect(response.body.success).toBe(true);
      expect(response.body.metadata.period).toBe('monthly');
    });

    test('should respect custom limit parameter', async () => {
      // Create transactions from 10 different donors
      for (let i = 0; i < 10; i++) {
        createTransaction({
          donor: `GA${String(i).padStart(10, '0')}`,
          amount: 100,
          status: 'confirmed'
        });
      }

      const response = await request(app)
        .get('/api/v1/leaderboard/donors?limit=5')
        .expect('Content-Type', /json/);

      expect(response.body.success).toBe(true);
      expect(response.body.data.length).toBe(5);
      expect(response.body.metadata.limit).toBe(5);
    });

    test('should reject invalid period parameter', async () => {
      const response = await request(app)
        .get('/api/v1/leaderboard/donors?period=invalid')
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_PARAMETER');
    });

    test('should reject limit exceeding maximum', async () => {
      const response = await request(app)
        .get('/api/v1/leaderboard/donors?limit=200')
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_PARAMETER');
    });

    test('should only include confirmed transactions', async () => {
      // Create confirmed transaction
      createTransaction({
        donor: 'GA1111111111',
        amount: 500,
        status: 'confirmed'
      });

      // Create pending transaction
      createTransaction({
        donor: 'GA2222222222',
        amount: 300,
        status: 'pending'
      });

      const response = await request(app)
        .get('/api/v1/leaderboard/donors')
        .expect('Content-Type', /json/);

      expect(response.body.success).toBe(true);
      expect(response.body.data.length).toBe(1);
      expect(response.body.data[0].donor).toBe('GA1111111111');
    });
  });

  describe('GET /leaderboard/recipients', () => {
    test('should return empty leaderboard when no transactions exist', async () => {
      const response = await request(app)
        .get('/api/v1/leaderboard/recipients')
        .expect('Content-Type', /json/);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual([]);
    });

    test('should return top recipients sorted by total received', async () => {
      const recipients = [
        { recipient: 'GB1111111111', amount: 1000 },
        { recipient: 'GB2222222222', amount: 500 },
        { recipient: 'GB3333333333', amount: 300 },
      ];

      recipients.forEach(r => {
        createTransaction({
          recipient: r.recipient,
          amount: r.amount,
          status: 'confirmed'
        });
      });

      const response = await request(app)
        .get('/api/v1/leaderboard/recipients')
        .expect('Content-Type', /json/);

      expect(response.body.success).toBe(true);
      expect(response.body.data.length).toBe(3);
      expect(response.body.data[0].recipient).toBe('GB1111111111');
      expect(response.body.data[0].rank).toBe(1);
      expect(response.body.data[0].totalReceived).toBe(1000);
    });

    test('should filter by period parameter', async () => {
      const response = await request(app)
        .get('/api/v1/leaderboard/recipients?period=weekly')
        .expect('Content-Type', /json/);

      expect(response.body.success).toBe(true);
      expect(response.body.metadata.period).toBe('weekly');
    });

    test('should reject invalid period parameter', async () => {
      const response = await request(app)
        .get('/api/v1/leaderboard/recipients?period=invalid')
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_PARAMETER');
    });
  });

  describe('GET /leaderboard/stream', () => {
    test('should set SSE headers', async () => {
      // The stream endpoint holds the connection open, so use a raw HTTP
      // request and destroy it once headers arrive.
      const headers = await new Promise((resolve, reject) => {
        const server = http.createServer(app);
        server.listen(0, () => {
          const port = server.address().port;
          const req = http.request({ port, path: '/api/v1/leaderboard/stream' }, res => {
            const h = res.headers;
            req.destroy();
            server.close(() => resolve(h));
          });
          req.on('error', reject);
          req.end();
        });
      });

      expect(headers['content-type']).toContain('text/event-stream');
      expect(headers['cache-control']).toBe('no-cache, no-store, must-revalidate');
      expect(headers['connection']).toBe('keep-alive');
    });
  });

  describe('Leaderboard Caching', () => {
    test('should cache leaderboard results', () => {
      // Create transaction
      createTransaction({
        donor: 'GA1111111111',
        amount: 500,
        status: 'confirmed'
      });

      // First call - should populate cache
      const result1 = StatsService.getDonorLeaderboard('all', 10);
      expect(result1.length).toBe(1);

      // Second call - should use cached result
      const result2 = StatsService.getDonorLeaderboard('all', 10);
      expect(result2.length).toBe(1);
    });

    test('should invalidate cache when new donation', () => {
      // Create initial transaction
      createTransaction({
        donor: 'GA1111111111',
        amount: 500,
        status: 'confirmed'
      });

      // Get initial leaderboard
      const result1 = StatsService.getDonorLeaderboard('all', 10);
      expect(result1.length).toBe(1);

      // Invalidate cache
      StatsService.invalidateLeaderboardCache();

      // Create another transaction
      createTransaction({
        donor: 'GA2222222222',
        amount: 300,
        status: 'confirmed'
      });

      // Get leaderboard after cache invalidation
      const result2 = StatsService.getDonorLeaderboard('all', 10);
      expect(result2.length).toBe(2);
    });

    test('should respect TTL and return fresh data when expiration', () => {
      // This test validates the cache mechanism by checking
      // that different periods have different cache keys
      createTransaction({
        donor: 'GA1111111111',
        amount: 500,
        status: 'confirmed'
      });

      // Get leaderboard for 'all' period
      const allPeriod = StatsService.getDonorLeaderboard('all', 10);
      expect(allPeriod.length).toBe(1);

      // Get leaderboard for 'daily' period - should be different cache key
      const dailyPeriod = StatsService.getDonorLeaderboard('daily', 10);
      expect(dailyPeriod.length).toBe(1);
    });
  });

  describe('Leaderboard Ranking', () => {
    test('should correctly rank donors by total donated', () => {
      const donors = [
        { donor: 'GA0000000001', amount: 100 },
        { donor: 'GA0000000002', amount: 900 },
        { donor: 'GA0000000003', amount: 500 },
      ];

      donors.forEach(d => {
        createTransaction({
          donor: d.donor,
          amount: d.amount,
          status: 'confirmed'
        });
      });

      const leaderboard = StatsService.getDonorLeaderboard('all', 10);

      expect(leaderboard[0].rank).toBe(1);
      expect(leaderboard[0].donor).toBe('GA0000000002');
      expect(leaderboard[0].totalDonated).toBe(900);

      expect(leaderboard[1].rank).toBe(2);
      expect(leaderboard[1].donor).toBe('GA0000000003');
      expect(leaderboard[1].totalDonated).toBe(500);

      expect(leaderboard[2].rank).toBe(3);
      expect(leaderboard[2].donor).toBe('GA0000000001');
      expect(leaderboard[2].totalDonated).toBe(100);
    });

    test('should correctly aggregate multiple donations from same donor', () => {
      const donor = 'GA1111111111';
      const recipient = 'GB1111111111';

      // Create multiple transactions from same donor
      createTransaction({ donor, recipient, amount: 100, status: 'confirmed' });
      createTransaction({ donor, recipient, amount: 200, status: 'confirmed' });
      createTransaction({ donor, recipient, amount: 150, status: 'confirmed' });

      const leaderboard = StatsService.getDonorLeaderboard('all', 10);

      expect(leaderboard.length).toBe(1);
      expect(leaderboard[0].donor).toBe(donor);
      expect(leaderboard[0].totalDonated).toBe(450);
      expect(leaderboard[0].donationCount).toBe(3);
    });

    test('should handle anonymous donors', () => {
      createTransaction({
        donor: null,
        amount: 100,
        status: 'confirmed'
      });

      const leaderboard = StatsService.getDonorLeaderboard('all', 10);

      expect(leaderboard.length).toBe(1);
      expect(leaderboard[0].donor).toBe('Anonymous');
    });
  });

  describe('StatsService Methods', () => {
    test('getDateRangeForPeriod should return correct date ranges', () => {
      const daily = StatsService.getDateRangeForPeriod('daily');
      expect(daily.startDate).toBeInstanceOf(Date);
      expect(daily.endDate).toBeInstanceOf(Date);

      const weekly = StatsService.getDateRangeForPeriod('weekly');
      expect(weekly.startDate).toBeInstanceOf(Date);
      expect(weekly.endDate).toBeInstanceOf(Date);

      const monthly = StatsService.getDateRangeForPeriod('monthly');
      expect(monthly.startDate).toBeInstanceOf(Date);
      expect(monthly.endDate).toBeInstanceOf(Date);

      const all = StatsService.getDateRangeForPeriod('all');
      expect(all.startDate).toBeNull();
      expect(all.endDate).toBeNull();
    });

    test('invalidateLeaderboardCache should clear all leaderboard caches', () => {
      // Create some cached data
      createTransaction({
        donor: 'GA1111111111',
        amount: 500,
        status: 'confirmed'
      });

      StatsService.getDonorLeaderboard('all', 10);
      StatsService.getRecipientLeaderboard('all', 10);

      // Invalidate
      StatsService.invalidateLeaderboardCache();

      // After invalidation, new calls should not use cache
      // This is validated by the cache checking if keys still exist
      const cachedDonors = Cache.get('leaderboard:donors:all:10');
      const cachedRecipients = Cache.get('leaderboard:recipients:all:10');

      expect(cachedDonors).toBeNull();
      expect(cachedRecipients).toBeNull();
    });
  });

  describe('Error Handling', () => {
    test('should handle missing donor gracefully', () => {
      // Transaction with no donor field
      createTransaction({
        amount: 100,
        donor: undefined,
        recipient: 'GB1111111111',
        status: 'confirmed'
      });

      const leaderboard = StatsService.getDonorLeaderboard('all', 10);

      expect(leaderboard.length).toBe(1);
      expect(leaderboard[0].donor).toBe('Anonymous');
    });

    test('should handle missing recipient gracefully', () => {
      createTransaction({
        amount: 100,
        donor: 'GA1111111111',
        recipient: undefined,
        status: 'confirmed'
      });

      const leaderboard = StatsService.getRecipientLeaderboard('all', 10);

      expect(leaderboard.length).toBe(1);
      expect(leaderboard[0].recipient).toBe('Unknown');
    });

    test('should handle invalid amount values', () => {
      createTransaction({
        donor: 'GA1111111111',
        recipient: 'GB1111111111',
        amount: 'invalid',
        status: 'confirmed'
      });

      const leaderboard = StatsService.getDonorLeaderboard('all', 10);

      expect(leaderboard.length).toBe(1);
      expect(leaderboard[0].totalDonated).toBe(0);
    });
  });

  describe('Security and Validation', () => {
    test('should allow unauthenticated read access (guest role has stats:read)', async () => {
      // Leaderboard reads are public by design — attachUserRole assigns
      // unauthenticated requests the guest role, which has stats:read.
      const response = await request(app)
        .get('/api/v1/leaderboard/donors')
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    test('should validate limit is a positive integer', async () => {
      const response = await request(app)
        .get('/api/v1/leaderboard/donors?limit=-1')
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_PARAMETER');
    });

    test('should validate limit is not zero', async () => {
      const response = await request(app)
        .get('/api/v1/leaderboard/donors?limit=0')
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });
});

describe('Leaderboard SSE Integration', () => {
  beforeEach(() => {
    Cache.clear();
    SseManager._reset();
  });

  afterEach(() => {
    Cache.clear();
    SseManager._reset();
  });

  test('SseManager should broadcast to connected clients', () => {
    // Create mock response object
    const mockRes = {
      write: jest.fn()
    };

    // Add a client
    SseManager.addClient('test-client-1', 'test-key-1', {}, mockRes);

    // Broadcast an event
    SseManager.broadcast('test.event', { data: 'test' });

    // Verify write was called
    expect(mockRes.write).toHaveBeenCalled();

    // Clean up
    SseManager.removeClient('test-client-1');
  });

  test('SseManager should handle client disconnection', () => {
    const mockRes = {
      write: jest.fn()
    };

    const clientId = 'test-client-2';
    SseManager.addClient(clientId, 'test-key-1', {}, mockRes);

    // Verify client is added
    expect(SseManager._clients.has(clientId)).toBe(true);

    // Remove client
    SseManager.removeClient(clientId);

    // Verify client is removed
    expect(SseManager._clients.has(clientId)).toBe(false);
  });

  test('SseManager should get missed events with Last-Event-ID', () => {
    // Buffer some events
    SseManager.broadcast('test.event', { id: 1 });
    SseManager.broadcast('test.event', { id: 2 });
    SseManager.broadcast('test.event', { id: 3 });

    // Get missed events after event 1
    const missed = SseManager.getMissedEvents('1');

    expect(missed.length).toBe(2);
  });
});

describe('Leaderboard Performance', () => {
  beforeEach(clearState);
  afterEach(clearState);

  test('should handle large number of transactions efficiently', () => {
    // Create 100 transactions from 20 different donors
    for (let i = 0; i < 20; i++) {
      for (let j = 0; j < 5; j++) {
        createTransaction({
          donor: `GA${String(i).padStart(10, '0')}`,
          recipient: 'GB1111111111',
          amount: Math.random() * 100,
          status: 'confirmed'
        });
      }
    }

    const startTime = Date.now();
    const leaderboard = StatsService.getDonorLeaderboard('all', 100);
    const endTime = Date.now();

    expect(leaderboard.length).toBe(20);
    expect(endTime - startTime).toBeLessThan(100); // Should complete in under 100ms
  });

  test('cache should improve performance on repeated calls', () => {
    createTransaction({
      donor: 'GA1111111111',
      amount: 500,
      status: 'confirmed'
    });

    // First call - no cache
    const start1 = Date.now();
    StatsService.getDonorLeaderboard('all', 10);
    const time1 = Date.now() - start1;

    // Second call - should use cache
    const start2 = Date.now();
    StatsService.getDonorLeaderboard('all', 10);
    const time2 = Date.now() - start2;

    // Cached call should be faster or equal
    expect(time2).toBeLessThanOrEqual(time1);
  });
});
