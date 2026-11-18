/**
 * GraphQL read-query RBAC (#1890)
 *
 * Every root query field must enforce the same read permission that the
 * equivalent REST route enforces, so a scoped key cannot bypass RBAC via GraphQL.
 */

'use strict';

process.env.MOCK_STELLAR = 'true';
process.env.NODE_ENV = 'test';
process.env.API_KEYS = 'test-key-graphql';

jest.mock('../../src/config/stellar', () => ({ getStellarService: () => ({}) }));
jest.mock('../../src/services/DonationService', () => jest.fn());
jest.mock('../../src/services/WalletService', () => jest.fn());
jest.mock('../../src/services/StatsService', () => ({}));

const { buildSchema } = require('../../src/graphql/schema');
const pubsub = require('../../src/graphql/pubsub');
const { graphql } = require('graphql');

const donation = { id: 1, senderId: 1, receiverId: 2, amount: 1, memo: null, status: 'pending', stellar_tx_id: null, timestamp: '2024-01-01T00:00:00Z' };
const wallet = { id: 1, address: 'GABC', label: 'Main', ownerName: 'Alice', createdAt: '2024-01-01T00:00:00Z' };

const donationService = {
  getAllDonations: jest.fn(() => [donation]),
  getDonationsPage: jest.fn(() => [donation]),
  getDonationById: jest.fn(() => donation),
  getRecentDonations: jest.fn(() => [donation]),
};

const walletService = {
  getAllWallets: jest.fn(() => [wallet]),
  getWalletsPage: jest.fn(async () => [wallet]),
  getWalletById: jest.fn(() => wallet),
};

const statsService = {
  getDailyStats: jest.fn(() => []),
  getSummaryStats: jest.fn(() => ({ totalDonations: 0, totalVolume: 0, uniqueDonors: 0, uniqueRecipients: 0, averageDonation: 0 })),
};

const schema = buildSchema({ donationService, walletService, statsService, pubsub });

/** Run a query as a key with the given role. */
function runAs(role, source) {
  return graphql({ schema, source, contextValue: { apiKey: { role } } });
}

const READ_QUERIES = {
  donations: '{ donations { id } }',
  donation: '{ donation(id: 1) { id } }',
  recentDonations: '{ recentDonations { id } }',
  wallets: '{ wallets { id } }',
  wallet: '{ wallet(id: 1) { id } }',
  dailyStats: '{ dailyStats(startDate: "2024-01-01", endDate: "2024-01-31") { date } }',
  summaryStats: '{ summaryStats { totalDonations } }',
};

describe('GraphQL — read queries enforce RBAC (#1890)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('unauthenticated context is rejected for every read query', async () => {
    for (const source of Object.values(READ_QUERIES)) {
      const result = await graphql({ schema, source, contextValue: {} });
      expect(result.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
    }
  });

  test('guest cannot read wallets (no wallets:read)', async () => {
    const result = await runAs('guest', READ_QUERIES.wallets);
    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(walletService.getWalletsPage).not.toHaveBeenCalled();
  });

  test('guest cannot read single wallet by id', async () => {
    const result = await runAs('guest', READ_QUERIES.wallet);
    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(walletService.getWalletById).not.toHaveBeenCalled();
  });

  test('guest can read donations and stats (donations:read, stats:read)', async () => {
    for (const source of [READ_QUERIES.donations, READ_QUERIES.donation, READ_QUERIES.recentDonations, READ_QUERIES.dailyStats, READ_QUERIES.summaryStats]) {
      const result = await runAs('guest', source);
      expect(result.errors).toBeUndefined();
    }
  });

  test('user role can read wallets', async () => {
    const result = await runAs('user', READ_QUERIES.wallets);
    expect(result.errors).toBeUndefined();
    expect(result.data.wallets).toHaveLength(1);
  });

  test('a key scoped to a single permission is denied the other resources', async () => {
    // A signer holds donations:read and donations:approve only.
    const denied = await runAs('signer', READ_QUERIES.wallets);
    expect(denied.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    const denied2 = await runAs('signer', READ_QUERIES.summaryStats);
    expect(denied2.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    const allowed = await runAs('signer', READ_QUERIES.donations);
    expect(allowed.errors).toBeUndefined();
  });
});
