'use strict';

/**
 * Tests for TransactionSyncService multi-page Horizon pagination (#734).
 */

const TransactionSyncService = require('../../src/services/TransactionSyncService');
const Transaction = require('../../src/routes/models/transaction');
const Wallet = require('../../src/routes/models/wallet');

jest.mock('../../src/routes/models/transaction');
jest.mock('../../src/routes/models/wallet');

const PUBLIC_KEY = 'GTEST1234567890ABCDEF';

function makeTx(id, pagingToken) {
  return { id, paging_token: pagingToken, created_at: '2024-01-01T00:00:00Z', memo: null };
}

function makeHorizonPage(records, hasNext = false) {
  return {
    records,
    next: hasNext
      ? jest.fn().mockResolvedValue(makeHorizonPage([], false))
      : jest.fn().mockResolvedValue({ records: [], next: jest.fn() }),
  };
}

describe('TransactionSyncService – pagination', () => {
  let svc;
  let mockServer;

  beforeEach(() => {
    jest.clearAllMocks();
    Transaction.getByStellarTxId.mockReturnValue(null);
    Transaction.create.mockImplementation(data => ({ id: Math.random(), ...data }));
    Wallet.getByAddress.mockReturnValue(null);
    Wallet.update.mockReturnValue(null);

    mockServer = {
      transactions: jest.fn().mockReturnThis(),
      forAccount: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      cursor: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      call: jest.fn(),
    };

    svc = new TransactionSyncService('https://horizon-testnet.stellar.org');
    svc.server = mockServer;
  });

  it('fetches a single page when there is no next page', async () => {
    const page1 = makeHorizonPage([makeTx('tx1', 'p1'), makeTx('tx2', 'p2')], false);
    mockServer.call.mockResolvedValue(page1);

    const txs = await svc._fetchHorizonTransactions(PUBLIC_KEY, 500, 'cursor0', 50);
    expect(txs).toHaveLength(2);
    // next() is called once to check for more records; it returns empty so loop stops
    expect(page1.next).toHaveBeenCalledTimes(1);
  });

  it('follows next-page cursor across multiple pages', async () => {
    const page2 = makeHorizonPage([makeTx('tx3', 'p3'), makeTx('tx4', 'p4')], false);
    const page1 = { records: [makeTx('tx1', 'p1'), makeTx('tx2', 'p2')], next: jest.fn().mockResolvedValue(page2) };
    mockServer.call.mockResolvedValue(page1);

    const txs = await svc._fetchHorizonTransactions(PUBLIC_KEY, 500, 'cursor0', 50);
    expect(txs).toHaveLength(4);
    expect(page1.next).toHaveBeenCalledTimes(1);
  });

  it('stops at maxPages even if more pages exist', async () => {
    // Each page has 2 records and always has a next page
    const infinitePage = { records: [makeTx('txA', 'pA'), makeTx('txB', 'pB')] };
    infinitePage.next = jest.fn().mockResolvedValue(infinitePage);
    mockServer.call.mockResolvedValue(infinitePage);

    const txs = await svc._fetchHorizonTransactions(PUBLIC_KEY, 10000, 'cursor0', 3);
    expect(txs).toHaveLength(6); // 3 pages × 2 records
    expect(infinitePage.next).toHaveBeenCalledTimes(2); // called after page 1 and 2
  });

  it('stops when maxTransactions is reached mid-page', async () => {
    const page1 = makeHorizonPage([makeTx('tx1', 'p1'), makeTx('tx2', 'p2'), makeTx('tx3', 'p3')], false);
    mockServer.call.mockResolvedValue(page1);

    const txs = await svc._fetchHorizonTransactions(PUBLIC_KEY, 2, 'cursor0', 50);
    expect(txs).toHaveLength(2);
  });

  it('syncWalletTransactions uses wallet last_cursor for incremental sync', async () => {
    Wallet.getByAddress.mockReturnValue({ id: 'w1', last_cursor: 'stored_cursor' });
    const page = makeHorizonPage([makeTx('tx1', 'p1')], false);
    mockServer.call.mockResolvedValue(page);

    await svc.syncWalletTransactions(PUBLIC_KEY);

    expect(mockServer.cursor).toHaveBeenCalledWith('stored_cursor');
  });

  it('syncWalletTransactions uses cursor override when provided', async () => {
    Wallet.getByAddress.mockReturnValue({ id: 'w1', last_cursor: 'stored_cursor' });
    const page = makeHorizonPage([makeTx('tx1', 'p1')], false);
    mockServer.call.mockResolvedValue(page);

    await svc.syncWalletTransactions(PUBLIC_KEY, { cursor: 'override_cursor' });

    expect(mockServer.cursor).toHaveBeenCalledWith('override_cursor');
  });

  it('syncWalletTransactions respects maxPages option', async () => {
    const infinitePage = { records: [makeTx('txA', 'pA')] };
    infinitePage.next = jest.fn().mockResolvedValue(infinitePage);
    mockServer.call.mockResolvedValue(infinitePage);

    const result = await svc.syncWalletTransactions(PUBLIC_KEY, { cursor: 'c0', maxPages: 2 });
    expect(result.synced).toBe(2);
  });

  it('syncWalletTransactions updates wallet last_cursor after sync', async () => {
    Wallet.getByAddress.mockReturnValue({ id: 'w1', last_cursor: null });
    const page = makeHorizonPage([makeTx('tx1', 'token_abc')], false);
    mockServer.call.mockResolvedValue(page);

    const result = await svc.syncWalletTransactions(PUBLIC_KEY, { cursor: '' });
    expect(Wallet.update).toHaveBeenCalledWith('w1', expect.objectContaining({ last_cursor: 'token_abc' }));
    expect(result.lastCursor).toBe('token_abc');
  });

  it('syncWalletTransactions returns lastCursor: null when no transactions fetched', async () => {
    Wallet.getByAddress.mockReturnValue(null);
    mockServer.call.mockResolvedValue(makeHorizonPage([], false));

    const result = await svc.syncWalletTransactions(PUBLIC_KEY);
    expect(result.lastCursor).toBeNull();
    expect(result.synced).toBe(0);
  });

  it('returns empty array and does not throw on 404 from Horizon', async () => {
    mockServer.call.mockRejectedValue({ response: { status: 404 } });
    const txs = await svc._fetchHorizonTransactions(PUBLIC_KEY, 500, undefined, 50);
    expect(txs).toEqual([]);
  });

  it('supports legacy numeric argument to syncWalletTransactions', async () => {
    Wallet.getByAddress.mockReturnValue(null);
    const page = makeHorizonPage([makeTx('tx1', 'p1')], false);
    mockServer.call.mockResolvedValue(page);

    // Should not throw
    const result = await svc.syncWalletTransactions(PUBLIC_KEY, 100);
    expect(result.synced).toBe(1);
  });
});
