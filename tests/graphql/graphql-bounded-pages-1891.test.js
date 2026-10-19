/**
 * GraphQL list queries must read a bounded page, not the whole table (#1891)
 */

'use strict';

process.env.MOCK_STELLAR = 'true';
process.env.NODE_ENV = 'test';
process.env.API_KEYS = 'test-key-graphql';

jest.mock('../../src/config/stellar', () => ({ getStellarService: () => ({}) }));
jest.mock('../../src/services/DonationService', () => jest.fn());
jest.mock('../../src/services/WalletService', () => jest.fn());
jest.mock('../../src/services/StatsService', () => ({}));
jest.mock('../../src/utils/database', () => ({
  run: jest.fn(async () => ({})),
  all: jest.fn(async () => []),
  get: jest.fn(async () => undefined),
}));

const { buildSchema } = require('../../src/graphql/schema');
const pubsub = require('../../src/graphql/pubsub');
const Database = require('../../src/utils/database');
const Wallet = require('../../src/models/wallet');
const Transaction = require('../../src/models/transaction');
const { graphql } = require('graphql');

const userContext = { apiKey: { role: 'user' } };

const donationService = {
  getAllDonations: jest.fn(() => {
    throw new Error('getAllDonations must not be used by the donations query');
  }),
  getDonationsPage: jest.fn(() => []),
  getDonationById: jest.fn(),
  getRecentDonations: jest.fn(() => []),
};

const walletService = {
  getAllWallets: jest.fn(() => {
    throw new Error('getAllWallets must not be used by the wallets query');
  }),
  getWalletsPage: jest.fn(async () => []),
  getWalletById: jest.fn(),
};

const statsService = { getDailyStats: jest.fn(() => []), getSummaryStats: jest.fn(() => ({})) };

const schema = buildSchema({ donationService, walletService, statsService, pubsub });

function run(source) {
  return graphql({ schema, source, contextValue: userContext });
}

describe('GraphQL — list queries read bounded pages (#1891)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('donations passes default limit and zero offset to the page accessor', async () => {
    await run('{ donations { id } }');
    expect(donationService.getDonationsPage).toHaveBeenCalledWith({ limit: 20, offset: 0 });
  });

  test('donations clamps limit and negative offset before querying', async () => {
    await run('{ donations(limit: 10000, offset: -5) { id } }');
    expect(donationService.getDonationsPage).toHaveBeenCalledWith({ limit: 100, offset: 0 });
  });

  test('wallets passes clamped bounds to the page accessor and awaits it', async () => {
    walletService.getWalletsPage.mockResolvedValueOnce([{ id: 7, address: 'GX' }]);
    const result = await run('{ wallets(limit: 5, offset: 10) { id } }');
    expect(result.errors).toBeUndefined();
    expect(walletService.getWalletsPage).toHaveBeenCalledWith({ limit: 5, offset: 10 });
    expect(result.data.wallets).toEqual([{ id: 7 }]);
  });

  test('wallets query never falls back to loading every wallet', async () => {
    const result = await run('{ wallets { id } }');
    expect(result.errors).toBeUndefined();
    expect(walletService.getAllWallets).not.toHaveBeenCalled();
  });
});

describe('Wallet.getPage issues a bounded SQL query (#1891)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('uses LIMIT and OFFSET with bound parameters', async () => {
    await Wallet.getPage({ limit: 20, offset: 40 });
    const [sql, params] = Database.all.mock.calls[Database.all.mock.calls.length - 1];
    expect(sql).toMatch(/LIMIT \? OFFSET \?/);
    expect(params).toEqual([20, 40]);
  });
});

describe('Transaction.getPage (#1891)', () => {
  const seeded = Array.from({ length: 5 }, (_, i) => `txn-page-${i}`);

  beforeAll(() => {
    for (const id of seeded) {
      Transaction.create({ id, amount: 1, status: 'pending', timestamp: new Date().toISOString() });
    }
  });

  test('returns only the requested window in insertion order', () => {
    const page = Transaction.getPage({ limit: 2, offset: 1 });
    expect(page).toHaveLength(2);
    const ids = page.map((t) => t.id);
    expect(ids).toEqual(Transaction.getAll().slice(1, 3).map((t) => t.id));
  });
});
