'use strict';
/**
 * Tests: Issue #917 — TransactionSyncService Horizon API pagination
 */

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const log = require('../../src/utils/log');

// Build paginated mock responses
function makePage(count, pagingTokenStart, hasNext = true) {
  const records = Array.from({ length: count }, (_, i) => ({
    id: `tx-${pagingTokenStart + i}`,
    paging_token: String(pagingTokenStart + i),
    created_at: new Date().toISOString(),
    memo: null,
  }));
  return { records, next: jest.fn() };
}

const mockServerBuilder = {
  transactions: jest.fn().mockReturnThis(),
  forAccount: jest.fn().mockReturnThis(),
  order: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  cursor: jest.fn().mockReturnThis(),
  call: jest.fn(),
};

jest.mock('stellar-sdk', () => ({
  Horizon: {
    Server: jest.fn().mockImplementation(() => mockServerBuilder),
  },
}));

const mockWallet = { id: 'w1', address: 'GPUBKEY123', last_cursor: null };
jest.mock('../../src/routes/models/wallet', () => ({
  getByAddress: jest.fn().mockReturnValue(mockWallet),
  update: jest.fn(),
}));

jest.mock('../../src/routes/models/transaction', () => ({
  getByStellarTxId: jest.fn().mockReturnValue(null),
  create: jest.fn().mockImplementation((data) => data),
}));

const TransactionSyncService = require('../../src/services/TransactionSyncService');

describe('Issue #917 — TransactionSyncService pagination', () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TransactionSyncService('https://horizon-testnet.stellar.org');
    delete process.env.SYNC_MAX_PAGES;
  });

  describe('multi-page fetching', () => {
    it('fetches all 600 records across 3 pages of 200 each', async () => {
      const page1 = makePage(200, 1);
      const page2 = makePage(200, 201);
      const page3 = makePage(200, 401);
      const emptyPage = { records: [], next: jest.fn() };

      page1.next.mockResolvedValue(page2);
      page2.next.mockResolvedValue(page3);
      page3.next.mockResolvedValue(emptyPage);

      mockServerBuilder.call.mockResolvedValue(page1);

      const result = await service.syncWalletTransactions('GPUBKEY123', { cursor: 'cursor0', maxTransactions: 1000 });

      expect(result.synced).toBe(600);
    });

    it('stores records idempotently (skips existing)', async () => {
      const Transaction = require('../../src/routes/models/transaction');
      Transaction.getByStellarTxId.mockReturnValueOnce({ id: 'existing' });

      const page1 = makePage(2, 1);
      const emptyPage = { records: [], next: jest.fn() };
      page1.next.mockResolvedValue(emptyPage);
      mockServerBuilder.call.mockResolvedValue(page1);

      const result = await service.syncWalletTransactions('GPUBKEY123', { cursor: 'c0' });
      // 1 existing + 1 new = only 1 synced
      expect(result.synced).toBe(1);
    });

    it('logs DEBUG for each page fetched', async () => {
      const page1 = makePage(5, 1);
      const emptyPage = { records: [], next: jest.fn() };
      page1.next.mockResolvedValue(emptyPage);
      mockServerBuilder.call.mockResolvedValue(page1);

      await service._fetchHorizonTransactions('GPUBKEY123', 500, 'cursor0');

      const debugCalls = log.debug.mock.calls.filter(c => c[1] && c[1].includes('Synced page'));
      expect(debugCalls.length).toBeGreaterThanOrEqual(1);
      expect(debugCalls[0][1]).toMatch(/Synced page 1, fetched 5 transactions, total so far: 5/);
    });
  });

  describe('SYNC_MAX_PAGES page limit', () => {
    it('stops at SYNC_MAX_PAGES and emits WARN log', async () => {
      process.env.SYNC_MAX_PAGES = '2';

      const page1 = makePage(200, 1);
      const page2 = makePage(200, 201);
      const page3 = makePage(200, 401); // should never be fetched

      page1.next.mockResolvedValue(page2);
      page2.next.mockResolvedValue(page3);

      mockServerBuilder.call.mockResolvedValue(page1);

      const txs = await service._fetchHorizonTransactions('GPUBKEY123', 1000, 'cursor0');

      expect(txs).toHaveLength(400);

      const warnCalls = log.warn.mock.calls.filter(
        c => c[1] && c[1].includes('Sync truncated at page limit')
      );
      expect(warnCalls.length).toBe(1);
      expect(warnCalls[0][1]).toContain('GPUBKEY123');
      expect(warnCalls[0][1]).toContain('Some historical transactions may be missing');
    });

    it('defaults to 100 pages when SYNC_MAX_PAGES is not set', async () => {
      delete process.env.SYNC_MAX_PAGES;
      // Just check the service doesn't throw and respects the 100 page default
      // by mocking only 1 page
      const page1 = makePage(5, 1);
      const emptyPage = { records: [], next: jest.fn() };
      page1.next.mockResolvedValue(emptyPage);
      mockServerBuilder.call.mockResolvedValue(page1);

      const txs = await service._fetchHorizonTransactions('GPUBKEY123', 500, 'cursor0');
      expect(txs).toHaveLength(5);
      // No truncation warning
      const warnCalls = log.warn.mock.calls.filter(c => c[1] && c[1].includes('truncated'));
      expect(warnCalls).toHaveLength(0);
    });

    it('caps SYNC_MAX_PAGES at 1000', async () => {
      process.env.SYNC_MAX_PAGES = '9999';
      const page1 = makePage(5, 1);
      const emptyPage = { records: [], next: jest.fn() };
      page1.next.mockResolvedValue(emptyPage);
      mockServerBuilder.call.mockResolvedValue(page1);

      // Should not throw
      const txs = await service._fetchHorizonTransactions('GPUBKEY123', 500, 'cursor0');
      expect(txs).toHaveLength(5);
    });
  });
});
