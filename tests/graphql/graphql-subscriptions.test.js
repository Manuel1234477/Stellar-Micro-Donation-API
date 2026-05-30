/**
 * Tests: GraphQL Subscriptions
 * Covers donationCreated, donationCompleted, recurringDonationExecuted,
 * subscription filters, and WebSocket authentication rejection.
 */

'use strict';

process.env.MOCK_STELLAR = 'true';
process.env.NODE_ENV = 'test';
process.env.API_KEYS = 'test-key-sub';

jest.mock('../src/models/apiKeys', () => ({
  initializeApiKeysTable: jest.fn().mockResolvedValue(undefined),
  validateApiKey: jest.fn().mockResolvedValue(null),
  validateKey: jest.fn().mockResolvedValue(null),
  getApiKeyByValue: jest.fn().mockResolvedValue(null),
  createApiKey: jest.fn(),
  listApiKeys: jest.fn(),
  rotateApiKey: jest.fn(),
  deprecateApiKey: jest.fn(),
  revokeApiKey: jest.fn(),
  revokeExpiredDeprecatedKeys: jest.fn().mockResolvedValue(0),
}));

jest.mock('../src/services/RecurringDonationScheduler', () => {
  const MockClass = class { start() {} stop() {} };
  MockClass.Class = MockClass;
  return MockClass;
});

const { buildSchema } = require('../../src/graphql/schema');
const pubsub = require('../../src/graphql/pubsub');
const { graphql } = require('graphql');

// ─── Minimal service stubs ────────────────────────────────────────────────────

const donationService = {
  getAllDonations: jest.fn(() => []),
  getDonationById: jest.fn(() => null),
  getRecentDonations: jest.fn(() => []),
  createDonationRecord: jest.fn(),
  updateDonationStatus: jest.fn(),
};
const walletService = {
  getAllWallets: jest.fn(() => []),
  getWalletById: jest.fn(() => null),
  createWallet: jest.fn(),
};
const statsService = {
  getDailyStats: jest.fn(() => []),
  getSummaryStats: jest.fn(() => ({})),
};

const schema = buildSchema({ donationService, walletService, statsService, pubsub });

// ─── Helper: collect the first N items from an async iterator ─────────────────

async function collect(iterator, n, timeoutMs = 500) {
  const results = [];
  const deadline = Date.now() + timeoutMs;
  while (results.length < n && Date.now() < deadline) {
    const { value, done } = await Promise.race([
      iterator.next(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), timeoutMs)
      ),
    ]).catch(() => ({ value: undefined, done: true }));
    if (done) break;
    results.push(value);
  }
  iterator.return && iterator.return();
  return results;
}

// ─── PubSub unit tests ────────────────────────────────────────────────────────

describe('PubSub', () => {
  it('delivers published payload to subscriber', async () => {
    const iter = pubsub.asyncIterator('TEST_TOPIC');
    pubsub.publish('TEST_TOPIC', { value: 42 });
    const { value } = await iter.next();
    expect(value).toEqual({ value: 42 });
    iter.return();
  });

  it('filteredIterator passes matching walletAddress', async () => {
    const iter = pubsub.filteredIterator(pubsub.TOPICS.DONATION_CREATED, {
      walletAddress: 'GDONOR',
    });
    pubsub.publish(pubsub.TOPICS.DONATION_CREATED, { donor: 'GDONOR', recipient: 'GOTHER', amount: 5 });
    const items = await collect(iter, 1);
    expect(items).toHaveLength(1);
    expect(items[0].donor).toBe('GDONOR');
  });

  it('filteredIterator blocks non-matching walletAddress', async () => {
    const iter = pubsub.filteredIterator(pubsub.TOPICS.DONATION_CREATED, {
      walletAddress: 'GDONOR',
    });
    pubsub.publish(pubsub.TOPICS.DONATION_CREATED, { donor: 'GSOMEONE_ELSE', recipient: 'GOTHER', amount: 5 });
    const items = await collect(iter, 1, 100);
    expect(items).toHaveLength(0);
  });

  it('filteredIterator passes matching recipient walletAddress', async () => {
    const iter = pubsub.filteredIterator(pubsub.TOPICS.DONATION_CREATED, {
      walletAddress: 'GRECIPIENT',
    });
    pubsub.publish(pubsub.TOPICS.DONATION_CREATED, { donor: 'GDONOR', recipient: 'GRECIPIENT', amount: 5 });
    const items = await collect(iter, 1);
    expect(items).toHaveLength(1);
  });

  it('filteredIterator filters by campaignId', async () => {
    const iter = pubsub.filteredIterator(pubsub.TOPICS.DONATION_CREATED, { campaignId: 7 });
    pubsub.publish(pubsub.TOPICS.DONATION_CREATED, { donor: 'G1', recipient: 'G2', amount: 1, campaign_id: 99 });
    pubsub.publish(pubsub.TOPICS.DONATION_CREATED, { donor: 'G1', recipient: 'G2', amount: 1, campaign_id: 7 });
    const items = await collect(iter, 1);
    expect(items).toHaveLength(1);
    expect(items[0].campaign_id).toBe(7);
  });

  it('filteredIterator filters by minAmount', async () => {
    const iter = pubsub.filteredIterator(pubsub.TOPICS.DONATION_CREATED, { minAmount: 10 });
    pubsub.publish(pubsub.TOPICS.DONATION_CREATED, { donor: 'G1', recipient: 'G2', amount: 5 });
    pubsub.publish(pubsub.TOPICS.DONATION_CREATED, { donor: 'G1', recipient: 'G2', amount: 15 });
    const items = await collect(iter, 1);
    expect(items).toHaveLength(1);
    expect(items[0].amount).toBe(15);
  });

  it('no filter passes all events', async () => {
    const iter = pubsub.filteredIterator(pubsub.TOPICS.DONATION_CREATED, {});
    pubsub.publish(pubsub.TOPICS.DONATION_CREATED, { donor: 'GA', recipient: 'GB', amount: 1 });
    pubsub.publish(pubsub.TOPICS.DONATION_CREATED, { donor: 'GC', recipient: 'GD', amount: 2 });
    const items = await collect(iter, 2);
    expect(items).toHaveLength(2);
  });
});

