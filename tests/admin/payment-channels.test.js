/**
 * Admin Payment Channels Routes Tests
 * 
 * Tests for Issue #122: Payment channel management endpoints
 */

const request = require('supertest');
const express = require('express');
const { PaymentChannelService } = require('../../src/services/PaymentChannelService');
const MockStellarService = require('../../src/services/MockStellarService');
const Database = require('../../src/utils/database');
const { generateApiKey } = require('../../src/models/apiKeys');
const paymentChannelsAdminRoutes = require('../../src/routes/admin/paymentChannels');
const { errorHandler } = require('../../src/middleware/errorHandler');

// Mock service container before requiring it
let mockPaymentChannelService;
jest.mock('../../src/config/serviceContainer', () => ({
  getPaymentChannelService: () => mockPaymentChannelService,
}));

describe('Admin Payment Channels Routes', () => {
  let app;
  let stellarService;
  let adminApiKey;

  beforeAll(async () => {
    await Database.initialize(':memory:');
    await Database.run(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        expires_at TEXT,
        last_used_at TEXT,
        metadata TEXT
      )
    `);

    // Create admin API key
    const result = await generateApiKey('test-admin', 'admin', null, { test: true });
    adminApiKey = result.key;
  });

  beforeEach(async () => {
    // Initialize services
    stellarService = new MockStellarService();
    mockPaymentChannelService = new PaymentChannelService(stellarService);
    await mockPaymentChannelService.initTable();

    // Setup Express app
    app = express();
    app.use(express.json());
    
    // Mock authentication middleware
    app.use((req, res, next) => {
      req.apiKey = { role: 'admin', id: 1 };
      req.id = 'test-request-id';
      req.ip = '127.0.0.1';
      next();
    });

    app.use('/admin/payment-channels', paymentChannelsAdminRoutes);
    app.use(errorHandler);
  });

  afterEach(async () => {
    await Database.run('DELETE FROM payment_channels');
  });

  afterAll(async () => {
    await Database.close();
  });

  describe('GET /admin/payment-channels', () => {
    it('should list all payment channels', async () => {
      // Create test channels
      await mockPaymentChannelService.openChannel({
        senderKey: 'SENDER1',
        receiverKey: 'RECEIVER1',
        capacity: 100,
      });

      await mockPaymentChannelService.openChannel({
        senderKey: 'SENDER2',
        receiverKey: 'RECEIVER2',
        capacity: 200,
      });

      const response = await request(app)
        .get('/admin/payment-channels')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[0]).toMatchObject({
        id: expect.any(String),
        senderPublicKey: expect.any(String),
        recipientPublicKey: expect.any(String),
        capacity: expect.any(Number),
        used: expect.any(Number),
        remaining: expect.any(Number),
        status: 'open',
        openedAt: expect.any(String),
      });
      expect(response.body.pagination).toMatchObject({
        limit: 50,
        offset: 0,
        total: 2,
        hasMore: false,
      });
    });

    it('should filter channels by status', async () => {
      // Create open channel
      const openChannel = await mockPaymentChannelService.openChannel({
        senderKey: 'SENDER1',
        receiverKey: 'RECEIVER1',
        capacity: 100,
      });

      // Create and close another channel
      const closedChannel = await mockPaymentChannelService.openChannel({
        senderKey: 'SENDER2',
        receiverKey: 'RECEIVER2',
        capacity: 200,
        sourceSecret: 'STEST',
      });

      await mockPaymentChannelService.closeChannel({
        channelId: closedChannel.id,
        senderSecret: 'STEST',
      });

      // Filter by open status
      const response = await request(app)
        .get('/admin/payment-channels?status=open')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].status).toBe('open');
      expect(response.body.data[0].id).toBe(openChannel.id);
    });

    it('should paginate results', async () => {
      // Create 5 channels
      for (let i = 0; i < 5; i++) {
        await mockPaymentChannelService.openChannel({
          senderKey: `SENDER${i}`,
          receiverKey: `RECEIVER${i}`,
          capacity: 100 + i,
        });
      }

      // Get first page
      const page1 = await request(app)
        .get('/admin/payment-channels?limit=2&offset=0')
        .expect(200);

      expect(page1.body.data).toHaveLength(2);
      expect(page1.body.pagination).toMatchObject({
        limit: 2,
        offset: 0,
        total: 5,
        hasMore: true,
      });

      // Get second page
      const page2 = await request(app)
        .get('/admin/payment-channels?limit=2&offset=2')
        .expect(200);

      expect(page2.body.data).toHaveLength(2);
      expect(page2.body.pagination).toMatchObject({
        limit: 2,
        offset: 2,
        total: 5,
        hasMore: true,
      });
    });

    it('should reject invalid status filter', async () => {
      const response = await request(app)
        .get('/admin/payment-channels?status=invalid')
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('Invalid status');
    });
  });

  describe('GET /admin/payment-channels/stats', () => {
    it('should return aggregate statistics', async () => {
      // Create channels with different states
      const channel1 = await mockPaymentChannelService.openChannel({
        senderKey: 'SENDER1',
        receiverKey: 'RECEIVER1',
        capacity: 100,
      });

      await mockPaymentChannelService.openChannel({
        senderKey: 'SENDER2',
        receiverKey: 'RECEIVER2',
        capacity: 200,
      });

      // Update channel1 to use some capacity
      await mockPaymentChannelService.updateChannel({
        channelId: channel1.id,
        amount: 30,
        senderSecret: 'STEST1',
        receiverSecret: 'RTEST1',
        senderSig: require('crypto').createHmac('sha256', 'STEST1')
          .update(`channel:${channel1.id}:seq:1:balance:30`)
          .digest('hex'),
        receiverSig: require('crypto').createHmac('sha256', 'RTEST1')
          .update(`channel:${channel1.id}:seq:1:balance:30`)
          .digest('hex'),
      });

      const response = await request(app)
        .get('/admin/payment-channels/stats')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toMatchObject({
        activeChannels: 2,
        totalCapacityXLM: '300.0000000',
        totalUsedXLM: '30.0000000',
        channelsExpiringSoon: 0,
        totalChannels: 2,
        byStatus: {
          open: 2,
          closing: 0,
          closed: 0,
          settled: 0,
          disputed: 0,
        },
      });
    });

    it('should count channels expiring soon', async () => {
      // Create channel with expiration in 12 hours
      const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
      
      await mockPaymentChannelService.openChannel({
        senderKey: 'SENDER1',
        receiverKey: 'RECEIVER1',
        capacity: 100,
        metadata: { expiresAt },
      });

      // Create channel with expiration in 48 hours (not expiring soon)
      const expiresLater = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
      
      await mockPaymentChannelService.openChannel({
        senderKey: 'SENDER2',
        receiverKey: 'RECEIVER2',
        capacity: 200,
        metadata: { expiresAt: expiresLater },
      });

      const response = await request(app)
        .get('/admin/payment-channels/stats')
        .expect(200);

      expect(response.body.data.channelsExpiringSoon).toBe(1);
    });

    it('should handle empty channel list', async () => {
      const response = await request(app)
        .get('/admin/payment-channels/stats')
        .expect(200);

      expect(response.body.data).toMatchObject({
        activeChannels: 0,
        totalCapacityXLM: '0.0000000',
        totalUsedXLM: '0.0000000',
        channelsExpiringSoon: 0,
        totalChannels: 0,
      });
    });
  });

  describe('GET /admin/payment-channels/:id', () => {
    it('should return full channel details', async () => {
      const channel = await mockPaymentChannelService.openChannel({
        senderKey: 'SENDER1',
        receiverKey: 'RECEIVER1',
        capacity: 100,
        metadata: { note: 'test channel' },
      });

      const response = await request(app)
        .get(`/admin/payment-channels/${channel.id}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toMatchObject({
        id: channel.id,
        senderPublicKey: 'SENDER1',
        recipientPublicKey: 'RECEIVER1',
        capacity: 100,
        balance: 0,
        sequence: 0,
        status: 'open',
        openedAt: expect.any(String),
        updatedAt: expect.any(String),
        settledAt: null,
        closedAt: null,
        disputedAt: null,
        disputeSequence: null,
        metadata: { note: 'test channel' },
        transactionHistory: [],
      });
    });

    it('should include transaction history', async () => {
      const channel = await mockPaymentChannelService.openChannel({
        senderKey: 'SENDER1',
        receiverKey: 'RECEIVER1',
        capacity: 100,
      });

      // Update channel to create transaction history
      await mockPaymentChannelService.updateChannel({
        channelId: channel.id,
        amount: 25,
        senderSecret: 'STEST',
        receiverSecret: 'RTEST',
        senderSig: require('crypto').createHmac('sha256', 'STEST')
          .update(`channel:${channel.id}:seq:1:balance:25`)
          .digest('hex'),
        receiverSig: require('crypto').createHmac('sha256', 'RTEST')
          .update(`channel:${channel.id}:seq:1:balance:25`)
          .digest('hex'),
      });

      const response = await request(app)
        .get(`/admin/payment-channels/${channel.id}`)
        .expect(200);

      expect(response.body.data.transactionHistory).toHaveLength(1);
      expect(response.body.data.transactionHistory[0]).toMatchObject({
        sequence: 1,
        senderSig: expect.any(String),
        receiverSig: expect.any(String),
        timestamp: expect.any(String),
      });
    });

    it('should return 404 for non-existent channel', async () => {
      const response = await request(app)
        .get('/admin/payment-channels/non-existent-id')
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('not found');
    });
  });

  describe('POST /admin/payment-channels/:id/close', () => {
    it('should close a channel and settle balance', async () => {
      const channel = await mockPaymentChannelService.openChannel({
        senderKey: 'SENDER1',
        receiverKey: 'RECEIVER1',
        capacity: 100,
        sourceSecret: 'STEST',
      });

      // Update channel to add balance
      await mockPaymentChannelService.updateChannel({
        channelId: channel.id,
        amount: 50,
        senderSecret: 'STEST',
        receiverSecret: 'RTEST',
        senderSig: require('crypto').createHmac('sha256', 'STEST')
          .update(`channel:${channel.id}:seq:1:balance:50`)
          .digest('hex'),
        receiverSig: require('crypto').createHmac('sha256', 'RTEST')
          .update(`channel:${channel.id}:seq:1:balance:50`)
          .digest('hex'),
      });

      const response = await request(app)
        .post(`/admin/payment-channels/${channel.id}/close`)
        .send({ senderSecret: 'STEST' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toMatchObject({
        id: channel.id,
        status: 'settled',
        settledAt: expect.any(String),
        balanceSettled: 50,
        stellarTxId: expect.any(String),
      });
      expect(response.body.message).toBe('Payment channel closed successfully');
    });

    it('should close a channel with zero balance', async () => {
      const channel = await mockPaymentChannelService.openChannel({
        senderKey: 'SENDER1',
        receiverKey: 'RECEIVER1',
        capacity: 100,
        sourceSecret: 'STEST',
      });

      const response = await request(app)
        .post(`/admin/payment-channels/${channel.id}/close`)
        .send({ senderSecret: 'STEST' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.balanceSettled).toBe(0);
    });

    it('should reject closing without senderSecret', async () => {
      const channel = await mockPaymentChannelService.openChannel({
        senderKey: 'SENDER1',
        receiverKey: 'RECEIVER1',
        capacity: 100,
      });

      const response = await request(app)
        .post(`/admin/payment-channels/${channel.id}/close`)
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('senderSecret is required');
    });

    it('should reject closing already closed channel', async () => {
      const channel = await mockPaymentChannelService.openChannel({
        senderKey: 'SENDER1',
        receiverKey: 'RECEIVER1',
        capacity: 100,
        sourceSecret: 'STEST',
      });

      // Close once
      await mockPaymentChannelService.closeChannel({
        channelId: channel.id,
        senderSecret: 'STEST',
      });

      // Try to close again
      const response = await request(app)
        .post(`/admin/payment-channels/${channel.id}/close`)
        .send({ senderSecret: 'STEST' })
        .expect(409);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('already settled');
    });

    it('should return 404 for non-existent channel', async () => {
      const response = await request(app)
        .post('/admin/payment-channels/non-existent-id/close')
        .send({ senderSecret: 'STEST' })
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('Authorization', () => {
    it('should require admin role for all endpoints', async () => {
      // Create app with user role
      const userApp = express();
      userApp.use(express.json());
      userApp.use((req, res, next) => {
        req.apiKey = { role: 'user', id: 1 };
        req.id = 'test-request-id';
        req.ip = '127.0.0.1';
        next();
      });
      userApp.use('/admin/payment-channels', paymentChannelsAdminRoutes);
      userApp.use(errorHandler);

      // Test each endpoint
      await request(userApp)
        .get('/admin/payment-channels')
        .expect(403);

      await request(userApp)
        .get('/admin/payment-channels/stats')
        .expect(403);

      await request(userApp)
        .get('/admin/payment-channels/test-id')
        .expect(403);

      await request(userApp)
        .post('/admin/payment-channels/test-id/close')
        .send({ senderSecret: 'STEST' })
        .expect(403);
    });
  });
});
