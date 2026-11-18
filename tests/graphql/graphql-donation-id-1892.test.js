/**
 * GraphQL donation id type (#1892)
 *
 * Donations written through Transaction.create use UUID string ids, so the
 * donation(id) argument and Donation.id must accept strings, not only Int.
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

const UUID = '3f1c2a9e-7b4d-4e8a-9c2f-1d5e6a7b8c9d';

// Mirrors the real store: keys are strings (UUID) and legacy rows may be numeric.
const store = new Map([
  [UUID, { id: UUID, senderId: 1, receiverId: 2, amount: 3.5, memo: null, status: 'pending', stellar_tx_id: null, timestamp: '2024-01-01T00:00:00Z' }],
  [7, { id: 7, senderId: 1, receiverId: 2, amount: 1, memo: null, status: 'completed', stellar_tx_id: null, timestamp: '2024-01-01T00:00:00Z' }],
]);

const donationService = {
  getAllDonations: jest.fn(() => [...store.values()]),
  getDonationsPage: jest.fn(() => [...store.values()]),
  getDonationById: jest.fn((id) => {
    // Accept the id as a string, as the resolver passes it, and match either key form.
    const found = [...store.values()].find((d) => String(d.id) === String(id));
    return found ?? null;
  }),
  getRecentDonations: jest.fn(() => []),
};

const walletService = { getAllWallets: jest.fn(() => []), getWalletsPage: jest.fn(async () => []), getWalletById: jest.fn() };
const statsService = { getDailyStats: jest.fn(() => []), getSummaryStats: jest.fn(() => ({})) };

const schema = buildSchema({ donationService, walletService, statsService, pubsub });
const userContext = { apiKey: { role: 'user' } };

function run(source, variableValues = {}) {
  return graphql({ schema, source, variableValues, contextValue: userContext });
}

describe('GraphQL — donation id accepts UUID strings (#1892)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('donation(id: UUID) returns the donation', async () => {
    const result = await run(
      'query($id: ID!) { donation(id: $id) { id amount } }',
      { id: UUID }
    );
    expect(result.errors).toBeUndefined();
    expect(result.data.donation).toEqual({ id: UUID, amount: 3.5 });
  });

  test('a literal UUID argument validates', async () => {
    const result = await run(`{ donation(id: "${UUID}") { id } }`);
    expect(result.errors).toBeUndefined();
    expect(result.data.donation.id).toBe(UUID);
  });

  test('Donation.id is serialized as a string for legacy integer rows', async () => {
    const result = await run('query($id: ID!) { donation(id: $id) { id } }', { id: 7 });
    expect(result.errors).toBeUndefined();
    expect(result.data.donation.id).toBe('7');
  });

  test('list queries serialize Donation.id as a string', async () => {
    const result = await run('{ donations { id } }');
    expect(result.errors).toBeUndefined();
    expect(result.data.donations.map((d) => d.id)).toEqual([UUID, '7']);
  });

  test('unknown id resolves to null rather than a validation error', async () => {
    const result = await run('query($id: ID!) { donation(id: $id) { id } }', { id: 'missing' });
    expect(result.errors).toBeUndefined();
    expect(result.data.donation).toBeNull();
  });
});