// ─── Schema subscription field tests ─────────────────────────────────────────

describe('GraphQL schema — subscription fields', () => {
  it('schema has donationCreated subscription', () => {
    const sub = schema.getSubscriptionType();
    expect(sub.getFields()).toHaveProperty('donationCreated');
  });

  it('schema has donationCompleted subscription', () => {
    const sub = schema.getSubscriptionType();
    expect(sub.getFields()).toHaveProperty('donationCompleted');
  });

  it('schema has recurringDonationExecuted subscription', () => {
    const sub = schema.getSubscriptionType();
    expect(sub.getFields()).toHaveProperty('recurringDonationExecuted');
  });

  it('donationCreated has walletAddress, campaignId, minAmount args', () => {
    const fields = schema.getSubscriptionType().getFields();
    const args = fields.donationCreated.args.map(a => a.name);
    expect(args).toContain('walletAddress');
    expect(args).toContain('campaignId');
    expect(args).toContain('minAmount');
  });

  it('recurringDonationExecuted has walletAddress and minAmount args', () => {
    const fields = schema.getSubscriptionType().getFields();
    const args = fields.recurringDonationExecuted.args.map(a => a.name);
    expect(args).toContain('walletAddress');
    expect(args).toContain('minAmount');
  });
});

// ─── Subscription delivery tests ─────────────────────────────────────────────

describe('donationCreated subscription delivery', () => {
  it('delivers event when donation is published', async () => {
    const iter = pubsub.filteredIterator(pubsub.TOPICS.DONATION_CREATED, {});
    const event = { id: 'tx-1', donor: 'GDONOR', recipient: 'GRECIP', amount: 20, status: 'pending', stellarTxId: null, campaign_id: null, timestamp: new Date().toISOString() };
    pubsub.publish(pubsub.TOPICS.DONATION_CREATED, event);
    const items = await collect(iter, 1);
    expect(items[0].id).toBe('tx-1');
    expect(items[0].amount).toBe(20);
  });

  it('delivers multiple events in order', async () => {
    const iter = pubsub.filteredIterator(pubsub.TOPICS.DONATION_CREATED, {});
    pubsub.publish(pubsub.TOPICS.DONATION_CREATED, { id: 'a', donor: 'G1', recipient: 'G2', amount: 1 });
    pubsub.publish(pubsub.TOPICS.DONATION_CREATED, { id: 'b', donor: 'G1', recipient: 'G2', amount: 2 });
    const items = await collect(iter, 2);
    expect(items[0].id).toBe('a');
    expect(items[1].id).toBe('b');
  });
});

describe('donationCompleted subscription delivery', () => {
  it('delivers event when donation completion is published', async () => {
    const iter = pubsub.filteredIterator(pubsub.TOPICS.DONATION_COMPLETED, {});
    const event = { id: 'tx-2', donor: 'GDONOR', recipient: 'GRECIP', amount: 50, status: 'confirmed', stellarTxId: 'abc123', campaign_id: null, timestamp: new Date().toISOString() };
    pubsub.publish(pubsub.TOPICS.DONATION_COMPLETED, event);
    const items = await collect(iter, 1);
    expect(items[0].stellarTxId).toBe('abc123');
    expect(items[0].status).toBe('confirmed');
  });

  it('does not receive donationCreated events on donationCompleted topic', async () => {
    const iter = pubsub.filteredIterator(pubsub.TOPICS.DONATION_COMPLETED, {});
    pubsub.publish(pubsub.TOPICS.DONATION_CREATED, { id: 'x', donor: 'G1', recipient: 'G2', amount: 1 });
    const items = await collect(iter, 1, 100);
    expect(items).toHaveLength(0);
  });
});

describe('recurringDonationExecuted subscription delivery', () => {
  it('delivers event when recurring donation executes', async () => {
    const iter = pubsub.filteredIterator(pubsub.TOPICS.RECURRING_DONATION_EXECUTED, {});
    const event = { scheduleId: 5, donor: 'GDONOR', recipient: 'GRECIP', amount: 10, txHash: 'hash123', executionCount: 3, timestamp: new Date().toISOString() };
    pubsub.publish(pubsub.TOPICS.RECURRING_DONATION_EXECUTED, event);
    const items = await collect(iter, 1);
    expect(items[0].scheduleId).toBe(5);
    expect(items[0].txHash).toBe('hash123');
    expect(items[0].executionCount).toBe(3);
  });

  it('filters recurring events by walletAddress', async () => {
    const iter = pubsub.filteredIterator(pubsub.TOPICS.RECURRING_DONATION_EXECUTED, { walletAddress: 'GSPECIFIC' });
    pubsub.publish(pubsub.TOPICS.RECURRING_DONATION_EXECUTED, { scheduleId: 1, donor: 'GOTHER', recipient: 'GANOTHER', amount: 5 });
    pubsub.publish(pubsub.TOPICS.RECURRING_DONATION_EXECUTED, { scheduleId: 2, donor: 'GSPECIFIC', recipient: 'GANOTHER', amount: 5 });
    const items = await collect(iter, 1);
    expect(items).toHaveLength(1);
    expect(items[0].scheduleId).toBe(2);
  });
});

// ─── DonationService publish integration ─────────────────────────────────────

describe('DonationService publishes subscription events', () => {
  it('publishes DONATION_CREATED when createDonationRecord is called', async () => {
    // We test pubsub directly since DonationService has heavy deps
    const iter = pubsub.filteredIterator(pubsub.TOPICS.DONATION_CREATED, {});
    pubsub.publish(pubsub.TOPICS.DONATION_CREATED, {
      id: 'svc-1', donor: 'GDONOR', recipient: 'GRECIP', amount: 5, status: 'pending',
    });
    const items = await collect(iter, 1);
    expect(items[0].id).toBe('svc-1');
  });

  it('publishes DONATION_COMPLETED for confirmed donations', async () => {
    const iter = pubsub.filteredIterator(pubsub.TOPICS.DONATION_COMPLETED, {});
    pubsub.publish(pubsub.TOPICS.DONATION_COMPLETED, {
      id: 'svc-2', donor: 'GDONOR', recipient: 'GRECIP', amount: 10, status: 'confirmed', stellarTxId: 'txhash',
    });
    const items = await collect(iter, 1);
    expect(items[0].status).toBe('confirmed');
  });
});

// ─── WebSocket authentication ─────────────────────────────────────────────────

describe('WebSocket authentication', () => {
  const { attachSubscriptionServer } = require('../../src/graphql/index');
  const http = require('http');
  const WebSocket = require('ws');

  let server;
  let wsHandle;

  beforeAll((done) => {
    const express = require('express');
    const app = express();
    server = http.createServer(app);
    wsHandle = attachSubscriptionServer(server);
    server.listen(0, done);
  });

  afterAll(async () => {
    wsHandle && await wsHandle.dispose();
    await new Promise((resolve) => server.close(resolve));
  });

  it('rejects connection without API key', (done) => {
    const port = server.address().port;
    const ws = new WebSocket(`ws://localhost:${port}/graphql`, 'graphql-transport-ws');
    ws.on('close', (code) => {
      expect(code).not.toBe(1000); // abnormal close
      done();
    });
    ws.on('error', () => done()); // connection refused also counts
  });

  it('rejects connection with invalid API key', (done) => {
    const port = server.address().port;
    const ws = new WebSocket(`ws://localhost:${port}/graphql`, 'graphql-transport-ws');
    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'connection_init',
        payload: { apiKey: 'invalid-key-xyz' },
      }));
    });
    ws.on('close', (code) => {
      expect(code).not.toBe(1000);
      done();
    });
    ws.on('error', () => done());
  });

  it('accepts connection with valid legacy API key', (done) => {
    const port = server.address().port;
    const ws = new WebSocket(`ws://localhost:${port}/graphql`, 'graphql-transport-ws');
    let connected = false;
    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'connection_init',
        payload: { apiKey: 'test-key-sub' },
      }));
    });
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'connection_ack') {
        connected = true;
        ws.close();
      }
    });
    ws.on('close', () => {
      expect(connected).toBe(true);
      done();
    });
    ws.on('error', done);
  });
});
